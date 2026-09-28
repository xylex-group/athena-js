import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
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
    id: request.id,
    organizationId: null,
    userId: "user-1",
  });
  const tokens = await service.exchangeAuthorizationCode({
    clientId: "client-1",
    code: approved.code,
    codeVerifier: verifier,
    redirectUri: "https://client.example/callback",
    resource: "https://resource.example",
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
    () => service.validateResourceAndScopes(client, "https://other.example", "invoice:read"),
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

