import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { decodeProtectedHeader, SignJWT } from "jose";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { createAccessTokenClaims } from "../../src/auth/authorization-server/index.ts";
import { createMemoryOAuthAuthorizationServerStores } from "../../src/auth/local/authorization-server/memory-stores.ts";
import {
  ensureActiveSigningKey,
  MemoryTokenKeyStore,
  rotateSigningKey,
} from "../../src/auth/local/token-key-store.ts";
import {
  createOAuthRuntimeJwtVerifier,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
} from "../../src/runtime/authority/index.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";
test("RS256 rotation keeps old ID tokens verifiable and signs new tokens with the new kid", async () => {
  const issuer = "https://issuer.example";
  const keyStore = new MemoryTokenKeyStore();
  const config = normalizeAthenaAuthConfig({
    authorizationServer: { enabled: true, issuer },
  }).authorizationServer;
  const signing = createTestOAuthSigning(config, keyStore);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    amr: ["password"],
    aud: "client-1",
    auth_time: now,
    exp: now + 300,
    iat: now,
    iss: issuer,
    sub: "user-1",
  };

  const oldToken = await signing.signOidcIdToken(claims);
  const oldKid = decodeProtectedHeader(oldToken).kid;
  const rotated = await rotateSigningKey(keyStore, "RS256");
  const newToken = await signing.signOidcIdToken(claims);

  assert.equal(rotated.algorithm, "RS256");
  assert.notEqual(rotated.kid, oldKid);
  assert.equal(decodeProtectedHeader(newToken).kid, rotated.kid);
  assert.equal((await signing.verifyAthenaToken({ token: oldToken })).sub, "user-1");
  assert.equal((await signing.verifyAthenaToken({ token: newToken })).sub, "user-1");
});

const principal = {
  authenticated: true,
  claims: { grantId: "grant-1", resource: "https://resource.example" },
  grants: [],
  rights: ["invoice.read"],
  userId: "user-1",
} as const;

test("JWT bearer resolves through the canonical jwt authority", async () => {
  const material = normalizeAthenaRuntimeAuth(
    {
      mode: "jwt",
      verifyToken: async () => ({
        authority: "jwt" as const,
        principal,
      }),
    },
    "authenticated",
  );
  const result = await resolveAthenaRuntimePrincipal(
    material,
    "authenticated",
    {
      headers: {
        authorization: "Bearer header.payload.signature",
      },
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.resolved.authority, "jwt");
    assert.equal(result.resolved.principal.userId, "user-1");
  }
});

test("JWT verification failure never falls back to session lookup", async () => {
  let sessions = 0;
  const material = normalizeAthenaRuntimeAuth(
    {
      jwtVerifier: async () => {
        throw new Error("invalid");
      },
      lookupSession: async () => {
        sessions += 1;
        return {
          session: {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60_000),
          },
          user: { id: "session-user" },
        };
      },
      mode: "athena-session",
    },
    "authenticated",
  );
  const result = await resolveAthenaRuntimePrincipal(
    material,
    "authenticated",
    {
      headers: {
        authorization: "Bearer header.payload.signature",
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(sessions, 0);
});

test("JWT mode rejects opaque bearer credentials through the same authority", async () => {
  const material = normalizeAthenaRuntimeAuth(
    { mode: "jwt", verifyToken: async () => null },
    "authenticated",
  );
  const result = await resolveAthenaRuntimePrincipal(
    material,
    "authenticated",
    { headers: { authorization: "Bearer opaque-session-token" } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "ATHENA_AUTH_INVALID_SESSION");
  }
});

test("real OAuth verifier feeds the canonical jwt authority", async () => {
  const issuer = "https://issuer.example";
  const resource = "https://resource.example";
  const stores = createMemoryOAuthAuthorizationServerStores();
  const client = await stores.clients.create({
    clientName: "Authority test",
    id: "authority-client",
    redirectUris: ["https://client.example/callback"],
    resourceUris: [resource],
    scopes: ["invoice:read"],
  });
  const grant = await stores.grants.authorize({
    clientId: client.id,
    organizationId: null,
    resource,
    scopes: ["invoice:read"],
    userId: "user-1",
  });
  const keyStore = new MemoryTokenKeyStore();
  const signing = await ensureActiveSigningKey(keyStore);
  const claims = createAccessTokenClaims({
    clientId: client.id,
    grantId: grant.id,
    issuer,
    resource,
    scopes: ["invoice:read"],
    subject: "user-1",
    ttlSeconds: 600,
  });
  const token = await new SignJWT({
    athena_grant_id: claims.athena_grant_id,
    client_id: claims.client_id,
    scope: claims.scope,
  })
    .setProtectedHeader({ alg: "ES256", kid: signing.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(claims.sub)
    .setAudience(resource)
    .setIssuedAt(claims.iat)
    .setNotBefore(claims.nbf)
    .setExpirationTime(claims.exp)
    .setJti(claims.jti)
    .sign(signing.privateKey);
  const verifyToken = createOAuthRuntimeJwtVerifier({
    issuer,
    keyStore,
    resource,
    resolvePrincipal: ({ userId }) => ({
      authenticated: true,
      grants: [],
      rights: [],
      userId,
    }),
    stores,
  });
  const material = normalizeAthenaRuntimeAuth(
    { mode: "jwt", verifyToken },
    "authenticated",
  );
  const result = await resolveAthenaRuntimePrincipal(
    material,
    "authenticated",
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.resolved.authority, "jwt");
    assert.equal(result.resolved.principal.userId, "user-1");
  }

  await stores.grants.revoke({
    grantId: grant.id,
    reason: "user_revocation",
    revokedBy: "user-1",
  });
  const revoked = await resolveAthenaRuntimePrincipal(
    material,
    "authenticated",
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(revoked.ok, false);
});

test("OAuth verifier with signing authority lists verification keys once", async () => {
  const issuer = "https://issuer.example";
  const resource = "https://resource.example";
  const stores = createMemoryOAuthAuthorizationServerStores();
  const client = await stores.clients.create({
    clientName: "Once",
    id: "authority-once",
    redirectUris: ["https://client.example/callback"],
    resourceUris: [resource],
    scopes: ["invoice:read"],
  });
  const grant = await stores.grants.authorize({
    clientId: client.id,
    organizationId: null,
    resource,
    scopes: ["invoice:read"],
    userId: "user-1",
  });
  class CountingTokenKeyStore extends MemoryTokenKeyStore {
    lists = 0;
    override listVerificationKeys(now?: Date) {
      this.lists += 1;
      return super.listVerificationKeys(now);
    }
  }
  const keyStore = new CountingTokenKeyStore();
  const signingKey = await ensureActiveSigningKey(keyStore);
  const claims = createAccessTokenClaims({
    clientId: client.id,
    grantId: grant.id,
    issuer,
    resource,
    scopes: ["invoice:read"],
    subject: "user-1",
    ttlSeconds: 600,
  });
  const token = await new SignJWT({
    athena_grant_id: claims.athena_grant_id,
    client_id: claims.client_id,
    scope: claims.scope,
  })
    .setProtectedHeader({ alg: "ES256", kid: signingKey.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(claims.sub)
    .setAudience(resource)
    .setIssuedAt(claims.iat)
    .setNotBefore(claims.nbf)
    .setExpirationTime(claims.exp)
    .setJti(claims.jti)
    .sign(signingKey.privateKey);
  const signing = createTestOAuthSigning(
    {
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 90,
      authorizationEndpoint: `${issuer}/oauth/authorize`,
      authorizationRequestTtlSeconds: 600,
      consentUrl: null,
      enabled: true,
      issueRefreshTokens: true,
      issuer,
      refreshTokenTtlSeconds: 86_400,
      resources: {},
      signInUrl: null,
    },
    keyStore,
  );
  keyStore.lists = 0;
  const verifyToken = createOAuthRuntimeJwtVerifier({
    issuer,
    keyStore,
    resource,
    resolvePrincipal: ({ userId }) => ({
      authenticated: true,
      grants: [],
      rights: [],
      userId,
    }),
    signing,
    stores,
  });
  const material = normalizeAthenaRuntimeAuth(
    { mode: "jwt", verifyToken },
    "authenticated",
  );
  const result = await resolveAthenaRuntimePrincipal(
    material,
    "authenticated",
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(result.ok, true);
  assert.equal(keyStore.lists, 1);
});
