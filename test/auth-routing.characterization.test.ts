/**
 * Phase 1A — characterization of legacy createClient auth URL / env precedence.
 * These tests document pre-routing-mode behavior and must stay green.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../src/v3-client.ts";
import {
  LEGACY_CREATE_CLIENT_AUTH_ENV_KEYS,
  resolveLegacyCreateClientAuthUrl,
} from "../src/auth/resolve-routing.ts";

test("legacy createClient auth env keys are ATHENA_AUTH_URL then NEXT_PUBLIC", () => {
  assert.deepEqual([...LEGACY_CREATE_CLIENT_AUTH_ENV_KEYS], [
    "ATHENA_AUTH_URL",
    "NEXT_PUBLIC_ATHENA_AUTH_URL",
  ]);
});

test("legacy resolve: explicit auth.url wins over env and root", () => {
  assert.equal(
    resolveLegacyCreateClientAuthUrl({
      env: { ATHENA_AUTH_URL: "https://env.example.com" },
      explicitUrl: "https://explicit.example.com",
      rootUrl: "https://gateway.example.com",
    }),
    "https://explicit.example.com"
  );
});

test("legacy resolve: env ATHENA_AUTH_URL wins over NEXT_PUBLIC and root", () => {
  assert.equal(
    resolveLegacyCreateClientAuthUrl({
      env: {
        ATHENA_AUTH_URL: "https://private.example.com",
        NEXT_PUBLIC_ATHENA_AUTH_URL: "https://public.example.com",
      },
      rootUrl: "https://gateway.example.com",
    }),
    "https://private.example.com"
  );
});

test("legacy resolve: non-absolute env values are skipped", () => {
  assert.equal(
    resolveLegacyCreateClientAuthUrl({
      env: {
        ATHENA_AUTH_URL: "/api/auth",
        NEXT_PUBLIC_ATHENA_AUTH_URL: "https://public.example.com",
      },
      rootUrl: "https://gateway.example.com",
    }),
    "https://public.example.com"
  );
});

test("legacy resolve: unified root derives /auth when no auth url/env", () => {
  assert.equal(
    resolveLegacyCreateClientAuthUrl({
      rootUrl: "https://gateway.example.com",
    }),
    "https://gateway.example.com/auth"
  );
});

test("legacy createClient: explicit absolute auth.url is configured", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify(null), { status: 200 });
  };
  try {
    const client = createClient({
      auth: { url: "https://auth.example.com/api/auth" },
      key: "key",
      url: "https://gateway.example.com",
    });
    await client.auth.getSession();
    assert.ok(
      capturedUrl.startsWith("https://auth.example.com/api/auth"),
      `expected auth host, got ${capturedUrl}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy createClient: root alone derives gateway/auth", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify(null), { status: 200 });
  };
  try {
    const client = createClient({
      key: "key",
      url: "https://gateway.example.com",
    });
    await client.auth.getSession();
    assert.ok(
      capturedUrl.startsWith("https://gateway.example.com/auth"),
      `expected derived /auth, got ${capturedUrl}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
