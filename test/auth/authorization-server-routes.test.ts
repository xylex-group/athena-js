import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { decodeJwt, decodeProtectedHeader } from "jose";

import { hashOAuthSecret } from "../../src/auth/authorization-server/index.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import {
  disableAuthorizationServerClient,
  queryOpaqueValue,
} from "../../src/auth/local/authorization-server/routes.ts";
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

test("OIDC nonce query values remain opaque", () => {
  const url = new URL("https://issuer.example/oauth/authorize?nonce=%20%20x%20%20");
  assert.equal(queryOpaqueValue(url, "nonce"), "  x  ");
  assert.throws(() => queryOpaqueValue(new URL(`${url}&nonce=second`), "nonce"));
});


test("OIDC-only tokens use the pathful UserInfo resource for GET and POST", async () => {
  const issuer = "https://issuer.example";
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      consentUrl: "https://app.example/consent",
      enabled: true,
      issuer,
      signInUrl: "https://app.example/sign-in",
    },
    mode: "local",
    secret: "oidc-only-route-test-secret",
  });
  const deps = createRuntimeDependencies({
    config,
    hasher: testHasher(),
    stores: new MemoryAuthStores(),
  });
  const stores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const call = (request: Request, path: string) =>
    router.handleRoute(request, path, stores, new Headers(), "trace-oidc-only");

  try {
    const signUp = await call(
      new Request(`${issuer}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: "oidc-only@example.com",
          name: "OIDC Only",
          password: "Password123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      "/sign-up/email"
    );
    assert.equal(signUp.status, 200);
    const cookie = cookieOf(signUp);
    const oauth = await deps.getOAuthStores();
    await oauth.clients.create({
      clientName: "OIDC only client",
      id: "oidc-only-client",
      redirectUris: ["https://client.example/callback"],
      resourceUris: [],
      scopes: ["openid", "profile", "email"],
    });
    const verifier = "u".repeat(43);
    const authorize = new URL(`${issuer}/api/auth/oauth/authorize`);
    authorize.search = new URLSearchParams({
      client_id: "oidc-only-client",
      code_challenge: await generateCodeChallenge(verifier),
      code_challenge_method: "S256",
      redirect_uri: "https://client.example/callback",
      response_type: "code",
      scope: "openid profile email",
      state: "oidc-only-state",
    }).toString();
    const start = await call(new Request(authorize, { headers: { cookie } }), "/oauth/authorize");
    assert.equal(start.status, 302);
    const authorizeAgain = await call(
      new Request(start.headers.get("location") as string, { headers: { cookie } }),
      "/oauth/authorize"
    );
    assert.equal(authorizeAgain.status, 302);
    const interactionId = new URL(authorizeAgain.headers.get("location") as string).searchParams.get("interaction_id");
    assert.ok(interactionId);
    const approved = await call(
      new Request(`${issuer}/api/auth/oauth/authorize`, {
        body: new URLSearchParams({ decision: "approve", interaction_id: interactionId }),
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      "/oauth/authorize"
    );
    assert.equal(approved.status, 302);
    const code = new URL(approved.headers.get("location") as string).searchParams.get("code");
    assert.ok(code);
    const exchanged = await call(
      new Request(`${issuer}/api/auth/oauth/token`, {
        body: new URLSearchParams({
          client_id: "oidc-only-client",
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: "https://client.example/callback",
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      "/oauth/token"
    );
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    const accessToken = String((await json(exchanged)).access_token);
    for (const method of ["GET", "POST"] as const) {
      const userInfo = await call(
        new Request(`${issuer}/api/auth/userinfo`, {
          headers: { authorization: `Bearer ${accessToken}` },
          method,
        }),
        "/userinfo"
      );
      assert.equal(userInfo.status, 200, await userInfo.clone().text());
      assert.equal((await json(userInfo)).sub, (await stores.listUsers())[0]?.id);
    }
  } finally {
    await deps.close();
  }
});test("OAuth routes complete hosted sign-in, consent, code, token, refresh, and metadata", async () => {
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
    scopes: ["email", "invoice:read", "invoice:write", "openid", "profile"],
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
    nonce: " route-oidc-nonce ",
    scope: "openid profile invoice:read invoice:write",
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
  const userId = (await authStores.listUsers())[0]?.id;
  assert.ok(userId);
  await oauthStores.grants.authorize({
    clientId: "client-route",
    identityScopes: ["email", "openid", "profile"],
    organizationId: null,
    resource: "https://resource.example",
    scopes: ["invoice:read"],
    userId,
  });

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
  assert.equal(tokenBody.scope, "invoice:read openid profile");
  assert.ok(tokenBody.access_token);
  assert.equal(typeof tokenBody.id_token, "string");
  const idTokenClaims = decodeJwt(tokenBody.id_token as string);
  assert.equal(decodeProtectedHeader(tokenBody.id_token as string).alg, "RS256");
  assert.equal(idTokenClaims.iss, "https://issuer.example");
  assert.equal(idTokenClaims.aud, "client-route");
  assert.equal(idTokenClaims.nonce, " route-oidc-nonce ");
  assert.equal(idTokenClaims.sub, (await authStores.listUsers())[0]?.id);
  assert.equal(typeof idTokenClaims.auth_time, "number");
  assert.ok(Array.isArray(idTokenClaims.amr));
  const accessTokenClaims = decodeJwt(tokenBody.access_token as string);
  assert.deepEqual(accessTokenClaims.athena_identity_scopes, ["openid", "profile"]);
  assert.equal(accessTokenClaims.scope, "invoice:read");
  assert.equal(idTokenClaims.name, "OAuth User");
  assert.equal(idTokenClaims.email, undefined);
  assert.equal(idTokenClaims.athena_organization_id, undefined);
  const verifiedIdToken = await createTestOAuthSigning(
    config.authorizationServer,
    await deps.getTokenKeyStore()
  ).verifyAthenaToken({
    audience: "client-route",
    token: tokenBody.id_token as string,
  });
  assert.equal(verifiedIdToken?.nonce, " route-oidc-nonce ");
  const userInfo = await call(
    new Request("https://issuer.example/api/auth/userinfo", {
      headers: { authorization: `Bearer ${tokenBody.access_token as string}` },
    }),
    "/userinfo",
  );
  assert.equal(userInfo.status, 200);
  assert.deepEqual(await json(userInfo), {
    name: "OAuth User",
    sub: userId,
  });
  const userInfoPost = await call(
    new Request("https://issuer.example/api/auth/userinfo", {
      headers: { authorization: `Bearer ${tokenBody.access_token as string}` },
      method: "POST",
    }),
    "/userinfo",
  );
  assert.equal(userInfoPost.status, 200);
  assert.deepEqual(await json(userInfoPost), { name: "OAuth User", sub: userId });
  const narrowedRequest = await oauthStores.authorizationRequests.create({
    clientId: "client-route",
    codeChallenge: await generateCodeChallenge(verifier),
    codeChallengeMethod: "S256",
    expiresAt: new Date(Date.now() + 60_000),
    id: crypto.randomUUID(),
    identityScopes: ["openid"],
    redirectUri: "https://client.example/callback",
    requestHash: crypto.randomUUID(),
    requestedScopes: ["invoice:read"],
    resource: "https://resource.example",
    stateCiphertext: "unused-state",
  });
  await oauthStores.completeAuthorization({
    authenticatedAt: new Date(),
    authenticationMethods: ["password"],
    clientId: "client-route",
    codeChallenge: narrowedRequest.codeChallenge,
    codeChallengeMethod: "S256",
    codeHash: await hashOAuthSecret(crypto.randomUUID()),
    expiresAt: new Date(Date.now() + 60_000),
    grantId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    identityScopes: ["openid"],
    organizationId: null,
    redirectUri: narrowedRequest.redirectUri,
    requestId: narrowedRequest.id,
    resource: narrowedRequest.resource,
    scopes: ["invoice:read"],
    userId,
  });
  const narrowedUserInfo = await call(
    new Request("https://issuer.example/api/auth/userinfo", {
      headers: { authorization: `Bearer ${tokenBody.access_token as string}` },
    }),
    "/userinfo",
  );
  assert.deepEqual(await json(narrowedUserInfo), { sub: userId });
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
  const refreshBody = await json(refreshed);
  assert.equal(refreshBody.scope, "invoice:read openid");
  assert.deepEqual(
    decodeJwt(refreshBody.access_token as string).athena_identity_scopes,
    ["openid"]
  );

  const silentAuthorizeUrl = new URL(
    "https://issuer.example/api/auth/oauth/authorize",
  );
  silentAuthorizeUrl.search = new URLSearchParams({
    client_id: "client-route",
    code_challenge: await generateCodeChallenge("s".repeat(43)),
    code_challenge_method: "S256",
    prompt: "none",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "openid invoice:read",
    state: "state-silent",
  }).toString();
  const silentAuthorizeStart = await call(
    new Request(silentAuthorizeUrl, { headers: { cookie } }),
    "/oauth/authorize",
  );
  assert.equal(silentAuthorizeStart.status, 302);
  const silentAuthorize = await call(
    new Request(silentAuthorizeStart.headers.get("location") as string, {
      headers: { cookie },
    }),
    "/oauth/authorize",
  );
  assert.equal(silentAuthorize.status, 302);
  const silentCallback = new URL(
    silentAuthorize.headers.get("location") as string,
  );
  assert.ok(silentCallback.searchParams.get("code"), silentCallback.toString());
  assert.equal(silentCallback.searchParams.get("state"), "state-silent");

  const revoked = await call(
    new Request("https://issuer.example/api/auth/oauth/revoke", {
      body: new URLSearchParams({
        client_id: "client-route",
        token: String(refreshBody.refresh_token),
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

  const oidcDiscovery = await call(
    new Request("https://issuer.example/api/auth/.well-known/openid-configuration"),
    "/.well-known/openid-configuration",
  );
  const oidcDocument = await json(oidcDiscovery);
  assert.equal(oidcDiscovery.status, 200);
  assert.equal(
    (oidcDocument.claims_supported as string[]).includes(
      "athena_organization_id"
    ),
    false
  );
  assert.equal(
    oidcDocument.userinfo_endpoint,
    "https://issuer.example/api/auth/userinfo",
  );
  assert.deepEqual(oidcDocument.response_types_supported, ["code"]);
  assert.deepEqual(oidcDocument.id_token_signing_alg_values_supported, ["RS256"]);
  assert.equal(oidcDocument.request_uri_parameter_supported, false);
  assert.deepEqual(oidcDocument.prompt_values_supported, [
    "none",
    "login",
    "consent",
  ]);
  assert.deepEqual(oidcDocument.scopes_supported, [
    "email",
    "invoice:read",
    "invoice:write",
    "openid",
    "profile",
  ]);
  assert.equal(
    metadataBody.token_endpoint,
    "https://issuer.example/api/auth/oauth/token",
  );
  assert.equal(
    metadataBody.jwks_uri,
    "https://issuer.example/api/auth/.well-known/jwks.json",
  );
});

test("authorization rejects OIDC interaction parameters unless openid is requested", async () => {
  const deps = createRuntimeDependencies({
    config: normalizeAthenaAuthConfig({
      authorizationServer: {
        enabled: true,
        issuer: "https://issuer.example",
        resources: {
          "https://resource.example": { scopes: { "invoice:read": {} } },
        },
        signInUrl: "https://app.example/sign-in",
      },
      mode: "local",
      secret: "oauth-route-test-secret",
    }),
    hasher: testHasher(),
    stores: new MemoryAuthStores(),
  });
  const stores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const oauthStores = await deps.getOAuthStores();
  await oauthStores.clients.create({
    clientName: "OIDC parameter client",
    id: "client-oidc-parameters",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read"],
  });
  const url = new URL("https://issuer.example/api/auth/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: "client-oidc-parameters",
    code_challenge: await generateCodeChallenge("p".repeat(43)),
    code_challenge_method: "S256",
    max_age: "30",
    nonce: "request-nonce",
    prompt: "none",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "invoice:read",
    state: "oidc-parameters",
  }).toString();
  const response = await router.handleRoute(
    new Request(url),
    "/oauth/authorize",
    stores,
    new Headers(),
    "trace-oidc-parameters",
  );
  assert.equal(response?.status, 302);
  const redirect = new URL(response?.headers.get("location") as string);
  assert.equal(redirect.searchParams.get("error"), "invalid_request");
});

test("OIDC prompt and max_age enforce authentication without breaking silent errors", async () => {
  const issuer = "https://issuer.example";
  const deps = createRuntimeDependencies({
    config: normalizeAthenaAuthConfig({
      authorizationServer: {
        enabled: true,
        issuer,
        resources: {
          "https://resource.example": { scopes: { "invoice:read": {} } },
        },
        signInUrl: "https://app.example/sign-in",
      },
      mode: "local",
      secret: "oauth-route-test-secret",
    }),
    hasher: testHasher(),
    stores: new MemoryAuthStores(),
  });
  const stores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const call = (request: Request, path: string) =>
    router.handleRoute(request, path, stores, new Headers(), "trace-oidc-prompt");
  const signup = await call(
    new Request(`${issuer}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "prompt-user@example.com",
        name: "Prompt User",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-up/email"
  );
  const cookie = cookieOf(signup);
  const oauthStores = await deps.getOAuthStores();
  await oauthStores.clients.create({
    clientName: "Prompt client",
    id: "client-prompt",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://resource.example"],
    scopes: ["invoice:read", "openid"],
  });
  const baseParams = {
    client_id: "client-prompt",
    code_challenge: await generateCodeChallenge("q".repeat(43)),
    code_challenge_method: "S256",
    redirect_uri: "https://client.example/callback",
    resource: "https://resource.example",
    response_type: "code",
    scope: "openid invoice:read",
    state: "prompt-state",
  };
  const silentUrl = new URL(`${issuer}/api/auth/oauth/authorize`);
  silentUrl.search = new URLSearchParams({
    ...baseParams,
    prompt: "none",
  }).toString();
  const silent = await call(new Request(silentUrl), "/oauth/authorize");
  assert.equal(silent.status, 302);
  assert.equal(
    new URL(silent.headers.get("location") as string).searchParams.get("error"),
    "login_required"
  );

  const consentRequiredUrl = new URL(`${issuer}/api/auth/oauth/authorize`);
  consentRequiredUrl.search = new URLSearchParams({
    ...baseParams,
    prompt: "none",
  }).toString();
  const consentRequired = await call(
    new Request(consentRequiredUrl, { headers: { cookie } }),
    "/oauth/authorize"
  );
  assert.equal(consentRequired.status, 302);
  assert.equal(
    new URL(consentRequired.headers.get("location") as string).searchParams.get("error"),
    "consent_required"
  );

  const maxAgeZeroUrl = new URL(`${issuer}/api/auth/oauth/authorize`);
  maxAgeZeroUrl.search = new URLSearchParams({
    ...baseParams,
    max_age: "0",
    state: "max-age-zero-state",
  }).toString();
  const maxAgeZeroStart = await call(
    new Request(maxAgeZeroUrl, { headers: { cookie } }),
    "/oauth/authorize"
  );
  assert.equal(maxAgeZeroStart.status, 302);
  const loginRedirect = new URL(maxAgeZeroStart.headers.get("location") as string);
  const maxAgeZeroInteraction = loginRedirect.searchParams.get("interaction_id");
  assert.ok(maxAgeZeroInteraction);
  const reauthenticated = await call(
    new Request(`${issuer}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: "prompt-user@example.com", password: "Password123!" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-in/email"
  );
  assert.equal(reauthenticated.status, 200, await reauthenticated.clone().text());
  const freshCookie = cookieOf(reauthenticated);
  assert.ok(freshCookie);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const resumed = await call(
    new Request(
      `${issuer}/api/auth/oauth/authorize?interaction_id=${encodeURIComponent(maxAgeZeroInteraction)}`,
      { headers: { cookie: freshCookie } }
    ),
    "/oauth/authorize"
  );
  assert.equal(resumed.status, 200, await resumed.clone().text());
  assert.equal((await json(resumed)).interactionId, maxAgeZeroInteraction);
  const forcedLoginUrl = new URL(`${issuer}/api/auth/oauth/authorize`);
  forcedLoginUrl.search = new URLSearchParams({
    ...baseParams,
    max_age: "0",
    prompt: "login",
  }).toString();
  const forcedLogin = await call(
    new Request(forcedLoginUrl, { headers: { cookie } }),
    "/oauth/authorize"
  );
  assert.equal(forcedLogin.status, 302);
  const signIn = new URL(forcedLogin.headers.get("location") as string);
  assert.equal(signIn.origin, "https://app.example");
  assert.equal(signIn.searchParams.get("prompt"), "login");
  assert.ok(signIn.searchParams.get("interaction_id"));
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
    identityScopes: [],
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
