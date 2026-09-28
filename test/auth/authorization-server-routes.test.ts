import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { hashOAuthSecret } from "../../src/auth/authorization-server/index.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { disableAuthorizationServerClient } from "../../src/auth/local/authorization-server/routes.ts";
import { OAuthAuthorizationServerService } from "../../src/auth/local/authorization-server/service.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAuthRouter } from "../../src/auth/local/router.ts";
import { createRuntimeDependencies } from "../../src/auth/local/runtime-dependencies.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";

function testHasher() {
  return {
    async hash(password: string) {
      return `hash:${password}`;
    },
    needsRehash() {
      return false;
    },
    async verify(password: string, hash: string) {
      return hash === `hash:${password}`;
    },
  };
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

test("OAuth routes complete hosted sign-in, consent, code, token, refresh, and metadata", async () => {
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      consentUrl: "https://app.example/consent",
      enabled: true,
      issuer: "https://issuer.example",
      resources: {
        "https://resource.example": {
          scopes: {
            "invoice:read": {},
            "invoice:write": {},
          },
        },
      },
      signInUrl: "https://app.example/sign-in",
    },
    mode: "local",
    secret: "oauth-route-test-secret",
  });
  const deps = createRuntimeDependencies({
    config,
    hasher: testHasher(),
    stores: new MemoryAuthStores(),
  });
  const authStores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const call = (request: Request, path: string) =>
    router.handleRoute(request, path, authStores, new Headers(), "trace-oauth");
  const signUp = await call(
    new Request("https://issuer.example/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "oauth@example.com",
        name: "OAuth User",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-up/email",
  );
  assert.equal(signUp.status, 200);
  const cookie = cookieOf(signUp);
  assert.ok(cookie);

  const oauthStores = await deps.getOAuthStores();
  await oauthStores.clients.create({
    clientName: "External client",
    id: "client-route",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read", "invoice:write"],
  });

  const verifier = "r".repeat(43);
  const authorizeUrl = new URL(
    "https://issuer.example/api/auth/oauth/authorize",
  );
  authorizeUrl.search = new URLSearchParams({
    client_id: "client-route",
    code_challenge: await generateCodeChallenge(verifier),
    code_challenge_method: "S256",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "invoice:read invoice:write",
    state: "state-route",
  }).toString();
  const signInRedirect = await call(
    new Request(authorizeUrl),
    "/oauth/authorize",
  );
  assert.equal(signInRedirect.status, 302);
  const interactionId = new URL(
    signInRedirect.headers.get("location") as string,
  ).searchParams.get("interaction_id");
  assert.ok(interactionId);

  const consentRedirect = await call(
    new Request(
      `https://issuer.example/api/auth/oauth/authorize?interaction_id=${interactionId}`,
      { headers: { cookie } },
    ),
    "/oauth/authorize",
  );
  assert.equal(consentRedirect.status, 302);
  assert.match(consentRedirect.headers.get("location") as string, /consent/);

  const approved = await call(
    new Request("https://issuer.example/api/auth/oauth/authorize", {
      body: new URLSearchParams({
        decision: "approve",
        interaction_id: interactionId,
        scope: "invoice:read",
      }),
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    }),
    "/oauth/authorize",
  );
  assert.equal(approved.status, 302);
  const callback = new URL(approved.headers.get("location") as string);
  const code = callback.searchParams.get("code");
  assert.ok(code);
  assert.equal(callback.searchParams.get("state"), "state-route");
  assert.equal(callback.searchParams.get("iss"), "https://issuer.example");

  const exchanged = await call(
    new Request("https://issuer.example/api/auth/oauth/token", {
      body: new URLSearchParams({
        client_id: "client-route",
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: "https://client.example/callback",
        resource: "https://resource.example",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
    "/oauth/token",
  );
  assert.equal(exchanged.status, 200);
  const tokenBody = await json(exchanged);
  assert.equal(tokenBody.token_type, "Bearer");
  assert.equal(tokenBody.scope, "invoice:read");
  assert.ok(tokenBody.access_token);
  assert.ok(tokenBody.refresh_token);

  const refreshed = await call(
    new Request("https://issuer.example/api/auth/oauth/token", {
      body: new URLSearchParams({
        client_id: "client-route",
        grant_type: "refresh_token",
        refresh_token: String(tokenBody.refresh_token),
        resource: "https://resource.example",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
    "/oauth/token",
  );
  assert.equal(refreshed.status, 200);

  const revoked = await call(
    new Request("https://issuer.example/api/auth/oauth/revoke", {
      body: new URLSearchParams({
        client_id: "client-route",
        token: String((await json(refreshed)).refresh_token),
        token_type_hint: "refresh_token",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
    "/oauth/revoke",
  );
  assert.equal(revoked.status, 200);

  const metadata = await call(
    new Request(
      "https://issuer.example/api/auth/.well-known/oauth-authorization-server",
    ),
    "/.well-known/oauth-authorization-server",
  );
  assert.equal(metadata.status, 200);
  const metadataBody = await json(metadata);
  assert.equal(metadataBody.issuer, "https://issuer.example");
  assert.deepEqual(metadataBody.response_types_supported, ["code"]);
  assert.equal(
    metadataBody.token_endpoint,
    "https://issuer.example/api/auth/oauth/token",
  );
  assert.equal(
    metadataBody.jwks_uri,
    "https://issuer.example/api/auth/.well-known/jwks.json",
  );
});

test("OAuth authorize is rate limited before persisting an interaction", async () => {
  const stores = new MemoryAuthStores();
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      enabled: true,
      issuer: "https://issuer.example",
      resources: {
        "https://resource.example": {
          scopes: { "invoice:read": {} },
        },
      },
      signInUrl: "https://app.example/sign-in",
    },
    mode: "local",
    security: { trustedProxy: true },
    secret: "oauth-route-test-secret",
  });
  const deps = createRuntimeDependencies({
    config,
    hasher: testHasher(),
    stores,
  });
  const authStores = await deps.ensureReady();
  const oauthStores = await deps.getOAuthStores();
  await oauthStores.clients.create({
    clientName: "Limited client",
    id: "client-limit",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      await deps.oauthRateLimiter.consume("oauth:authorize:ip:203.0.113.10"),
      true,
    );
  }
  const router = createAuthRouter(deps);
  const verifier = "r".repeat(43);
  const authorizeUrl = new URL(
    "https://issuer.example/api/auth/oauth/authorize",
  );
  authorizeUrl.search = new URLSearchParams({
    client_id: "client-limit",
    code_challenge: await generateCodeChallenge(verifier),
    code_challenge_method: "S256",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "invoice:read",
    state: "state-limit",
  }).toString();
  const limited = await router.handleRoute(
    new Request(authorizeUrl, {
      headers: { "x-forwarded-for": "203.0.113.10" },
    }),
    "/oauth/authorize",
    authStores,
    new Headers(),
    "trace-oauth-limit",
  );
  assert.equal(limited.status, 429);
  const body = await json(limited);
  assert.equal(body.error, "temporarily_unavailable");

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      await deps.oauthRateLimiter.consume(
        "oauth:authorize:client:client-limit:unknown-ip",
      ),
      true,
    );
  }
  authorizeUrl.searchParams.set("state", "state-without-ip");
  const withoutIp = await router.handleRoute(
    new Request(authorizeUrl),
    "/oauth/authorize",
    authStores,
    new Headers(),
    "trace-oauth-without-ip",
  );
  assert.notEqual(withoutIp.status, 429);
});

test("OAuth refresh hooks reject before rotating the refresh token", async () => {
  const stores = new MemoryAuthStores();
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      enabled: true,
      issuer: "https://issuer.example",
      resources: {
        "https://resource.example": {
          scopes: { "invoice:read": {} },
        },
      },
    },
    mode: "local",
    secret: "oauth-refresh-hook-test-secret",
  });
  const deps = createRuntimeDependencies({
    config,
    hasher: testHasher(),
    hooks: {
      before: {
        "oauth.refresh.rotated": async () => {
          throw new Error("refresh hook rejected");
        },
      },
    },
    stores,
  });
  await deps.ensureReady();
  const oauthStores = await deps.getOAuthStores();
  const tokenKeyStore = await deps.getTokenKeyStore("https://issuer.example");
  await oauthStores.clients.create({
    clientName: "Hook client",
    id: "client-refresh-hook",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const familyId = "family-refresh-hook";
  const grant = await oauthStores.grants.authorize({
    clientId: "client-refresh-hook",
    organizationId: null,
    resource: "https://resource.example",
    scopes: ["invoice:read"],
    userId: "user-refresh-hook",
  });
  const refreshToken = "refresh-token-hook";
  const tokenHash = await hashOAuthSecret(refreshToken);
  await oauthStores.refreshTokens.create({
    clientId: "client-refresh-hook",
    expiresAt: new Date(Date.now() + 60_000),
    familyId,
    grantId: grant.id,
    id: "refresh-row-hook",
    resource: "https://resource.example",
    scopes: ["invoice:read"],
    tokenHash,
    userId: "user-refresh-hook",
  });
  const service = new OAuthAuthorizationServerService({
    config: config.authorizationServer,
    issuer: "https://issuer.example",
    keyStore: tokenKeyStore,
    signing: createTestOAuthSigning(config.authorizationServer, tokenKeyStore),
    stateSecret: config.secret as string,
    stores: oauthStores,
    userIsEligible: () => true,
  });

  await assert.rejects(
    deps.mutate({
      context: {
        actor: { kind: "system" },
        request: { method: "POST", path: "/oauth/token" },
        traceId: "trace-refresh-hook",
      },
      event: "oauth.refresh.rotated",
      execute: async (scope) => {
        assert.ok(scope.oauth);
        return service.withStores(scope.oauth).refreshMutation(
          {
            clientId: "client-refresh-hook",
            refreshToken,
            resource: "https://resource.example",
          },
          "rotated",
        );
      },
      input: {
        clientId: "client-refresh-hook",
        familyId,
        grantId: grant.id,
      },
      resultOf: (result) => ({
        familyId:
          result.kind === "rotated"
            ? result.response.familyId
            : result.familyId,
      }),
    }),
    /refresh hook rejected/,
  );
  const current = await oauthStores.refreshTokens.getByHash(tokenHash);
  assert.equal(current?.status, "active");
  assert.equal(
    (await oauthStores.refreshTokens.listFamily(familyId)).length,
    1,
  );
});

test("OAuth grant and client lifecycle emit Auth audit events", async () => {
  const events: string[] = [];
  const stores = new MemoryAuthStores();
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      consentUrl: "https://app.example/consent",
      enabled: true,
      issuer: "https://issuer.example",
      resources: {
        "https://resource.example": {
          scopes: { "invoice:read": {} },
        },
      },
      signInUrl: "https://app.example/sign-in",
    },
    mode: "local",
    secret: "oauth-route-test-secret",
  });
  const deps = createRuntimeDependencies({
    config,
    hasher: testHasher(),
    hooks: {
      after: {
        "oauth.client.disabled": () => {
          events.push("oauth.client.disabled");
        },
        "oauth.grant.authorized": () => {
          events.push("oauth.grant.authorized");
        },
        "oauth.grant.revoked": () => {
          events.push("oauth.grant.revoked");
        },
      },
    },
    stores,
  });
  const authStores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const call = (request: Request, path: string) =>
    router.handleRoute(
      request,
      path,
      authStores,
      new Headers(),
      "trace-oauth-audit",
    );
  const signUp = await call(
    new Request("https://issuer.example/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "oauth-audit@example.com",
        name: "OAuth User",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-up/email",
  );
  assert.equal(signUp.status, 200);
  const cookie = cookieOf(signUp);
  const oauthStores = await deps.getOAuthStores();
  await oauthStores.clients.create({
    clientName: "Audit client",
    id: "client-audit",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const verifier = "s".repeat(43);
  const authorizeUrl = new URL(
    "https://issuer.example/api/auth/oauth/authorize",
  );
  authorizeUrl.search = new URLSearchParams({
    client_id: "client-audit",
    code_challenge: await generateCodeChallenge(verifier),
    code_challenge_method: "S256",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "invoice:read",
    state: "state-audit",
  }).toString();
  const signInRedirect = await call(
    new Request(authorizeUrl),
    "/oauth/authorize",
  );
  const interactionId = new URL(
    signInRedirect.headers.get("location") as string,
  ).searchParams.get("interaction_id");
  assert.ok(interactionId);
  await call(
    new Request(
      `https://issuer.example/api/auth/oauth/authorize?interaction_id=${interactionId}`,
      { headers: { cookie } },
    ),
    "/oauth/authorize",
  );
  const approved = await call(
    new Request("https://issuer.example/api/auth/oauth/authorize", {
      body: new URLSearchParams({
        decision: "approve",
        interaction_id: interactionId,
      }),
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    }),
    "/oauth/authorize",
  );
  assert.equal(approved.status, 302);
  const grants = await oauthStores.grants.listForUser(
    (await authStores.listUsers())[0]?.id as string,
  );
  assert.equal(grants.length, 1);
  await call(
    new Request(
      `https://issuer.example/api/auth/authorization/grants/${grants[0]?.id}/revoke`,
      { headers: { cookie }, method: "POST" },
    ),
    `/authorization/grants/${grants[0]?.id}/revoke`,
  );
  await disableAuthorizationServerClient(
    {
      deps,
      headers: new Headers(),
      stores: authStores,
      traceId: "trace-oauth-audit",
    },
    "client-audit",
  );
  assert.deepEqual(events, [
    "oauth.grant.authorized",
    "oauth.grant.revoked",
    "oauth.client.disabled",
  ]);
});

test("OAuth authorization denial mutates through the canonical event", async () => {
  const events: string[] = [];
  const stores = new MemoryAuthStores();
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      consentUrl: "https://app.example/consent",
      enabled: true,
      issuer: "https://issuer.example",
      resources: {
        "https://resource.example": {
          scopes: { "invoice:read": {} },
        },
      },
      signInUrl: "https://app.example/sign-in",
    },
    mode: "local",
    secret: "oauth-route-test-secret",
  });
  const deps = createRuntimeDependencies({
    config,
    hasher: testHasher(),
    hooks: {
      after: {
        "oauth.authorization.denied": () => {
          events.push("oauth.authorization.denied");
        },
      },
    },
    stores,
  });
  const authStores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const call = (request: Request, path: string) =>
    router.handleRoute(
      request,
      path,
      authStores,
      new Headers(),
      "trace-oauth-deny",
    );
  const signUp = await call(
    new Request("https://issuer.example/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "oauth-deny@example.com",
        name: "OAuth User",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-up/email",
  );
  assert.equal(signUp.status, 200);
  const cookie = cookieOf(signUp);
  const oauthStores = await deps.getOAuthStores();
  await oauthStores.clients.create({
    clientName: "Deny client",
    id: "client-deny",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const authorizeUrl = new URL(
    "https://issuer.example/api/auth/oauth/authorize",
  );
  authorizeUrl.search = new URLSearchParams({
    client_id: "client-deny",
    code_challenge: await generateCodeChallenge("d".repeat(43)),
    code_challenge_method: "S256",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "invoice:read",
    state: "state-deny",
  }).toString();
  const signInRedirect = await call(
    new Request(authorizeUrl),
    "/oauth/authorize",
  );
  const interactionId = new URL(
    signInRedirect.headers.get("location") as string,
  ).searchParams.get("interaction_id");
  assert.ok(interactionId);
  await call(
    new Request(
      `https://issuer.example/api/auth/oauth/authorize?interaction_id=${interactionId}`,
      { headers: { cookie } },
    ),
    "/oauth/authorize",
  );
  const denied = await call(
    new Request("https://issuer.example/api/auth/oauth/authorize", {
      body: new URLSearchParams({
        decision: "deny",
        interaction_id: interactionId,
      }),
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    }),
    "/oauth/authorize",
  );
  assert.equal(denied.status, 302);
  const location = new URL(denied.headers.get("location") as string);
  assert.equal(location.searchParams.get("error"), "access_denied");
  const interaction =
    await oauthStores.authorizationRequests.get(interactionId);
  assert.equal(interaction?.status, "denied");
  assert.deepEqual(events, ["oauth.authorization.denied"]);
});
