import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { OAuthProtocolError } from "../../src/auth/authorization-server/errors.ts";
import { parseProtocolScopes } from "../../src/auth/authorization-server/scopes.ts";
import type { NormalizedAthenaAuthorizationServerConfig } from "../../src/auth/config.ts";
import { createMemoryOAuthAuthorizationServerStores } from "../../src/auth/local/authorization-server/memory-stores.ts";
import { OAuthAuthorizationServerService } from "../../src/auth/local/authorization-server/service.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { MemoryTokenKeyStore } from "../../src/auth/local/token-key-store.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";

const config: NormalizedAthenaAuthorizationServerConfig = {
  accessTokenTtlSeconds: 600,
  authorizationCodeTtlSeconds: 90,
  authorizationEndpoint: "https://issuer.example/oauth/authorize",
  authorizationRequestTtlSeconds: 600,
  consentUrl: null,
  enabled: true,
  issueRefreshTokens: true,
  issuer: "https://issuer.example",
  refreshTokenTtlSeconds: 86_400,
  resources: {
    "https://resource.example": {
      scopes: {
        email: {},
        "invoice:read": {},
        profile: {},
      },
    },
  },
  signInUrl: null,
};

test("identity scopes are classified only when openid is present", () => {
  const withOpenid = parseProtocolScopes("openid profile email invoice:read");
  assert.deepEqual(withOpenid.identity, ["email", "openid", "profile"]);
  assert.deepEqual(withOpenid.resource, ["invoice:read"]);
  assert.deepEqual(parseProtocolScopes("profile"), {
    identity: [],
    resource: ["profile"],
  });
  assert.deepEqual(parseProtocolScopes("email"), {
    identity: [],
    resource: ["email"],
  });
  assert.deepEqual(parseProtocolScopes("email api:read"), {
    identity: [],
    resource: ["api:read", "email"],
  });
});

test("Memory OAuth stores persist OIDC authorization context separately from resource scopes", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "OIDC client",
    id: "client-oidc",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read", "openid", "profile"],
  });
  const suffix = crypto.randomUUID();
  const request = await stores.authorizationRequests.create({
    clientId: "client-oidc",
    codeChallenge: "c".repeat(43),
    codeChallengeMethod: "S256",
    expiresAt: new Date(Date.now() + 60_000),
    id: `request-${suffix}`,
    identityScopes: ["openid", "profile"],
    maxAge: 300,
    nonce: "consumer-nonce",
    prompt: ["consent"],
    redirectUri: "https://client.example/callback",
    requestHash: `request-hash-${suffix}`,
    requestedScopes: ["invoice:read"],
    resource: "https://resource.example",
    stateCiphertext: "state-ciphertext",
  });
  assert.deepEqual(request.identityScopes, ["openid", "profile"]);
  assert.deepEqual(request.requestedScopes, ["invoice:read"]);
  assert.equal(request.nonce, "consumer-nonce");
  assert.equal(request.maxAge, 300);
  assert.deepEqual(request.prompt, ["consent"]);

  const completed = await stores.completeAuthorization({
    clientId: "client-oidc",
    codeChallenge: await generateCodeChallenge("o".repeat(43)),
    codeChallengeMethod: "S256",
    codeHash: `code-hash-${suffix}`,
    expiresAt: new Date(Date.now() + 60_000),
    authenticationMethods: ["passkey"],
    authenticatedAt: new Date("2026-01-01T00:00:00Z"),
    grantId: `grant-${suffix}`,
    id: `code-${suffix}`,
    identityScopes: request.identityScopes,
    nonce: request.nonce,
    organizationId: null,
    redirectUri: "https://client.example/callback",
    requestId: request.id,
    resource: request.resource,
    scopes: request.requestedScopes,
    userId: "oidc-user",
  });
  assert.deepEqual(completed.grant.identityScopes, ["openid", "profile"]);
  const code = await stores.authorizationCodes.getByHash(`code-hash-${suffix}`);
  assert.equal(code?.nonce, "consumer-nonce");
  assert.deepEqual(code?.identityScopes, ["openid", "profile"]);
  assert.equal(code?.authenticatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.deepEqual(code?.authenticationMethods, ["passkey"]);
});

test("unsupported response type is not mapped to unsupported_grant_type", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "Hygiene client",
    id: "client-hygiene",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "oauth-hygiene-secret",
    stores,
    userIsEligible: () => true,
  });
  await assert.rejects(
    service.validateAuthorizationRequest({
      clientId: "client-hygiene",
      codeChallenge: await generateCodeChallenge("v".repeat(43)),
      codeChallengeMethod: "S256",
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
      responseType: "token",
      scope: "invoice:read",
    }),
    (error: unknown) =>
      error instanceof OAuthProtocolError &&
      error.code === "unsupported_response_type"
  );
});

test("OAuth interaction secret is not the issuer", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "Secret client",
    id: "client-secret",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "explicit-runtime-secret",
    stores,
    userIsEligible: () => true,
  });
  const request = await service.createAuthorizationRequest({
    clientId: "client-secret",
    codeChallenge: await generateCodeChallenge("v".repeat(43)),
    codeChallengeMethod: "S256",
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
    scope: "invoice:read",
    state: "state",
  });
  assert.deepEqual(request.requestedScopes, ["invoice:read"]);
});

test("OAuth authorization requests accept identity scopes separately from resource scopes", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "OIDC client",
    id: "client-oidc",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["email", "invoice:read", "openid", "profile"],
  });
  const keyStore = new MemoryTokenKeyStore();
  const service = new OAuthAuthorizationServerService({
    config,
    issuer: config.issuer as string,
    keyStore,
    signing: createTestOAuthSigning(config, keyStore),
    stateSecret: "oauth-hygiene-secret",
    stores,
    userIsEligible: () => true,
  });
  const client = await stores.clients.get("client-oidc");
  assert.ok(client);
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "openid profile invoice:read"
    ),
    {
      identityScopes: ["openid", "profile"],
      resource: "https://resource.example",
      scopes: ["invoice:read"],
    }
  );
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "profile"
    ),
    {
      identityScopes: [],
      resource: "https://resource.example",
      scopes: ["profile"],
    }
  );
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "email"
    ),
    {
      identityScopes: [],
      resource: "https://resource.example",
      scopes: ["email"],
    }
  );
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "email invoice:read"
    ),
    {
      identityScopes: [],
      resource: "https://resource.example",
      scopes: ["email", "invoice:read"],
    }
  );
  await assert.rejects(
    service.validateAuthorizationRequest({
      clientId: "client-oidc",
      codeChallenge: "n".repeat(43),
      codeChallengeMethod: "S256",
      nonce: "nonce-without-openid",
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
      responseType: "code",
      scope: "invoice:read",
    }),
    (error: unknown) =>
      error instanceof OAuthProtocolError && error.code === "invalid_request"
  );
});

test("Memory sessions persist authentication context without public DTO leak", async () => {
  const stores = new MemoryAuthStores();
  const user = await stores.createUser({
    email: "session-context@example.com",
    id: crypto.randomUUID(),
    name: "Session",
  });
  const session = await stores.createSession({
    authenticationMethods: ["password", "totp"],
    expiresAt: new Date(Date.now() + 60_000),
    id: crypto.randomUUID(),
    token: `session_${crypto.randomUUID()}`,
    userId: user.id,
  });
  assert.deepEqual(session.authentication_methods, ["password", "totp"]);
  assert.ok(session.authenticated_at);
  const { toPublicSession } = await import("../../src/auth/local/models.ts");
  const publicSession = toPublicSession(session);
  assert.equal("authenticationMethods" in publicSession, false);
  assert.equal("authenticatedAt" in publicSession, false);
});
