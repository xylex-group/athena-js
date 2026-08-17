import assert from "node:assert/strict";
import test from "node:test";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";
import {
  getAttachedAthenaAuthRouting,
  hasDuplicateAthenaAuthPath,
  resolveAthenaAuthRouting,
  toProxyUpstreamBaseUrl,
} from "../src/auth/resolve-routing.ts";
import { createAthenaServerClient } from "../src/next/server.ts";
import { ATHENA_AUTH_PATH } from "../src/utils/athena-auth-url.ts";

test("same-origin: browser base is /api/auth and upstream from upstreamUrl", () => {
  const resolved = resolveAthenaAuthRouting({
    emitWarnings: false,
    requestOrigin: "https://app.example.com",
    routing: "same-origin",
    upstreamUrl: "https://auth.example.com",
  });
  assert.equal(resolved.mode, "same-origin");
  assert.equal(resolved.browserRequestBaseUrl, ATHENA_AUTH_PATH);
  assert.equal(
    resolved.serverRequestBaseUrl,
    "https://app.example.com/api/auth"
  );
  assert.equal(resolved.proxyUpstreamBaseUrl, "https://auth.example.com");
  assert.equal(resolved.credentials, "include");
});

test("auth routing survives a second resolve-routing WeakMap via Symbol.for", () => {
  const client = createClient({
    auth: {
      routing: "same-origin",
      upstreamUrl: "https://auth.example.com",
    },
    key: "key",
    url: "https://gateway.example.com",
  });
  const key = Symbol.for("@xylex-group/athena.authRouting");
  const stored = (client as Record<symbol, { proxyUpstreamBaseUrl?: string }>)[
    key
  ];
  assert.ok(stored);
  assert.equal(stored.proxyUpstreamBaseUrl, "https://auth.example.com");
});

test("same-origin: absolute auth.url treated as upstream with deprecation warning", () => {
  const resolved = resolveAthenaAuthRouting({
    emitWarnings: false,
    routing: "same-origin",
    url: "https://auth.example.com/api/auth",
  });
  assert.equal(resolved.browserRequestBaseUrl, ATHENA_AUTH_PATH);
  assert.equal(resolved.proxyUpstreamBaseUrl, "https://auth.example.com");
  assert.ok(resolved.warnings.some((w) => w.includes("Deprecated")));
});

test("same-origin: env ATHENA_AUTH_UPSTREAM_URL supplies proxy upstream", () => {
  const resolved = resolveAthenaAuthRouting({
    emitWarnings: false,
    env: {
      ATHENA_AUTH_UPSTREAM_URL: "https://from-env.example.com/api/auth",
    },
    routing: "same-origin",
  });
  assert.equal(resolved.proxyUpstreamBaseUrl, "https://from-env.example.com");
});

test("same-origin: missing upstream does not silently use hosted default", () => {
  const resolved = resolveAthenaAuthRouting({
    emitWarnings: false,
    routing: "same-origin",
  });
  assert.equal(resolved.proxyUpstreamBaseUrl, undefined);
  assert.equal(resolved.browserRequestBaseUrl, ATHENA_AUTH_PATH);
  assert.ok(
    resolved.warnings.some((w) => w.includes("no proxy upstream")),
    "expected missing-upstream warning"
  );
});

test("credentials default is include regardless of routing mode", () => {
  for (const routing of ["same-origin", "direct", "custom"] as const) {
    const resolved = resolveAthenaAuthRouting({
      emitWarnings: false,
      routing,
      ...(routing === "direct"
        ? { url: "https://auth.example.com" }
        : routing === "same-origin"
          ? { upstreamUrl: "https://auth.example.com" }
          : { url: "/api/auth" }),
    });
    assert.equal(resolved.credentials, "include");
  }
  assert.equal(
    resolveAthenaAuthRouting({
      credentials: "omit",
      emitWarnings: false,
      routing: "same-origin",
      upstreamUrl: "https://auth.example.com",
    }).credentials,
    "omit"
  );
});

test("direct: requires url and normalizes /api/auth", () => {
  const resolved = resolveAthenaAuthRouting({
    emitWarnings: false,
    routing: "direct",
    url: "https://auth.example.com",
  });
  assert.equal(resolved.mode, "direct");
  assert.equal(
    resolved.browserRequestBaseUrl,
    "https://auth.example.com/api/auth"
  );
});

test("direct without url throws ATHENA_AUTH_INVALID_URL", () => {
  assert.throws(
    () =>
      resolveAthenaAuthRouting({
        emitWarnings: false,
        routing: "direct",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_INVALID_URL"
  );
});

test("direct rejects relative url (absolute required by policy)", () => {
  assert.throws(
    () =>
      resolveAthenaAuthRouting({
        emitWarnings: false,
        routing: "direct",
        url: "/api/auth",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_INVALID_URL" &&
      String(error.message).includes("absolute")
  );
});

test("duplicate auth path detection", () => {
  assert.equal(hasDuplicateAthenaAuthPath("/api/auth/api/auth"), true);
  assert.equal(
    hasDuplicateAthenaAuthPath("https://auth.example.com/api/auth/api/auth"),
    true
  );
  assert.equal(hasDuplicateAthenaAuthPath("/api/auth"), false);
  assert.equal(hasDuplicateAthenaAuthPath("/auth/auth"), true);
});

test("toProxyUpstreamBaseUrl strips /api/auth", () => {
  assert.equal(
    toProxyUpstreamBaseUrl("https://auth.example.com/api/auth"),
    "https://auth.example.com"
  );
});

test("createClient same-origin enables relative auth base and inspectAuth", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify(null), { status: 200 });
  };
  try {
    const client = createClient({
      auth: {
        routing: "same-origin",
        upstreamUrl: "https://auth.example.com",
      },
      key: "key",
      url: "https://gateway.example.com",
    });

    const routing = getAttachedAthenaAuthRouting(client);
    assert.ok(routing);
    assert.equal(routing.browserRequestBaseUrl, "/api/auth");
    assert.equal(routing.proxyUpstreamBaseUrl, "https://auth.example.com");

    // inspectAuth is required on AthenaClient (not optional chaining).
    const diagnostics = client.system.inspectAuth({
      requestOrigin: "https://app.example.com",
    });
    assert.equal(diagnostics.mode, "same-origin");
    assert.equal(diagnostics.browserRequestBaseUrl, "/api/auth");
    assert.equal(
      diagnostics.serverRequestBaseUrl,
      "https://app.example.com/api/auth"
    );
    assert.equal(diagnostics.proxyUpstreamBaseUrl, "https://auth.example.com");
    assert.equal(diagnostics.authConfigured, true);

    await client.auth.getSession();
    assert.ok(
      capturedUrl.includes("/api/auth/get-session") ||
        capturedUrl.endsWith("/api/auth/get-session") ||
        capturedUrl.includes("/get-session"),
      `expected same-origin session path, got ${capturedUrl}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient same-origin + absolute url compat uses upstream without dual path", () => {
  const client = createClient({
    auth: {
      routing: "same-origin",
      url: "https://auth.example.com",
    },
    key: "key",
    url: "https://gateway.example.com",
  });
  const routing = getAttachedAthenaAuthRouting(client);
  assert.ok(routing);
  assert.equal(routing.browserRequestBaseUrl, "/api/auth");
  assert.equal(routing.proxyUpstreamBaseUrl, "https://auth.example.com");
});

test("essential invariant: one authority for browser / server / upstream", () => {
  const client = createClient({
    auth: {
      routing: "same-origin",
      upstreamUrl: "https://auth.example.com",
    },
    key: "k",
    url: "https://gateway.example.com",
  });
  const d = client.system.inspectAuth({
    requestOrigin: "https://app.example.com",
  });
  assert.deepEqual(
    {
      browser: d.browserRequestBaseUrl,
      server: d.serverRequestBaseUrl,
      upstream: d.proxyUpstreamBaseUrl,
    },
    {
      browser: "/api/auth",
      server: "https://app.example.com/api/auth",
      upstream: "https://auth.example.com",
    }
  );
});

test("auth routing WeakMap retained across withContext chain and server client", async () => {
  const base = createClient({
    auth: {
      routing: "same-origin",
      upstreamUrl: "https://auth.example.com",
    },
    key: "k",
    url: "https://gateway.example.com",
  });

  const hop1 = base.withContext({ cookie: "a=1" });
  const hop2 = hop1.withContext({ userId: "user_1" });
  const serverView = await createAthenaServerClient({
    // `as never` keeps the withContext chain from overflowing generic depth
    // (TS2589) — same pattern as next-adapters.test.ts.
    client: hop2 as never,
    requestCookies: "session=1",
    requestHeaders: {},
  });

  const expected = {
    browserRequestBaseUrl: "/api/auth",
    mode: "same-origin" as const,
    proxyUpstreamBaseUrl: "https://auth.example.com",
  };

  for (const client of [base, hop1, hop2, serverView]) {
    const routing = getAttachedAthenaAuthRouting(client);
    assert.ok(routing, "expected attached routing");
    assert.equal(routing.browserRequestBaseUrl, expected.browserRequestBaseUrl);
    assert.equal(routing.mode, expected.mode);
    assert.equal(routing.proxyUpstreamBaseUrl, expected.proxyUpstreamBaseUrl);

    const diag = client.system.inspectAuth();
    assert.equal(diag.browserRequestBaseUrl, expected.browserRequestBaseUrl);
    assert.equal(diag.mode, expected.mode);
    assert.equal(diag.proxyUpstreamBaseUrl, expected.proxyUpstreamBaseUrl);
  }
});
