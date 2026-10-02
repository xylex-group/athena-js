import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  generateOpaqueSecret,
  hashOAuthSecret,
} from "../../src/auth/authorization-server/index.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { createPostgresOAuthAuthorizationServerStores } from "../../src/auth/local/authorization-server/postgres-stores.ts";
import { ATHENA_AUTH_TABLES } from "../../src/auth/contract/index.ts";
import { OAuthAuthorizationServerService } from "../../src/auth/local/authorization-server/service.ts";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";
import { MemoryTokenKeyStore } from "../../src/auth/local/token-key-store.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";
import { PostgresTokenKeyStore } from "../../src/auth/local/postgres-token-key-store.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";
import { PostgresAuthorizationStore } from "../../src/runtime/authorization/postgres.ts";

class FailingTokenKeyStore extends MemoryTokenKeyStore {
  override async compareAndActivate(): Promise<void> {
    throw new Error("signing key persistence failed");
  }
}

function databaseUrl(): string | undefined {
  const value = (
    process.env.ATHENA_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  return /^postgres(?:ql)?:\/\//i.test(value) ? value : undefined;
}

const url = databaseUrl();
const maybe = url ? test : test.skip;

maybe("Postgres OAuth authorization completion and code consume are single-winner", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const userId = `oauth-pg-user-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    await new PostgresAuthorizationStore(database).ensureCatalog();
    const authStores = new PostgresAuthStores(database);
    await authStores.createUser({
      email: `oauth-pg-${suffix}@example.com`,
      id: userId,
      name: "OAuth PG User",
    });
    const stores = createPostgresOAuthAuthorizationServerStores(database);
    const activeBefore = await stores.clients.list({ isActive: true });
    const client = await stores.clients.create({
      clientName: "Postgres concurrency test",
      id: `oauth-pg-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example/", "https://resource.example"],
      scopes: ["invoice:read", " invoice:read "],
    });
    assert.deepEqual(client.resourceUris, ["https://resource.example"]);
    assert.deepEqual(client.scopes, ["invoice:read"]);
    const clientPage = await stores.clients.list({
      isActive: true,
      limit: 1,
      offset: 0,
    });
    assert.equal(clientPage.total, activeBefore.total + 1);
    assert.equal(clientPage.clients[0]?.id, client.id);
    const inactiveBefore = await stores.clients.list({ isActive: false });
    const inactiveClient = await stores.clients.create({
      clientName: "Postgres inactive test",
      id: `oauth-pg-inactive-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example"],
      scopes: ["invoice:read"],
    });
    await stores.clients.disable(inactiveClient.id);
    await stores.clients.disable(inactiveClient.id);
    const inactivePage = await stores.clients.list({
      isActive: false,
      limit: 1000,
      offset: 0,
    });
    assert.equal(inactivePage.total, inactiveBefore.total + 1);
    assert.ok(inactivePage.clients.some((value) => value.id === inactiveClient.id));
    const updatedClient = await stores.clients.update(client.id, {
      clientName: "Updated Postgres client",
    });
    assert.equal(updatedClient?.clientName, "Updated Postgres client");
    const request = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-request-${suffix}`,
      identityScopes: ["openid", "email"],
      maxAge: 300,
      nonce: `oauth-pg-nonce-${suffix}`,
      prompt: ["consent"],
      redirectUri: "https://client.example/callback",
      requestHash: `oauth-pg-request-hash-${suffix}`,
      requestedScopes: ["invoice:read"],
      resource: "https://resource.example",
      stateCiphertext: "state",
    });
    const completions = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const rawCode = generateOpaqueSecret();
        try {
          const completed = await stores.completeAuthorization({
            authenticatedAt: new Date("2026-10-01T12:00:00.000Z"),
            authenticationMethods: ["passkey", "totp"],
            clientId: client.id,
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: "S256",
            codeHash: await hashOAuthSecret(rawCode),
            expiresAt: new Date(Date.now() + 60_000),
            grantId: `oauth-pg-grant-${suffix}-${index}`,
            id: `oauth-pg-code-${suffix}-${index}`,
            identityScopes: request.identityScopes,
            nonce: request.nonce,
            organizationId: null,
            redirectUri: request.redirectUri,
            requestId: request.id,
            resource: request.resource,
            scopes: request.requestedScopes,
            userId,
          });
          return { completed, ok: true as const, rawCode };
        } catch {
          return { ok: false as const };
        }
      })
    );
    const winners = completions.filter((result) => result.ok);
    assert.equal(winners.length, 1);
    const winner = winners[0];
    if (!winner || !winner.ok) {
      throw new Error("expected one OAuth authorization completion winner");
    }
    assert.deepEqual(
      winner.completed.request.identityScopes,
      ["openid", "email"]
    );
    assert.deepEqual(
      winner.completed.grant.identityScopes,
      ["openid", "email"]
    );
    const completedCode = await stores.authorizationCodes.getByHash(
      await hashOAuthSecret(winner.rawCode)
    );
    assert.equal(completedCode?.nonce, `oauth-pg-nonce-${suffix}`);
    assert.deepEqual(completedCode?.identityScopes, ["openid", "email"]);
    assert.equal(
      completedCode?.authenticatedAt.toISOString(),
      "2026-10-01T12:00:00.000Z"
    );
    assert.deepEqual(completedCode?.authenticationMethods, ["passkey", "totp"]);
    const silentUserId = `${userId}-silent`;
    await authStores.createUser({
      email: `oauth-pg-silent-${suffix}@example.com`,
      id: silentUserId,
      name: "OAuth PG Silent User",
    });
    const silentGrant = await stores.grants.authorize({
      clientId: client.id,
      organizationId: null,
      resource: request.resource,
      scopes: request.requestedScopes,
      userId: silentUserId,
    });
    const silentRequest = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-silent-${suffix}`,
      identityScopes: [],
      redirectUri: request.redirectUri,
      requestHash: `oauth-pg-silent-hash-${suffix}`,
      requestedScopes: request.requestedScopes,
      resource: request.resource,
      stateCiphertext: "state",
    });
    const authorizedAt = silentGrant.authorizedAt.toISOString();
    const silent = await stores.completeAuthorization({
      authenticatedAt: new Date("2026-10-02T12:00:00.000Z"),
      authenticationMethods: ["passkey"],
      clientId: client.id,
      codeChallenge: silentRequest.codeChallenge,
      codeChallengeMethod: "S256",
      codeHash: await hashOAuthSecret(generateOpaqueSecret()),
      expiresAt: new Date(Date.now() + 60_000),
      grantId: `oauth-pg-silent-grant-${suffix}`,
      id: `oauth-pg-silent-code-${suffix}`,
      identityScopes: [],
      nonce: null,
      organizationId: null,
      preserveExistingGrant: true,
      redirectUri: silentRequest.redirectUri,
      requestId: silentRequest.id,
      resource: silentRequest.resource,
      scopes: silentRequest.requestedScopes,
      userId: silentUserId,
    });
    assert.equal(silent.grant.id, silentGrant.id);
    assert.equal(silent.grant.authorizedAt.toISOString(), authorizedAt);
    await stores.grants.revoke({ grantId: silent.grant.id, reason: "test revoke" });
    const revokedSilentRequest = await stores.authorizationRequests.create({
      ...silentRequest,
      id: `oauth-pg-silent-revoked-${suffix}`,
      requestHash: `oauth-pg-silent-revoked-hash-${suffix}`,
    });
    await assert.rejects(
      stores.completeAuthorization({
        authenticatedAt: new Date(),
        authenticationMethods: ["passkey"],
        clientId: client.id,
        codeChallenge: revokedSilentRequest.codeChallenge,
        codeChallengeMethod: "S256",
        codeHash: await hashOAuthSecret(generateOpaqueSecret()),
        expiresAt: new Date(Date.now() + 60_000),
        grantId: `must-not-exist-${suffix}`,
        id: `must-not-be-issued-${suffix}`,
        identityScopes: [],
        nonce: null,
        organizationId: null,
        preserveExistingGrant: true,
        redirectUri: revokedSilentRequest.redirectUri,
        requestId: revokedSilentRequest.id,
        resource: revokedSilentRequest.resource,
        scopes: revokedSilentRequest.requestedScopes,
        userId: silentUserId,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "consent_required"
    );
    const reauthorization = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-reauthorization-${suffix}`,
      identityScopes: [],
      redirectUri: request.redirectUri,
      requestHash: `oauth-pg-reauthorization-hash-${suffix}`,
      requestedScopes: ["invoice:read"],
      resource: request.resource,
      stateCiphertext: "state",
    });
    const refreshedGrant = await stores.completeAuthorization({
      authenticatedAt: new Date("2026-10-02T12:00:00.000Z"),
      authenticationMethods: ["password"],
      clientId: client.id,
      codeChallenge: reauthorization.codeChallenge,
      codeChallengeMethod: "S256",
      codeHash: await hashOAuthSecret(generateOpaqueSecret()),
      expiresAt: new Date(Date.now() + 60_000),
      grantId: `oauth-pg-grant-refresh-${suffix}`,
      id: `oauth-pg-code-refresh-${suffix}`,
      identityScopes: [],
      organizationId: null,
      redirectUri: reauthorization.redirectUri,
      requestId: reauthorization.id,
      resource: reauthorization.resource,
      scopes: ["invoice:read"],
      userId,
    });
    assert.equal(refreshedGrant.grant.id, winner.completed.grant.id);
    assert.deepEqual(refreshedGrant.grant.identityScopes, []);
    const activeGrantPage = await stores.grants.list({
      clientId: client.id,
      limit: 1,
      offset: 0,
      organizationId: null,
      resource: request.resource,
      status: "active",
      userId,
    });
    assert.equal(activeGrantPage.total, 1);
    assert.equal(activeGrantPage.grants[0]?.id, winner.completed.grant.id);
    const grants = await stores.grants.list({
      clientId: client.id,
      resource: request.resource,
      userId,
    });
    assert.equal(grants.total, 1);
    assert.equal(grants.grants[0]?.id, winner.completed.grant.id);

    const codeHash = await hashOAuthSecret(winner.rawCode);
    const consumed = await Promise.all(
      Array.from({ length: 20 }, () =>
        stores.authorizationCodes.consume({
          clientId: client.id,
          codeChallenge: request.codeChallenge,
          codeHash,
          redirectUri: request.redirectUri,
          resource: request.resource,
        })
      )
    );
    assert.equal(consumed.filter(Boolean).length, 1);

    const rawRefresh = generateOpaqueSecret();
    const familyId = `oauth-pg-family-${suffix}`;
    await stores.refreshTokens.create({
      clientId: client.id,
      expiresAt: new Date(Date.now() + 60_000),
      familyId,
      grantId: winner.completed.grant.id,
      id: `oauth-pg-refresh-${suffix}`,
      identityScopes: ["openid", "email"],
      organizationId: null,
      resource: request.resource,
      scopes: request.requestedScopes,
      tokenHash: await hashOAuthSecret(rawRefresh),
      userId,
    });
    const rotations = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const replacement = generateOpaqueSecret();
        return stores.refreshTokens.rotate({
          clientId: client.id,
          replacement: {
            clientId: client.id,
            expiresAt: new Date(Date.now() + 60_000),
            familyId,
            grantId: winner.completed.grant.id,
            id: `oauth-pg-refresh-${suffix}-${index}`,
            identityScopes: ["openid"],
            organizationId: null,
            parentTokenId: `oauth-pg-refresh-${suffix}`,
            resource: request.resource,
            scopes: request.requestedScopes,
            tokenHash: await hashOAuthSecret(replacement),
            userId,
          },
          resource: request.resource,
          tokenHash: await hashOAuthSecret(rawRefresh),
        });
      })
    );
    assert.equal(
      rotations.filter((result) => result.kind === "rotated").length,
      1
    );
    assert.equal(
      rotations.filter((result) => result.kind === "replay").length,
      19
    );
    const rotated = rotations.find((result) => result.kind === "rotated");
    assert.ok(rotated && rotated.kind === "rotated");
    assert.deepEqual(rotated.previous.identityScopes, ["openid", "email"]);
    assert.deepEqual(rotated.replacement.identityScopes, ["openid"]);
    await database.query(
      `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
       SET expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [winner.completed.grant.id]
    );
    const expiredGrantPage = await stores.grants.list({ status: "expired" });
    assert.ok(
      expiredGrantPage.grants.some(
        (value) => value.id === winner.completed.grant.id
      )
    );
    await stores.grants.revoke({
      grantId: winner.completed.grant.id,
      reason: "test revocation",
      revokedBy: userId,
    });
    const revokedGrantPage = await stores.grants.list({
      status: "revoked",
      userId,
    });
    assert.equal(revokedGrantPage.total, 1);
    assert.equal(revokedGrantPage.grants[0]?.revokedBy, userId);
  } finally {
    await database.close?.();
  }
});

maybe("Postgres OAuth code exchange rolls back code consumption on issuance failure", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const userId = `oauth-pg-atomic-user-${suffix}`;
  const issuer = "https://issuer.example";
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      enabled: true,
      issuer,
      resources: {
        "https://resource.example": {
          scopes: { "invoice:read": {} },
        },
      },
    },
    mode: "local",
    secret: `oauth-pg-atomic-secret-${suffix}`,
  });
  try {
    await migrateAthenaAuthSchema(database);
    await new PostgresAuthorizationStore(database).ensureCatalog();
    const authStores = new PostgresAuthStores(database);
    await authStores.createUser({
      email: `oauth-pg-atomic-${suffix}@example.com`,
      id: userId,
      name: "Atomic OAuth PG User",
    });
    const stores = createPostgresOAuthAuthorizationServerStores(database);
    const client = await stores.clients.create({
      clientName: "Postgres atomic exchange",
      id: `oauth-pg-atomic-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example"],
      scopes: ["invoice:read"],
    });
    const verifier = "a".repeat(43);
    const code = generateOpaqueSecret();
    const codeHash = await hashOAuthSecret(code);
    const codeChallenge = await generateCodeChallenge(verifier);
    const grant = await stores.grants.authorize({
      clientId: client.id,
      organizationId: null,
      resource: "https://resource.example",
      scopes: ["invoice:read"],
      userId,
    });
    await stores.authorizationCodes.create({
      authenticationMethods: ["passkey"],
      authenticatedAt: new Date("2026-01-01T00:00:00Z"),
      clientId: client.id,
      codeChallenge,
      codeChallengeMethod: "S256",
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      grantId: grant.id,
      id: `oauth-pg-atomic-code-${suffix}`,
      identityScopes: [],
      organizationId: null,
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
      scopes: ["invoice:read"],
      userId,
    });
    const keyStore = new MemoryTokenKeyStore();
    const service = new OAuthAuthorizationServerService({
      config: config.authorizationServer,
      issuer,
      keyStore,
      signing: createTestOAuthSigning(config.authorizationServer, keyStore),
      stateSecret: config.secret as string,
      stores,
      userIsEligible: () => true,
    });
    const input = {
      clientId: client.id,
      code,
      codeVerifier: verifier,
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
    };

    await assert.rejects(
      database.transaction(async (txDb) =>
        service
          .withMutationScope({
            oauth: createPostgresOAuthAuthorizationServerStores(txDb, {
              transactionBound: true,
            }),
            stores: new PostgresAuthStores(txDb),
            tokenKeys: new FailingTokenKeyStore(),
          })
          .exchangeAuthorizationCode(input)
      ),
      /signing key persistence failed/
    );

    const retry = await database.transaction(async (txDb) =>
      service
        .withMutationScope({
          oauth: createPostgresOAuthAuthorizationServerStores(txDb, {
            transactionBound: true,
          }),
          stores: new PostgresAuthStores(txDb),
          tokenKeys: new PostgresTokenKeyStore({
            database: txDb,
            encryptionSecret: config.secret as string,
            issuer,
            transactionBound: true,
          }),
        })
        .exchangeAuthorizationCode(input)
    );
    assert.ok(retry.accessToken);
    assert.ok(retry.refreshToken);
  } finally {
    await database.close?.();
  }
});
