import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  fetchClientIdMetadataDocument,
  isClientIdMetadataDocumentUrl,
  parseClientIdMetadataDocument,
} from "../../src/auth/authorization-server/client-id-metadata.ts";
import { buildAuthorizationServerMetadata } from "../../src/auth/authorization-server/metadata.ts";
import { OAuthProtocolError } from "../../src/auth/authorization-server/errors.ts";
import type { NormalizedAthenaAuthorizationServerConfig } from "../../src/auth/config.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { MemoryTokenKeyStore } from "../../src/auth/local/token-key-store.ts";
import { createMemoryOAuthAuthorizationServerStores } from "../../src/auth/local/authorization-server/memory-stores.ts";
import { OAuthAuthorizationServerService } from "../../src/auth/local/authorization-server/service.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";

const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";

const chatgptDocument = {
  client_id: CHATGPT_CLIENT_ID,
  client_uri: "https://chatgpt.com/",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "ChatGPT",
  logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
};

test("authorization-server metadata advertises Client ID Metadata Documents", () => {
  const config = {
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
      "https://resource.example/mcp": {
        scopes: { "mcp:read": {} },
      },
    },
    signInUrl: null,
  } satisfies NormalizedAthenaAuthorizationServerConfig;
  const metadata = buildAuthorizationServerMetadata({
    config,
    identity: {
      authorizationEndpoint: "https://issuer.example/oauth/authorize",
      issuer: "https://issuer.example",
      jwksUri: "https://issuer.example/.well-known/jwks.json",
      publicBaseUrl: "https://issuer.example",
      revocationEndpoint: "https://issuer.example/oauth/revoke",
      tokenEndpoint: "https://issuer.example/oauth/token",
      userInfoEndpoint: "https://issuer.example/userinfo",
    },
  });
  assert.equal(metadata.client_id_metadata_document_supported, true);
});

test("CIMD URL validation accepts ChatGPT stable client_id and rejects unsafe forms", () => {
  assert.equal(isClientIdMetadataDocumentUrl(CHATGPT_CLIENT_ID), true);
  assert.equal(
    isClientIdMetadataDocumentUrl("http://chatgpt.com/oauth/client.json"),
    false,
  );
  assert.equal(isClientIdMetadataDocumentUrl("https://chatgpt.com/"), false);
  assert.equal(
    isClientIdMetadataDocumentUrl(
      "https://user:pass@chatgpt.com/oauth/client.json",
    ),
    false,
  );
  assert.equal(isClientIdMetadataDocumentUrl("client-pre-registered"), false);
});

test("CIMD parser accepts ChatGPT document via auth-method intersection with none", () => {
  const parsed = parseClientIdMetadataDocument(
    chatgptDocument,
    CHATGPT_CLIENT_ID,
  );
  assert.equal(parsed.clientName, "ChatGPT");
  assert.deepEqual(parsed.redirectUris, [
    "https://chatgpt.com/connector_platform_oauth_redirect",
  ]);
  assert.deepEqual(parsed.tokenEndpointAuthMethods, ["none"]);
});

test("CIMD parser rejects client_id mismatch and private_key_jwt-only documents", () => {
  assert.throws(
    () =>
      parseClientIdMetadataDocument(
        { ...chatgptDocument, client_id: "https://other.example/client.json" },
        CHATGPT_CLIENT_ID,
      ),
    /exactly match/,
  );
  assert.throws(
    () =>
      parseClientIdMetadataDocument(
        {
          ...chatgptDocument,
          token_endpoint_auth_method: "private_key_jwt",
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
        },
        CHATGPT_CLIENT_ID,
      ),
    /token_endpoint_auth_method none/,
  );
});

test("CIMD fetch uses the client_id URL and materializes a public PKCE client", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  const keyStore = new MemoryTokenKeyStore();
  const signing = await createTestOAuthSigning({
    issuer: "https://issuer.example",
    keyStore,
  });
  let fetchedUrl = "";
  const service = new OAuthAuthorizationServerService({
    config: {
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
        "https://mcp.example/mcp": {
          scopes: {
            "mcp:read": {},
            offline_access: {},
          },
        },
      },
      signInUrl: null,
    },
    fetchClientMetadata: async (url) => {
      fetchedUrl = String(url);
      return new Response(JSON.stringify(chatgptDocument), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
    issuer: "https://issuer.example",
    keyStore,
    signing,
    stateSecret: "cimd-test-state-secret",
    stores,
    userIsEligible: () => true,
  });

  const client = await service.getClient(CHATGPT_CLIENT_ID);
  assert.equal(fetchedUrl, CHATGPT_CLIENT_ID);
  assert.equal(client.registrationKind, "client-id-metadata");
  assert.equal(client.tokenEndpointAuthMethod, "none");
  assert.deepEqual(client.redirectUris, [
    "https://chatgpt.com/connector_platform_oauth_redirect",
  ]);
  assert.ok(client.resourceUris.includes("https://mcp.example/mcp"));
  assert.ok(client.scopes.includes("mcp:read"));
  assert.ok(client.scopes.includes("openid"));

  const verifier = "v".repeat(43);
  const validated = await service.validateAuthorizationRequest({
    clientId: CHATGPT_CLIENT_ID,
    codeChallenge: await generateCodeChallenge(verifier),
    codeChallengeMethod: "S256",
    redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
    resource: "https://mcp.example/mcp",
    responseType: "code",
    scope: "openid mcp:read offline_access",
  });
  assert.equal(validated.client.id, CHATGPT_CLIENT_ID);
  assert.deepEqual(validated.scopes, ["mcp:read", "offline_access"]);
});

test("active CIMD clients reconcile resources and scopes after server rotation", async () => {
  const stores = createMemoryOAuthAuthorizationServerStores();
  const keyStore = new MemoryTokenKeyStore();
  const signing = await createTestOAuthSigning({
    issuer: "https://issuer.example",
    keyStore,
  });
  const common = {
    authorizationEndpoint: "https://issuer.example/oauth/authorize",
    authorizationRequestTtlSeconds: 600,
    consentUrl: null,
    enabled: true,
    issuer: "https://issuer.example",
    issueRefreshTokens: true,
    refreshTokenTtlSeconds: 86_400,
    signInUrl: null,
  };
  const initialService = new OAuthAuthorizationServerService({
    config: {
      ...common,
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 90,
      resources: {
        "https://old-mcp.example/mcp": {
          scopes: { "mcp:read": {} },
        },
      },
    },
    fetchClientMetadata: async () =>
      new Response(JSON.stringify(chatgptDocument), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    issuer: common.issuer,
    keyStore,
    signing,
    stateSecret: "cimd-reconciliation-test-secret",
    stores,
    userIsEligible: () => true,
  });

  const initial = await initialService.getClient(CHATGPT_CLIENT_ID);
  const rotatedService = new OAuthAuthorizationServerService({
    config: {
      ...common,
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 90,
      resources: {
        "https://new-mcp.example/mcp": {
          scopes: { "mcp:write": {} },
        },
      },
    },
    fetchClientMetadata: async () => {
      throw new Error("an existing CIMD client must not be refetched");
    },
    issuer: common.issuer,
    keyStore,
    signing,
    stateSecret: "cimd-reconciliation-test-secret",
    stores,
    userIsEligible: () => true,
  });

  const reconciled = await rotatedService.getClient(CHATGPT_CLIENT_ID);
  assert.deepEqual(reconciled.resourceUris, ["https://new-mcp.example/mcp"]);
  assert.deepEqual(reconciled.scopes, [
    "email",
    "mcp:write",
    "offline_access",
    "openid",
    "profile",
  ]);
  assert.deepEqual(reconciled.redirectUris, initial.redirectUris);
  assert.deepEqual(reconciled.metadata, initial.metadata);

  const validated = await rotatedService.validateAuthorizationRequest({
    clientId: CHATGPT_CLIENT_ID,
    codeChallenge: await generateCodeChallenge("v".repeat(43)),
    codeChallengeMethod: "S256",
    redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
    resource: "https://new-mcp.example/mcp",
    responseType: "code",
    scope: "openid mcp:write",
  });
  assert.deepEqual(validated.scopes, ["mcp:write"]);
});

test("CIMD fetch fails closed on HTTP errors", async () => {
  await assert.rejects(
    () =>
      fetchClientIdMetadataDocument(CHATGPT_CLIENT_ID, {
        fetchImpl: async () => new Response("nope", { status: 404 }),
      }),
    (error: unknown) =>
      error instanceof OAuthProtocolError && error.code === "invalid_client",
  );
});
