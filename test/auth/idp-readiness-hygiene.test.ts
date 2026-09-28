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

test("OAuth rejects identity scopes until OIDC is supported", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  await stores.clients.create({
    clientName: "OIDC client",
    id: "client-oidc",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["email", "invoice:read", "profile"],
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
  for (const scope of [
    "openid",
    "openid profile",
    "openid email invoice:read",
  ]) {
    assert.throws(
      () =>
        service.validateResourceAndScopes(
          client,
          "https://resource.example",
          scope
        ),
      (error: unknown) =>
        error instanceof OAuthProtocolError && error.code === "invalid_scope"
    );
  }
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "profile"
    ),
    { resource: "https://resource.example", scopes: ["profile"] }
  );
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "email"
    ),
    { resource: "https://resource.example", scopes: ["email"] }
  );
  assert.deepEqual(
    service.validateResourceAndScopes(
      client,
      "https://resource.example",
      "email invoice:read"
    ),
    { resource: "https://resource.example", scopes: ["email", "invoice:read"] }
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
