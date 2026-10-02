import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { hashOAuthSecret } from "../../src/auth/authorization-server/index.ts";
import { OAuthProtocolError } from "../../src/auth/authorization-server/errors.ts";
import type { NormalizedAthenaAuthorizationServerConfig } from "../../src/auth/config.ts";
import { MemoryTokenKeyStore } from "../../src/auth/local/token-key-store.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";
import {
  createMemoryOAuthAuthorizationServerState,
  createMemoryOAuthAuthorizationServerStores,
} from "../../src/auth/local/authorization-server/memory-stores.ts";
import { OAuthAuthorizationServerService } from "../../src/auth/local/authorization-server/service.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";

class FailingTokenKeyStore extends MemoryTokenKeyStore {
  override async compareAndActivate(): Promise<void> {
    throw new Error("signing key persistence failed");
  }
}

const config: NormalizedAthenaAuthorizationServerConfig = {
  accessTokenTtlSeconds: 600,
  authorizationCodeTtlSeconds: 90,
  authorizationEndpoint: "https://issuer.example/oauth/authorize",
  authorizationRequestTtlSeconds: 600,
  consentUrl: null,
  enabled: true,
  issuer: "https://issuer.example",
  issueRefreshTokens: true,
  refreshTokenTtlSeconds: 86_400,
  resources: {
    "https://resource.example": {
      scopes: {
        "invoice:read": {},
        "invoice:write": {},
      },
    },
  },
  signInUrl: null,
};

test("OIDC-only request binds to the published pathful UserInfo resource", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "OIDC client",
    id: "client-oidc-only",
    redirectUris: ["https://client.example/callback"],
    resourceUris: [],
    scopes: ["openid", "profile", "email"],
  });
  const service = new OAuthAuthorizationServerService({
    config: { ...config, resources: {} },
    issuer: config.issuer as string,
    userInfoEndpoint: "https://issuer.example/api/auth/userinfo",
    keyStore: new MemoryTokenKeyStore(),
    signing: createTestOAuthSigning(config, new MemoryTokenKeyStore()),
    stateSecret: "oauth-test-secret",
    stores,
    userIsEligible: () => true,
  });

  const client = await service.getClient("client-oidc-only");
  const request = service.validateResourceAndScopes(
    client,
    undefined,
    "openid profile email"
  );

  assert.equal(request.resource, "https://issuer.example/api/auth/userinfo");
  assert.deepEqual(request.identityScopes, ["email", "openid", "profile"]);
  assert.deepEqual(request.scopes, []);
});
test("OAuth Memory service completes authorization code and refresh rotation", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "Test client",
    id: "client-1",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read", "invoice:write"],
  });
  const verifier = "v".repeat(43);
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "oauth-test-secret",
    stores,
    userIsEligible: () => true,
  });
  await stores.clients.create({
    clientName: "OIDC validation client",
    id: "client-oidc-validation",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["openid"],
  });
  await assert.rejects(
    service.validateAuthorizationRequest({
      clientId: "client-oidc-validation",
      codeChallenge: await generateCodeChallenge(verifier),
      codeChallengeMethod: "S256",
      maxAge: 2_147_483_648,
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
      responseType: "code",
      scope: "openid",
    }),
    (error: unknown) =>
      error instanceof OAuthProtocolError && error.code === "invalid_request"
  );
  const request = await service.createAuthorizationRequest({
    clientId: "client-1",
    codeChallenge: await generateCodeChallenge(verifier),
    codeChallengeMethod: "S256",
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
    scope: "invoice:read",
    state: "state-1",
  });
  const approved = await service.approveAuthorizationRequest({
    authenticatedAt: new Date("2026-01-01T00:00:00.000Z"),
    authenticationMethods: ["password"],
    id: request.id,
    organizationId: null,
    userId: "user-1",
  });
  const tokens = await service.exchangeAuthorizationCode({
    clientId: "client-1",
    code: approved.code,
    codeVerifier: verifier,
    redirectUri: "https://client.example/callback",
  });
  assert.deepEqual(tokens.scopes, ["invoice:read"]);
  assert.ok(tokens.refreshToken);

  const rotated = await service.refresh({
    clientId: "client-1",
    refreshToken: tokens.refreshToken,
    resource: "https://resource.example",
  });
  assert.ok(rotated.refreshToken);
  const rotatedRow = await stores.refreshTokens.getByHash(
    await (async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(rotated.refreshToken as string)
      );
      return Buffer.from(digest).toString("base64url");
    })()
  );
  assert.ok(rotatedRow);
  assert.equal(
    (await stores.refreshTokens.listFamily(rotatedRow.familyId)).length,
    2
  );
  await assert.rejects(
    service.refresh({
      clientId: "client-1",
      refreshToken: tokens.refreshToken,
      resource: "https://resource.example",
    }),
    /reused/
  );
});

test("OAuth admin stores filter and page clients and grants", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "First",
    id: "client-first",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  await stores.clients.create({
    clientName: "Second",
    id: "client-second",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  await stores.clients.disable("client-first");
  const clients = await stores.clients.list({ isActive: false });
  assert.equal(clients.total, 1);
  assert.equal(clients.clients[0]?.id, "client-first");

  await stores.grants.authorize({
    clientId: "client-second",
    organizationId: "org-1",
    resource: "https://resource.example",
    scopes: ["invoice:read"],
    userId: "user-1",
  });
  const grants = await stores.grants.list({
    clientId: "client-second",
    organizationId: "org-1",
    resource: "https://resource.example",
    userId: "user-1",
  });
  assert.equal(grants.total, 1);
  assert.equal(grants.grants.length, 1);
});

test("OAuth grant reuse replaces identity scopes, including with an empty set", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "Identity scope client",
    id: "client-identity-scopes",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read", "openid", "email"],
  });
  const authorize = async (
    suffix: string,
    identityScopes: readonly ("openid" | "email")[]
  ) => {
    const request = await stores.authorizationRequests.create({
      clientId: "client-identity-scopes",
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `request-${suffix}`,
      identityScopes,
      redirectUri: "https://client.example/callback",
      requestHash: `request-hash-${suffix}`,
      requestedScopes: ["invoice:read"],
      resource: "https://resource.example",
      stateCiphertext: "state",
    });
    return stores.completeAuthorization({
      authenticatedAt: new Date("2026-10-01T12:00:00.000Z"),
      authenticationMethods: ["passkey"],
      clientId: request.clientId,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      codeHash: await hashOAuthSecret(`code-${suffix}`),
      expiresAt: new Date(Date.now() + 60_000),
      grantId: `grant-${suffix}`,
      id: `code-${suffix}`,
      identityScopes,
      nonce: null,
      organizationId: null,
      redirectUri: request.redirectUri,
      requestId: request.id,
      resource: request.resource,
      scopes: request.requestedScopes,
      userId: "user-identity-scopes",
    });
  };
  const oidc = await authorize("oidc", ["openid", "email"]);
  const oauth = await authorize("oauth", []);
  assert.equal(oauth.grant.id, oidc.grant.id);
  assert.deepEqual(oauth.grant.identityScopes, []);
  const code = await stores.authorizationCodes.getByHash(
    await hashOAuthSecret("code-oauth")
  );
  assert.equal(code?.authenticatedAt.toISOString(), "2026-10-01T12:00:00.000Z");
  assert.deepEqual(code?.authenticationMethods, ["passkey"]);
});

test("silent authorization requires existing covered consent and preserves its timestamp", async () => {
  const state = createMemoryOAuthAuthorizationServerState();
  const stores = createMemoryOAuthAuthorizationServerStores({ state });
  const grant = await stores.grants.authorize({
    clientId: "client-silent",
    organizationId: null,
    resource: "https://resource.example",
    scopes: ["invoice:read"],
    userId: "user-silent",
  });
  const persistedGrant = state.grants.get(grant.id);
  assert.ok(persistedGrant);
  persistedGrant.identityScopes = ["openid"];
  const authorizedAt = grant.authorizedAt.toISOString();
  const request = await stores.authorizationRequests.create({
    clientId: "client-silent",
    codeChallenge: "a".repeat(43),
    codeChallengeMethod: "S256",
    expiresAt: new Date(Date.now() + 60_000),
    id: "request-silent",
    identityScopes: ["openid"],
    redirectUri: "https://client.example/callback",
    requestHash: "request-hash-silent",
    requestedScopes: ["invoice:read"],
    resource: "https://resource.example",
    stateCiphertext: "state",
  });
  const completed = await stores.completeAuthorization({
    authenticatedAt: new Date(),
    authenticationMethods: ["password"],
    clientId: request.clientId,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: request.codeChallengeMethod,
    codeHash: await hashOAuthSecret("silent-code"),
    expiresAt: new Date(Date.now() + 60_000),
    grantId: "silent-new-grant-must-not-exist",
    id: "silent-code-id",
    identityScopes: request.identityScopes,
    nonce: null,
    organizationId: null,
    preserveExistingGrant: true,
    redirectUri: request.redirectUri,
    requestId: request.id,
    resource: request.resource,
    scopes: request.requestedScopes,
    userId: "user-silent",
  });
  assert.equal(completed.grant.id, grant.id);
  assert.equal(completed.grant.authorizedAt.toISOString(), authorizedAt);
  await stores.grants.revoke({ grantId: grant.id, reason: "revoked" });
  const missingRequest = await stores.authorizationRequests.create({
    ...request,
    id: "request-silent-after-revoke",
    identityScopes: [],
    requestHash: "request-hash-silent-after-revoke",
  });
  await assert.rejects(
    stores.completeAuthorization({
      authenticatedAt: new Date(),
      authenticationMethods: ["password"],
      clientId: missingRequest.clientId,
      codeChallenge: missingRequest.codeChallenge,
      codeChallengeMethod: missingRequest.codeChallengeMethod,
      codeHash: await hashOAuthSecret("silent-code-after-revoke"),
      expiresAt: new Date(Date.now() + 60_000),
      grantId: "must-not-be-created",
      id: "silent-code-after-revoke-id",
      identityScopes: [],
      nonce: null,
      organizationId: null,
      preserveExistingGrant: true,
      redirectUri: missingRequest.redirectUri,
      requestId: missingRequest.id,
      resource: missingRequest.resource,
      scopes: missingRequest.requestedScopes,
      userId: "user-silent",
    }),
    (error: unknown) =>
      error instanceof OAuthProtocolError && error.code === "consent_required"
  );
});

test("OAuth admin store pages grants by status with stable ordering", async () => {
  const state = createMemoryOAuthAuthorizationServerState();
  const stores = createMemoryOAuthAuthorizationServerStores({ state });
  const inputs = [
    { id: "grant-z", userId: "user-z", status: "active" as const },
    { id: "grant-a", userId: "user-a", status: "active" as const },
    { id: "grant-expired", userId: "user-expired", status: "active" as const },
    { id: "grant-revoked", userId: "user-revoked", status: "revoked" as const },
  ];
  for (const input of inputs) {
    const created = await stores.grants.authorize({
      clientId: "client-1",
      organizationId: "org-1",
      resource: "https://resource.example",
      scopes: ["invoice:read"],
      userId: input.userId,
    });
    const row = state.grants.get(created.id);
    assert.ok(row);
    row.id = input.id;
    row.authorizedAt = new Date("2026-10-01T12:00:00.000Z");
    row.status = input.status;
    if (input.id === "grant-expired") {
      row.expiresAt = new Date("2026-09-30T12:00:00.000Z");
    }
    if (input.status === "revoked") {
      row.revokedAt = new Date("2026-10-01T12:00:00.000Z");
    }
  }

  const active = await stores.grants.list({
    clientId: "client-1",
    limit: 1,
    offset: 0,
    organizationId: "org-1",
    resource: "https://resource.example",
    status: "active",
  });
  assert.equal(active.total, 2);
  assert.deepEqual(active.grants.map((grant) => grant.id), ["grant-a"]);

  const expired = await stores.grants.list({ status: "expired" });
  assert.deepEqual(expired.grants.map((grant) => grant.id), ["grant-expired"]);
  const revoked = await stores.grants.list({ status: "revoked" });
  assert.deepEqual(revoked.grants.map((grant) => grant.id), ["grant-revoked"]);
  assert.equal((await stores.grants.listForUser("user-a")).length, 1);
});

test("OAuth client admin pages tie-break by ID and return cloned records", async () => {
  const state = createMemoryOAuthAuthorizationServerState();
  const stores = createMemoryOAuthAuthorizationServerStores({ state });
  for (const id of ["client-z", "client-a"]) {
    await stores.clients.create({
      clientName: id,
      id,
      metadata: { nested: { value: "original" } },
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example"],
      scopes: ["invoice:read"],
    });
    const row = state.clients.get(id);
    assert.ok(row);
    row.createdAt = new Date("2026-10-01T12:00:00.000Z");
  }

  const page = await stores.clients.list({ limit: 1, offset: 0 });
  assert.equal(page.total, 2);
  assert.equal(page.clients[0]?.id, "client-a");
  (page.clients[0]?.redirectUris as string[]).push("https://mutated.example/");
  ((page.clients[0]?.metadata as Record<string, { value: string }>).nested
    .value as string) = "mutated";
  const persisted = await stores.clients.get("client-a");
  assert.deepEqual(persisted?.redirectUris, ["https://client.example/callback"]);
  assert.equal(
    (persisted?.metadata.nested as { value: string } | undefined)?.value,
    "original"
  );
});

test("OAuth code exchange rolls back consumption when token issuance fails", async () => {
  const authStores = new MemoryAuthStores();
  const oauthState = createMemoryOAuthAuthorizationServerState();
  const stores = createMemoryOAuthAuthorizationServerStores({
    state: oauthState,
  });
  await stores.clients.create({
    clientName: "Atomic exchange client",
    id: "client-atomic-exchange",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const verifier = "a".repeat(43);
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "oauth-test-secret",
    stores,
    userIsEligible: () => true,
  });
  const request = await service.createAuthorizationRequest({
    clientId: "client-atomic-exchange",
    codeChallenge: await generateCodeChallenge(verifier),
    codeChallengeMethod: "S256",
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
    scope: "invoice:read",
    state: "state-atomic-exchange",
  });
  const approved = await service.approveAuthorizationRequest({
    authenticatedAt: new Date("2026-01-01T00:00:00.000Z"),
    authenticationMethods: ["passkey"],
    id: request.id,
    organizationId: null,
    userId: "user-atomic-exchange",
  });
  const input = {
    clientId: "client-atomic-exchange",
    code: approved.code,
    codeVerifier: verifier,
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
  };
  const failingTransaction = createMemoryAuthMutationTransaction(
    authStores,
    undefined,
    undefined,
    oauthState,
    () => new FailingTokenKeyStore()
  );

  await assert.rejects(
    failingTransaction((scope) =>
      service.withMutationScope(scope).exchangeAuthorizationCode(input)
    ),
    /signing key persistence failed/
  );

  const retryTransaction = createMemoryAuthMutationTransaction(
    authStores,
    undefined,
    undefined,
    oauthState,
    () => new MemoryTokenKeyStore()
  );
  const tokens = await retryTransaction((scope) =>
    service.withMutationScope(scope).exchangeAuthorizationCode(input)
  );
  assert.ok(tokens.accessToken);
  assert.ok(tokens.refreshToken);
});

test("OAuth Memory service rejects resource and scope widening", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "Test client",
    id: "client-2",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const client = await stores.clients.get("client-2");
  assert.ok(client);
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "oauth-test-secret",
    stores,
    userIsEligible: () => true,
  });
  assert.throws(
    () =>
      service.validateResourceAndScopes(
        client,
        "https://other.example",
        "invoice:read"
      ),
    /not registered/
  );
  await assert.rejects(
    service.createAuthorizationRequest({
      clientId: "client-2",
      codeChallenge: "malformed",
      codeChallengeMethod: "S256",
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
      scope: "invoice:read",
      state: "state",
    }),
    /base64url/
  );
});

test("OAuth issuance attenuates to the live grant scope", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "Test client",
    id: "client-3",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read", "invoice:write"],
  });
  const verifier = "w".repeat(43);
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "oauth-test-secret",
    stores,
    userIsEligible: () => true,
  });
  const request = await service.createAuthorizationRequest({
    clientId: "client-3",
    codeChallenge: await generateCodeChallenge(verifier),
    codeChallengeMethod: "S256",
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
    scope: "invoice:read invoice:write",
    state: "state-3",
  });
  const approved = await service.approveAuthorizationRequest({
    authenticatedAt: new Date("2026-01-01T00:00:00.000Z"),
    authenticationMethods: ["password", "totp"],
    id: request.id,
    organizationId: null,
    userId: "user-3",
  });
  const narrowed = await stores.grants.authorize({
    clientId: "client-3",
    organizationId: null,
    resource: "https://resource.example",
    scopes: ["invoice:read"],
    userId: "user-3",
  });
  assert.equal(narrowed.id, approved.grant.id);
  const tokens = await service.exchangeAuthorizationCode({
    clientId: "client-3",
    code: approved.code,
    codeVerifier: verifier,
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
  });
  assert.deepEqual(tokens.scopes, ["invoice:read"]);
});
