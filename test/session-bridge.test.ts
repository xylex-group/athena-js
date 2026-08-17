import assert from "node:assert/strict";
import test from "node:test";
import {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  ATHENA_AUTH_SESSION_COOKIE_NAMES,
  clearAthenaAuthSessionOnAppHost,
  createAthenaAuthSessionBridgeHandlers,
  createAthenaAuthSessionBridgePathHandlers,
  isAthenaAuthSessionBridgePath,
  persistAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
} from "../src/next/session-bridge/index.ts";

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

test("resolveSessionBridgePayload reads session.token and expiresAt", () => {
  const payload = resolveSessionBridgePayload({
    session: {
      expiresAt: "2030-01-01T00:00:00.000Z",
      token: "  sess_abc  ",
    },
  });
  assert.deepEqual(payload, {
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "sess_abc",
  });
});

test("resolveSessionBridgePayload returns null without a token", () => {
  assert.equal(resolveSessionBridgePayload(null), null);
  assert.equal(
    resolveSessionBridgePayload({ session: { token: "   " } }),
    null
  );
});

test("POST bridge sets httpOnly session cookie", async () => {
  const { POST } = createAthenaAuthSessionBridgeHandlers();
  const response = await POST(
    new Request("https://app.example.com/api/athena-auth/session", {
      body: JSON.stringify({
        expiresAt: "2030-06-01T00:00:00.000Z",
        token: "sess_token",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; route: string };
  assert.equal(body.ok, true);
  assert.equal(body.route, ATHENA_AUTH_SESSION_BRIDGE_ROUTE);

  const cookies = getSetCookies(response);
  assert.ok(cookies.length >= 1);
  assert.ok(cookies.some((c) => c.includes(ATHENA_AUTH_SESSION_COOKIE_NAME)));
  assert.ok(cookies.some((c) => c.includes("HttpOnly")));
  assert.ok(cookies.some((c) => c.includes("Secure")));
  assert.ok(
    cookies.some(
      (c) =>
        c.includes("sess_token") || c.includes(encodeURIComponent("sess_token"))
    )
  );
});

test("POST bridge rejects missing token", async () => {
  const { POST } = createAthenaAuthSessionBridgeHandlers();
  const response = await POST(
    new Request("https://app.example.com/api/athena-auth/session", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 400);
});

test("DELETE bridge clears known cookie name variants", async () => {
  const { DELETE } = createAthenaAuthSessionBridgeHandlers();
  const response = DELETE(
    new Request("https://app.example.com/api/athena-auth/session", {
      method: "DELETE",
    })
  );
  assert.equal(response.status, 200);
  const cookies = getSetCookies(response);
  for (const name of ATHENA_AUTH_SESSION_COOKIE_NAMES) {
    assert.ok(
      cookies.some((c) => c.includes(name)),
      `expected clear cookie for ${name}`
    );
  }
});

test("path handlers match /api/auth/session and reject other paths", async () => {
  const handlers = createAthenaAuthSessionBridgePathHandlers({
    route: "/api/auth/session",
  });

  assert.equal(
    isAthenaAuthSessionBridgePath(
      new Request("https://app.example.com/api/auth/session"),
      { route: "/api/auth/session" }
    ),
    true
  );
  assert.equal(
    isAthenaAuthSessionBridgePath(
      new Request("https://app.example.com/api/auth/callback"),
      { route: "/api/auth/session" }
    ),
    false
  );

  const ok = await handlers.POST(
    new Request("https://app.example.com/api/auth/session", {
      body: JSON.stringify({ token: "x" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(ok.status, 200);

  const missing = await handlers.POST(
    new Request("https://app.example.com/api/auth/callback", {
      body: JSON.stringify({ token: "x" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(missing.status, 404);
});

test("next/server re-exports session bridge symbols", async () => {
  const server = await import("../src/next/server.ts");
  assert.equal(typeof server.createAthenaAuthSessionBridgeHandlers, "function");
  assert.equal(
    typeof server.createAthenaAuthSessionBridgePathHandlers,
    "function"
  );
  assert.equal(
    server.ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
    "/api/athena-auth/session"
  );
  assert.equal(typeof server.hasAuthSessionCookie, "function");
  assert.ok(Array.isArray(server.SESSION_COOKIE_PATTERNS));
  assert.equal(typeof server.persistAthenaAuthSessionOnAppHost, "function");
  assert.equal(typeof server.clearAthenaAuthSessionOnAppHost, "function");
  assert.equal(typeof server.createAthenaServerClient, "function");
  assert.equal(typeof server.createFreshSessionLookupUrl, "function");
  assert.equal(typeof server.getOriginFromHeaders, "function");
  assert.equal(typeof server.requireEnv, "function");
  assert.equal(typeof server.readEnv, "function");
  assert.equal(typeof server.buildAthenaGatewayHeaders, "function");
  assert.equal(typeof server.proxyRequestHeaders, "function");
  assert.equal(typeof server.asNonEmptyString, "function");
  assert.equal(typeof server.ensureActiveOrganization, "function");
  assert.equal(typeof server.clearAuthCookies, "function");
  assert.equal(typeof server.isDynamicServerUsageError, "function");
});

test("next/client re-exports bridge and auth helper symbols", async () => {
  const client = await import("../src/next/client.ts");
  assert.equal(typeof client.createAthenaBrowserClient, "function");
  assert.equal(typeof client.persistAthenaAuthSessionOnAppHost, "function");
  assert.equal(typeof client.clearAthenaAuthSessionOnAppHost, "function");
  assert.equal(typeof client.resolveSessionBridgePayload, "function");
  assert.equal(
    client.ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
    "/api/athena-auth/session"
  );
  assert.equal(typeof client.clearAuthCookies, "function");
  assert.equal(typeof client.resolveAuthViewFromSegment, "function");
  assert.equal(typeof client.resolveAthenaAuthUpstreamUrl, "function");
  assert.equal(typeof client.createFreshSessionLookupUrl, "function");
  assert.equal(typeof client.createAuthRoutes, "function");
  assert.equal(typeof client.buildAthenaGatewayHeaders, "function");
  assert.equal(typeof client.asNonEmptyString, "function");
  assert.equal(typeof client.resolveEmailVerificationCallbackUrl, "function");
  assert.equal(
    client.ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
    "disableCookieCache"
  );
});

test("persistAthenaAuthSessionOnAppHost no-ops outside the browser", async () => {
  const calls: unknown[] = [];
  await persistAthenaAuthSessionOnAppHost(
    { expiresAt: "2030-01-01T00:00:00.000Z", token: "sess" },
    {
      fetch: async (...args) => {
        calls.push(args);
        return new Response(null, { status: 200 });
      },
    }
  );
  assert.equal(calls.length, 0);
});

test("persistAthenaAuthSessionOnAppHost no-ops for null payload even with a window", async () => {
  const calls: unknown[] = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    await persistAthenaAuthSessionOnAppHost(null, {
      fetch: async (...args) => {
        calls.push(args);
        return new Response(null, { status: 200 });
      },
    });
    assert.equal(calls.length, 0);
  } finally {
    if (previousWindow === undefined) {
      (globalThis as { window?: unknown }).window = undefined;
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("persistAthenaAuthSessionOnAppHost POSTs JSON with same-origin credentials in the browser", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    await persistAthenaAuthSessionOnAppHost(
      { expiresAt: "2030-06-01T00:00:00.000Z", token: "sess_token" },
      {
        fetch: async (url, init) => {
          calls.push({ init, url: String(url) });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
        route: "/api/custom-session",
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/custom-session");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      expiresAt: "2030-06-01T00:00:00.000Z",
      token: "sess_token",
    });
  } finally {
    if (previousWindow === undefined) {
      (globalThis as { window?: unknown }).window = undefined;
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("persistAthenaAuthSessionOnAppHost throws on non-OK responses", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    await assert.rejects(
      () =>
        persistAthenaAuthSessionOnAppHost(
          { token: "x" },
          {
            fetch: async () => new Response("nope", { status: 500 }),
          }
        ),
      /Failed to persist the Athena Auth session on the app host/
    );
  } finally {
    if (previousWindow === undefined) {
      (globalThis as { window?: unknown }).window = undefined;
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("clearAthenaAuthSessionOnAppHost DELETEs the bridge route in the browser", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    await clearAthenaAuthSessionOnAppHost({
      fetch: async (url, init) => {
        calls.push({ init, url: String(url) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, ATHENA_AUTH_SESSION_BRIDGE_ROUTE);
    assert.equal(calls[0].init?.method, "DELETE");
    assert.equal(calls[0].init?.credentials, "same-origin");
  } finally {
    if (previousWindow === undefined) {
      (globalThis as { window?: unknown }).window = undefined;
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("clearAthenaAuthSessionOnAppHost throws on non-OK responses", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    await assert.rejects(
      () =>
        clearAthenaAuthSessionOnAppHost({
          fetch: async () => new Response("nope", { status: 503 }),
        }),
      /Failed to clear the Athena Auth session on the app host/
    );
  } finally {
    if (previousWindow === undefined) {
      (globalThis as { window?: unknown }).window = undefined;
    } else {
      Object.assign(globalThis, { window: previousWindow });
    }
  }
});

test("clearAthenaAuthSessionOnAppHost no-ops outside the browser", async () => {
  const calls: unknown[] = [];
  await clearAthenaAuthSessionOnAppHost({
    fetch: async (...args) => {
      calls.push(args);
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(calls.length, 0);
});

test("resolveSessionBridgePayload falls back to top-level token", () => {
  const payload = resolveSessionBridgePayload({
    session: { expiresAt: "2031-01-01T00:00:00.000Z" },
    token: "  top_level_token  ",
  });
  assert.deepEqual(payload, {
    expiresAt: "2031-01-01T00:00:00.000Z",
    token: "top_level_token",
  });
});

test("resolveSessionBridgePayload prefers session.token over top-level token", () => {
  const payload = resolveSessionBridgePayload({
    session: {
      expiresAt: "2031-02-01T00:00:00.000Z",
      token: "nested_token",
    },
    token: "top_level",
  });
  assert.deepEqual(payload, {
    expiresAt: "2031-02-01T00:00:00.000Z",
    token: "nested_token",
  });
});

test("resolveSessionBridgePayload omits non-string expiresAt", () => {
  const payload = resolveSessionBridgePayload({
    session: {
      expiresAt: 1_700_000_000_000 as unknown as string,
      token: "tok",
    },
  });
  assert.deepEqual(payload, { expiresAt: undefined, token: "tok" });
});

test("POST bridge returns 400 for invalid JSON body", async () => {
  const { POST } = createAthenaAuthSessionBridgeHandlers();
  const response = await POST(
    new Request("https://app.example.com/api/athena-auth/session", {
      body: "{not-json",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /Missing Athena Auth session token/);
});

test("POST bridge omits Expires when expiresAt is invalid and respects secure override", async () => {
  const { POST } = createAthenaAuthSessionBridgeHandlers({
    cookieName: "custom.session",
    cookiePath: "/auth",
    sameSite: "strict",
    secure: false,
  });
  const response = await POST(
    new Request("http://app.example.com/api/athena-auth/session", {
      body: JSON.stringify({ expiresAt: "not-a-date", token: "tok" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const cookies = getSetCookies(response);
  assert.ok(cookies.some((c) => c.includes("custom.session")));
  assert.ok(cookies.some((c) => c.includes("Path=/auth")));
  assert.ok(cookies.some((c) => c.includes("SameSite=Strict")));
  assert.equal(
    cookies.some((c) => c.includes("Secure")),
    false
  );
  assert.equal(
    cookies.some((c) => c.includes("Expires=")),
    false
  );
});

test("POST bridge uses x-forwarded-proto for Secure detection", async () => {
  const { POST } = createAthenaAuthSessionBridgeHandlers();
  const httpsBehindProxy = await POST(
    new Request("http://app.example.com/api/athena-auth/session", {
      body: JSON.stringify({ token: "tok" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https, http",
      },
      method: "POST",
    })
  );
  const httpBehindProxy = await POST(
    new Request("https://app.example.com/api/athena-auth/session", {
      body: JSON.stringify({ token: "tok" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "http",
      },
      method: "POST",
    })
  );

  const httpsCookies = getSetCookies(httpsBehindProxy);
  const httpCookies = getSetCookies(httpBehindProxy);
  assert.ok(httpsCookies.some((c) => c.includes("Secure")));
  assert.equal(
    httpCookies.some((c) => c.includes("Secure")),
    false
  );
});

test("isAthenaAuthSessionBridgePath normalizes trailing slashes and matchPaths", () => {
  assert.equal(
    isAthenaAuthSessionBridgePath(
      new Request("https://app.example.com/api/athena-auth/session/")
    ),
    true
  );
  assert.equal(
    isAthenaAuthSessionBridgePath(
      new Request("https://app.example.com/api/custom/session"),
      { matchPaths: ["session"] }
    ),
    true
  );
  assert.equal(
    isAthenaAuthSessionBridgePath(
      new Request("https://app.example.com/api/custom/session"),
      { matchPaths: ["bridge"] }
    ),
    false
  );
});

test("path handlers DELETE returns 404 for non-matching paths", async () => {
  const handlers = createAthenaAuthSessionBridgePathHandlers({
    route: "/api/auth/session",
  });
  const missing = handlers.DELETE(
    new Request("https://app.example.com/api/auth/sign-out", {
      method: "DELETE",
    })
  );
  assert.equal(missing.status, 404);
  const body = (await missing.json()) as { error: string };
  assert.equal(body.error, "Not found");
});
