import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  assertCodeVerifier,
  assertClientScopes,
  assertRedirectUri,
  assertS256CodeChallenge,
  isScopeSubset,
  normalizeRegisteredRedirectUri,
  normalizeResourceUri,
  parseScopes,
  scopesToString,
  verifyCodeVerifier,
} from "../../src/auth/authorization-server/index.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { readFormBody } from "../../src/auth/local/security.ts";

test("OAuth scopes canonicalize and reject invalid names", () => {
  assert.deepEqual(parseScopes("write read read"), ["read", "write"]);
  assert.equal(scopesToString(["write", "read"]), "read write");
  assert.throws(() => parseScopes('read"write'), /invalid name/);
});

test("OAuth scope checks require client and resource intersection", () => {
  const client = {
    clientName: "Test",
    clientType: "public" as const,
    clientUrl: null,
    createdAt: new Date(),
    grantType: "authorization_code" as const,
    id: "client",
    isActive: true,
    metadata: {},
    redirectUris: [],
    registrationKind: "pre-registered" as const,
    resourceUris: [],
    responseType: "code" as const,
    scopes: ["read"],
    tokenEndpointAuthMethod: "none" as const,
    updatedAt: new Date(),
  };
  assertClientScopes(client, { read: {} }, ["read"]);
  assert.throws(
    () => assertClientScopes(client, { read: {} }, ["write"]),
    /not allowed/
  );
  assert.equal(isScopeSubset(["read"], ["read", "write"]), true);
  assert.equal(isScopeSubset(["write"], ["read"]), false);
});

test("OAuth resources reject fragments and canonicalize trailing slash", () => {
  assert.equal(
    normalizeResourceUri("https://resource.example/api/"),
    "https://resource.example/api"
  );
  assert.throws(
    () => normalizeResourceUri("https://resource.example/api#fragment"),
    /forbidden/
  );
});

test("OAuth redirects are exact except native loopback ports", () => {
  assert.throws(
    () => normalizeRegisteredRedirectUri("http://client.example/callback"),
    /HTTPS/
  );
  assertRedirectUri({
    clientType: "public",
    registeredUris: ["https://client.example/callback"],
    requestedUri: "https://client.example/callback",
  });
  assert.throws(
    () =>
      assertRedirectUri({
        clientType: "public",
        registeredUris: ["https://client.example/callback"],
        requestedUri: "https://client.example.evil/callback",
      }),
    /does not match/
  );
  assertRedirectUri({
    clientType: "public",
    registeredUris: ["http://127.0.0.1:43110/callback"],
    requestedUri: "http://127.0.0.1:53218/callback",
  });
  assert.throws(
    () =>
      assertRedirectUri({
        clientType: "public",
        registeredUris: ["http://127.0.0.1:43110/callback"],
        requestedUri: "http://127.0.0.1:53218/other",
      }),
    /does not match/
  );
});

test("OAuth PKCE accepts S256 only", async () => {
  const verifier = "a".repeat(43);
  const challenge = await generateCodeChallenge(verifier);
  assertS256CodeChallenge(challenge, "S256");
  assertCodeVerifier(verifier);
  await verifyCodeVerifier(verifier, challenge, "S256");
  await assert.rejects(
    verifyCodeVerifier("b".repeat(43), challenge, "S256"),
    /invalid or expired/
  );
  assert.throws(
    () => assertS256CodeChallenge(challenge, "plain"),
    /must be S256/
  );
});

test("OAuth form parsing rejects duplicate scalar parameters", async () => {
  const request = new Request("https://issuer.example/oauth/token", {
    body: "grant_type=authorization_code&grant_type=refresh_token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  await assert.rejects(readFormBody(request, 1024), /must be supplied once/);
});
