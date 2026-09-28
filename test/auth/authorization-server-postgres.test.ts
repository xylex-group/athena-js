import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  generateOpaqueSecret,
  hashOAuthSecret,
} from "../../src/auth/authorization-server/index.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { createPostgresOAuthAuthorizationServerStores } from "../../src/auth/local/authorization-server/postgres-stores.ts";
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
    const client = await stores.clients.create({
      clientName: "Postgres concurrency test",
      id: `oauth-pg-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example"],
      scopes: ["invoice:read"],
    });
    const request = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-request-${suffix}`,
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
            clientId: client.id,
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: "S256",
            codeHash: await hashOAuthSecret(rawCode),
            expiresAt: new Date(Date.now() + 60_000),
            grantId: `oauth-pg-grant-${suffix}-${index}`,
            id: `oauth-pg-code-${suffix}-${index}`,
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
      clientId: client.id,
      codeChallenge,
      codeChallengeMethod: "S256",
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      grantId: grant.id,
      id: `oauth-pg-atomic-code-${suffix}`,
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
