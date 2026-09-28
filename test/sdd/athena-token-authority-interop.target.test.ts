/**
 * Persistent JWT issuer interoperability: issue → OIDC → JWKS → verify,
 * restart (same active key), rotation (old token remains verifiable).
 */
import { strict as assert } from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  type JWK,
  jwtVerify,
} from "jose";

import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import {
  getOrCreateProcessTokenKeyStore,
  resetProcessTokenKeyStores,
  rotateSigningKey,
} from "../../src/auth/local/token-key-store.ts";

const ORIGIN = "http://issuer.athena.test";
const TOKEN_PATH = `${ORIGIN}/api/auth/token`;

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

function createRuntime() {
  return createAthenaAuthRuntime({
    app: { url: ORIGIN },
    autoMigrate: false,
    hasher: createTestHasher(),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function cookieOf(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [];
  if (cookies.length > 0) {
    return cookies
      .map((entry) => entry.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
  }
  const single = response.headers.get("set-cookie");
  return single ? (single.split(";", 1)[0] ?? "") : "";
}

async function signUp(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email: string
): Promise<string> {
  const response = await runtime.handle(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email,
        name: "Issuer",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  return cookieOf(response);
}

async function issueToken(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  cookie: string,
  expiresIn = 900
): Promise<{ kid: string; token: string }> {
  const response = await runtime.handle(
    new Request(TOKEN_PATH, {
      body: JSON.stringify({ audience: "athena", expiresIn }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(typeof body.token, "string");
  assert.equal(typeof body.kid, "string");
  return { kid: String(body.kid), token: String(body.token) };
}

async function fetchJson(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  path: string
): Promise<Record<string, unknown>> {
  const response = await runtime.handle(new Request(`${ORIGIN}${path}`));
  assert.equal(response.status, 200);
  return json(response);
}

async function verifyWithJwks(
  token: string,
  jwks: { keys?: JWK[] },
  kid: string
): Promise<void> {
  const key = (jwks.keys ?? []).find((entry) => entry.kid === kid);
  assert.ok(key, `JWKS must contain kid ${kid}`);
  assert.equal(key.d, undefined, "public JWKS must not include private d");
  const cryptoKey = await importJWK(key, "ES256");
  await jwtVerify(token, cryptoKey, {
    audience: "athena",
    issuer: ORIGIN,
  });
}

before(() => {
  resetProcessTokenKeyStores();
});

after(() => {
  resetProcessTokenKeyStores();
});

test("issue Athena JWT → OpenID metadata → jwks_uri → kid → signature", async () => {
  const runtime = createRuntime();
  try {
    const cookie = await signUp(runtime, "jwt-1@example.com");
    const issued = await issueToken(runtime, cookie);
    const header = decodeProtectedHeader(issued.token);
    const claims = decodeJwt(issued.token);
    assert.equal(header.kid, issued.kid);
    assert.equal(claims.iss, ORIGIN);
    assert.deepEqual(claims.aud, ["athena"]);

    const oidc = await fetchJson(
      runtime,
      "/api/auth/.well-known/openid-configuration"
    );
    assert.equal(oidc.issuer, ORIGIN);
    assert.equal(oidc.jwks_uri, `${ORIGIN}/api/auth/.well-known/jwks.json`);
    assert.equal(Array.isArray(oidc.grant_types_supported), false);

    const jwksResponse = await runtime.handle(
      new Request(String(oidc.jwks_uri))
    );
    assert.equal(jwksResponse.status, 200);
    const jwks = await json(jwksResponse);
    await verifyWithJwks(issued.token, jwks as { keys?: JWK[] }, issued.kid);
  } finally {
    await runtime.close();
  }
});

test("restart runtime keeps the same active key authority", async () => {
  const first = createRuntime();
  let issued: { kid: string; token: string };
  try {
    const cookie = await signUp(first, "jwt-restart@example.com");
    issued = await issueToken(first, cookie);
  } finally {
    await first.close();
  }

  const second = createRuntime();
  try {
    const jwks = await fetchJson(second, "/api/auth/.well-known/jwks.json");
    const keys = (jwks.keys as JWK[] | undefined) ?? [];
    const active = keys.find((entry) => entry.kid === issued.kid);
    assert.ok(active, "restart must serve the same active kid");
    await verifyWithJwks(issued.token, jwks as { keys?: JWK[] }, issued.kid);
  } finally {
    await second.close();
  }
});

test("rotation: new key active, old key retiring, old token verifiable", async () => {
  const runtime = createRuntime();
  try {
    const cookie = await signUp(runtime, "jwt-rotate@example.com");
    const old = await issueToken(runtime, cookie);
    const store = getOrCreateProcessTokenKeyStore(ORIGIN);
    const rotated = await rotateSigningKey(store);
    assert.notEqual(rotated.kid, old.kid);

    const next = await issueToken(runtime, cookie);
    assert.equal(next.kid, rotated.kid);

    const jwks = await fetchJson(runtime, "/api/auth/.well-known/jwks.json");
    const keys = (jwks.keys as JWK[] | undefined) ?? [];
    assert.ok(keys.some((entry) => entry.kid === old.kid));
    assert.ok(keys.some((entry) => entry.kid === rotated.kid));
    await verifyWithJwks(old.token, jwks as { keys?: JWK[] }, old.kid);
    await verifyWithJwks(next.token, jwks as { keys?: JWK[] }, next.kid);
  } finally {
    await runtime.close();
  }
});
