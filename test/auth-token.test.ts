import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { createAuthModule } from "../src/auth/client.ts";
import {
  createAthenaAuthTokenProvider,
  decodeJwtExpSeconds,
  tokenNeedsRefresh,
} from "../src/auth/token-provider.ts";
import type { AthenaAuthResult, AthenaAuthToken } from "../src/auth/types.ts";

function encodeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "k1" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      aud: "neon",
      exp,
      iss: "https://auth.example.com",
      sub: "user-1",
    })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

function tokenResult(exp: number): AthenaAuthResult<AthenaAuthToken> {
  const token = encodeJwt(exp);
  const issued: AthenaAuthToken = {
    audience: ["neon"],
    expiresAt: new Date(exp * 1000).toISOString(),
    expiresIn: 900,
    issuer: "https://auth.example.com",
    kid: "k1",
    token,
    tokenType: "Bearer",
  };
  return { data: issued, error: null, ok: true, raw: issued, status: 200 };
}

test("getToken posts /token and does not reuse get-access-token", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ body: String(init?.body ?? ""), url });
    return new Response(
      JSON.stringify({
        audience: ["neon"],
        expiresAt: "2026-08-15T21:00:00Z",
        expiresIn: 900,
        issuer: "https://auth.example.com",
        kid: "athena-test",
        token: "a.b.c",
        tokenType: "Bearer",
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const result = await client.getToken({ audience: "neon" });
    assert.equal(result.ok, true);
    assert.equal(result.data?.tokenType, "Bearer");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://auth.example.com/api/auth/token");
    assert.match(calls[0]?.body ?? "", /"audience":"neon"/);
  } finally {
    globalThis.fetch = original;
  }
});

test("token provider single-flights concurrent refresh", async () => {
  let issues = 0;
  const provider = createAthenaAuthTokenProvider(async () => {
    issues += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return tokenResult(Math.floor(Date.now() / 1000) + 900);
  });

  const [a, b, c] = await Promise.all([
    provider.getToken(),
    provider.getToken(),
    provider.getToken(),
  ]);
  assert.equal(issues, 1);
  assert.equal(a.data?.token, b.data?.token);
  assert.equal(b.data?.token, c.data?.token);

  const cached = await provider.getToken();
  assert.equal(issues, 1);
  assert.equal(cached.data?.token, a.data?.token);
});

test("token provider refreshes near expiry and invalidates cache", async () => {
  let issues = 0;
  const provider = createAthenaAuthTokenProvider(
    async () => {
      issues += 1;
      return tokenResult(Math.floor(Date.now() / 1000) + (issues === 1 ? 10 : 900));
    },
    { refreshSkewSeconds: 60 }
  );

  await provider.getToken();
  await provider.getToken();
  assert.equal(issues, 2);
  provider.invalidate();
  await provider.getToken();
  assert.equal(issues, 3);
});

test("decodeJwtExpSeconds reads exp without verifying signature", () => {
  const exp = 1_786_830_900;
  assert.equal(decodeJwtExpSeconds(encodeJwt(exp)), exp);
  assert.equal(decodeJwtExpSeconds("not-a-jwt"), null);
  assert.equal(
    tokenNeedsRefresh(
      {
        audience: ["neon"],
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        expiresIn: 10,
        issuer: "https://auth.example.com",
        token: encodeJwt(Math.floor(Date.now() / 1000) + 10),
        tokenType: "Bearer",
      },
      Date.now(),
      60
    ),
    true
  );
});
