import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  createMemoryTokenStore,
  createReactNativeClient,
  createClient as rnCreateClient,
} from "../src/react-native/index.ts";
import { createClient as browserCreateClient } from "../src/browser.ts";
import {
  type AthenaClient,
  AthenaConfigurationError,
} from "../src/v3-client-core.ts";
import type { AthenaSqliteExecutor } from "../src/sqlite-local/contracts.ts";

interface Captured {
  init?: RequestInit;
  url: string;
}

function mockFetch(
  responseBody: unknown = { session: null, user: null },
  responseInit: ResponseInit = { status: 200 }
) {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    const body =
      typeof responseBody === "string"
        ? responseBody
        : JSON.stringify(responseBody);
    return new Response(body, responseInit);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function headerRecord(init?: RequestInit): Record<string, string> {
  const h = init?.headers;
  if (!h) {
    return {};
  }
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    return Object.fromEntries(h);
  }
  return { ...(h as Record<string, string>) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function sqliteExecutor(calls: string[]): AthenaSqliteExecutor {
  return {
    capabilities: {
      interrupt: true,
      returning: true,
      savepoints: true,
      transactions: "interactive",
    },
    async execute(sql) {
      calls.push(sql);
      return {
        columns: ["value"],
        rows: [[1]],
      };
    },
    async transaction(callback) {
      return callback(
        {
          execute: async (sql) => {
            calls.push(sql);
            return {
              columns: ["value"],
              rows: [[1]],
            };
          },
        }
      );
    },
  };
}

test("universal clients close owned SQLite executors exactly once", async () => {
  for (const create of [
    browserCreateClient,
    rnCreateClient,
    createReactNativeClient,
  ]) {
    let closeCalls = 0;
    const executor = sqliteExecutor([]);
    const ownedExecutor: AthenaSqliteExecutor = {
      ...executor,
      async close() {
        closeCalls += 1;
      },
    };
    const client = create({
      auth: false,
      db: { sqlite: { executor: ownedExecutor, ownership: "owned" } },
    });

    await client.close();
    await client.close();

    assert.equal(closeCalls, 1);
  }
});

test("universal clients do not close borrowed SQLite executors", async () => {
  let closeCalls = 0;
  const executor: AthenaSqliteExecutor = {
    ...sqliteExecutor([]),
    async close() {
      closeCalls += 1;
    },
  };
  const client = browserCreateClient({
    auth: false,
    db: { sqlite: { executor } },
  });

  await client.close();

  assert.equal(closeCalls, 0);
});

test("browser and React Native constructors materialize injected SQLite Local executors", async () => {
  for (const create of [
    browserCreateClient,
    rnCreateClient,
    createReactNativeClient,
  ]) {
    const calls: string[] = [];
    const client = create({
      auth: false,
      db: { sqlite: { executor: sqliteExecutor(calls) } },
    });

    assert.deepEqual((await client.db.query("select 1")).data, [{ value: 1 }]);
    assert.equal(calls.length, 1);
  }
});

test("T-RN-001 package.json exports ./react-native subpath", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    exports: Record<
      string,
      {
        import?: { types?: string; default?: string };
        require?: { types?: string; default?: string };
      }
    >;
  };
  const exp = pkg.exports["./react-native"];
  assert.ok(exp, 'missing exports["./react-native"]');
  assert.equal(exp.import?.types, "./dist/react-native.d.ts");
  assert.equal(exp.import?.default, "./dist/react-native.js");
  assert.equal(exp.require?.types, "./dist/react-native.d.cts");
  assert.equal(exp.require?.default, "./dist/react-native.cjs");
});

test("T-RN-001 react-native entry exports createClient and createReactNativeClient", () => {
  assert.equal(typeof rnCreateClient, "function");
  assert.equal(typeof createReactNativeClient, "function");
});

// Original found case (PR #578 discussion_r3762275833):
// re-exported createClient from @xylex-group/athena/react-native bypassed
// assertDirectPostgresRequiresNodeRuntime (only createReactNativeClient guarded).
test("P1: Guard the re-exported React Native createClient", () => {
  const secretUri = "postgres://s3cret-user:hunter2@db.internal:5432/prod";

  let thrown: Error | undefined;
  try {
    rnCreateClient({
      db: { pgUri: secretUri },
      key: "public-key",
      url: "https://athena.example.com",
    });
  } catch (error) {
    thrown = error as Error;
  }

  assert.ok(thrown instanceof AthenaConfigurationError);
  assert.equal(thrown.code, "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED");
  assert.equal(thrown.service, "db");
  // URI/secret must never appear in the diagnostic.
  assert.ok(!thrown.message.includes(secretUri));
  assert.ok(!thrown.message.includes("s3cret-user"));
  assert.ok(!thrown.message.includes("hunter2"));
  assert.ok(!thrown.message.includes("db.internal"));
  assert.ok(!thrown.message.includes("postgres://"));
});

test("P1: Rejects data lifecycle hooks for remote React Native clients", () => {
  assert.throws(
    () =>
      createReactNativeClient({
        db: { url: "https://gateway.example.com" },
        key: "gateway-key",
        lifecycle: {
          data: {
            before: () => undefined,
          },
        },
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME"
  );
});

test("P1: Rejects billing providers in React Native clients", () => {
  assert.throws(
    () =>
      createReactNativeClient({
        billing: {
          providers: {
            mollie: { testKey: "test_rn_guard" },
          },
        },
        db: { url: "https://gateway.example.com" },
        key: "gateway-key",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED"
  );
});

test("P1: Rejects remote Auth hooks in React Native clients", () => {
  assert.throws(
    () =>
      createReactNativeClient({
        auth: {
          hooks: {},
          mode: "remote",
          url: "https://auth.example.com",
        },
        db: { url: "https://gateway.example.com" },
        key: "gateway-key",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME"
  );
});

test("P1: Rejects remote Auth observability in React Native clients", () => {
  assert.throws(
    () =>
      createReactNativeClient({
        auth: {
          mode: "remote",
          observability: {},
          url: "https://auth.example.com",
        },
        db: { url: "https://gateway.example.com" },
        key: "gateway-key",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_OBSERVABILITY_REQUIRES_LOCAL_RUNTIME"
  );
});

test("P1: Public sign-out invalidation releases the React Native refresh barrier", async () => {
  const { calls, restore } = mockFetch({
    session: {
      id: "session-after-invalidation",
      token: "session-after-invalidation",
      userId: "user-1",
    },
    user: { id: "user-1" },
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore: createMemoryTokenStore(),
    });

    client.auth.session.invalidate("signOut");
    const snapshot = await client.auth.session.refresh();

    assert.equal(calls.length, 1);
    assert.equal(snapshot.session?.user.id, "user-1");
  } finally {
    restore();
  }
});

test("T-RN-002 createReactNativeClient defaults auth credentials to omit", async () => {
  const { calls, restore } = mockFetch({ session: null, user: null });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
    });
    await client.auth.getSession();
    assert.ok(calls.length >= 1);
    assert.equal(calls[0].init?.credentials, "omit");
  } finally {
    restore();
  }
});

test("T-RN-003 tokenStore injects bearer and session headers", async () => {
  const { calls, restore } = mockFetch({
    session: { id: "s1" },
    user: { id: "u1" },
  });
  try {
    const tokenStore = createMemoryTokenStore({
      accessToken: "rn-access-token",
      sessionToken: "rn-session-token",
    });
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await client.auth.getSession();
    const headers = headerRecord(calls[0].init);
    assert.equal(headers["X-Athena-Auth-Session-Token"], "rn-session-token");
    assert.ok(
      typeof headers.Authorization === "string" &&
        headers.Authorization.includes("rn-access-token"),
      `expected Authorization to carry access token, got ${headers.Authorization}`
    );
    assert.equal(calls[0].init?.credentials, "omit");
  } finally {
    restore();
  }
});

test("T-RN-008 sign-in awaits durable session-token persistence", async () => {
  const events: string[] = [];
  let sessionToken: string | null = null;
  const tokenStore = {
    async getAccessToken() {
      return null;
    },
    async getSessionToken() {
      return sessionToken;
    },
    async setAccessToken(token: string | null) {
      events.push(`access:${token ?? "null"}`);
    },
    async setSessionToken(token: string | null) {
      events.push(`session:start:${token ?? "null"}`);
      await Promise.resolve();
      sessionToken = token;
      events.push(`session:end:${token ?? "null"}`);
    },
  };
  const { restore } = mockFetch({
    token: "signed-in-session",
    user: { id: "user-1" },
  });

  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.signIn.email({
      email: "user@example.com",
      password: "secret",
    });
    assert.equal(result.ok, true);
    assert.equal(sessionToken, "signed-in-session");
    assert.deepEqual(events, [
      "session:start:signed-in-session",
      "session:end:signed-in-session",
    ]);
  } finally {
    restore();
  }
});

test("P1: contextual sign-out blocks refreshes from the root view", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const signOutRequest = deferred<Response>();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const endpoint = String(url);
    calls.push(endpoint);
    if (endpoint.endsWith("/sign-out")) {
      return signOutRequest.promise;
    }
    return new Response(
      JSON.stringify({
        session: { id: "restored-session", token: "restored-token" },
        user: { id: "user-1" },
      }),
      { status: 200 }
    );
  };

  try {
    const root = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const contextual = root.withContext({ organizationId: "org-1" });

    const signOut = contextual.auth.signOut();
    await Promise.resolve();
    const rootSession = root.auth.getSession();

    assert.deepEqual(calls, [
      "https://auth.example.com/api/auth/sign-out",
    ]);
    signOutRequest.resolve(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await signOut;
    const result = await rootSession;

    assert.equal(result.data, null);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T-RN-PASSKEY-001 stale passkey sign-in cannot restore durable credentials after sign-out", async () => {
  const tokenStore = createMemoryTokenStore();
  const verify = deferred<Response>();
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      credentials: {
        get: async () => ({
          id: "credential-1",
          rawId: new Uint8Array([1]).buffer,
          response: {
            authenticatorData: new Uint8Array([2]).buffer,
            clientDataJSON: new Uint8Array([3]).buffer,
            signature: new Uint8Array([4]).buffer,
          },
          type: "public-key",
        }),
      },
    },
  });
  globalThis.fetch = async (url) => {
    const endpoint = String(url);
    if (endpoint.includes("generate-authenticate-options")) {
      return new Response(
        JSON.stringify({ challenge: "Y2hhbGxlbmdl", allowCredentials: [] }),
        { status: 200 }
      );
    }
    if (endpoint.includes("verify-authentication")) {
      return verify.promise;
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const signIn = client.auth.passkey.signIn();
    await Promise.resolve();
    const signOut = await client.auth.signOut();
    assert.equal(signOut.ok, true);
    verify.resolve(
      new Response(
        JSON.stringify({
          session: {
            id: "session-1",
            token: "stale-session-token",
            userId: "user-1",
          },
          user: { id: "user-1" },
        }),
        { status: 200 }
      )
    );
    await signIn;
    assert.equal(client.auth.session.get(), null);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});

test("T-RN-PASSKEY-002 stale direct passkey verification cannot restore durable credentials after sign-out", async () => {
  const tokenStore = createMemoryTokenStore();
  const verify = deferred<Response>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("verify-authentication")) {
      return verify.promise;
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const verification = client.auth.passkey.verifyAuthentication({
      response: "webauthn-authentication-response",
    });
    await Promise.resolve();
    const signOut = await client.auth.signOut();
    assert.equal(signOut.ok, true);
    verify.resolve(
      new Response(
        JSON.stringify({
          session: {
            id: "session-1",
            token: "stale-session-token",
            userId: "user-1",
          },
          user: { id: "user-1" },
        }),
        { status: 200 }
      )
    );
    await verification;
    assert.equal(client.auth.session.get(), null);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T-RN-009 definitive session loss clears durable credentials", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const { restore } = mockFetch(
    { error: "expired" },
    { status: 401, headers: { "content-type": "application/json" } }
  );
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await client.auth.getSession();
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    restore();
  }
});

test("T-RN-010 sign-out clears durable credentials after remote success", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const { restore } = mockFetch({ success: true });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.signOut();
    assert.equal(result.ok, true);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    restore();
  }
});

test("T-RN-010a sign-out clears durable credentials after a non-OK response", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const { restore } = mockFetch(
    { error: "upstream down" },
    { status: 503, headers: { "content-type": "application/json" } }
  );
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.signOut();
    assert.equal(result.ok, false);
    assert.equal(client.auth.session.get(), null);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    restore();
  }
});

test("T-RN-010b sign-out clears durable credentials after a transport error", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.signOut();
    assert.equal(result.ok, false);
    assert.equal(result.error?.includes("network unavailable"), true);
    assert.equal(client.auth.session.get(), null);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-010c direct account deletion clears durable credentials", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const { restore } = mockFetch({ success: true });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.user.delete({ password: "secret" });
    assert.equal(result.ok, true);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    restore();
  }
});

test("T-RN-010d passwordless account deletion keeps credentials pending confirmation", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const { restore } = mockFetch({ status: true });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.user.delete();
    assert.equal(result.ok, true);
    assert.equal(await tokenStore.getAccessToken(), "access-token");
    assert.equal(await tokenStore.getSessionToken(), "session-token");
  } finally {
    restore();
  }
});

test("T-RN-010e verified passwordless deletion clears durable credentials", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    return pathname.endsWith("/delete-user/verify")
      ? new Response(JSON.stringify({ status: true, success: true }), {
          status: 200,
        })
      : new Response("null", {
          headers: { "content-type": "application/json" },
          status: 200,
        });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.deleteUserVerify({
      query: { token: "delete-token" },
    });
    assert.equal(result.ok, true);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-DELETE-VERIFY-001 reconciles the session after verified deletion", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  let getSessionCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/delete-user/verify")) {
      return new Response(JSON.stringify({ status: true, success: true }), {
        status: 200,
      });
    }
    if (pathname.endsWith("/get-session")) {
      getSessionCalls += 1;
      return new Response("null", {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await client.auth.deleteUserVerify({
      query: { token: "delete-token" },
    });
    assert.equal(getSessionCalls, 1);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-DELETE-CALLBACK-001 reconciles the session after callback deletion", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  let getSessionCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/delete-user/callback")) {
      return new Response(JSON.stringify({ status: true, success: true }), {
        status: 200,
      });
    }
    if (pathname.endsWith("/get-session")) {
      getSessionCalls += 1;
      return new Response("null", {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await client.auth.deleteUser.callback({ token: "delete-token" });
    assert.equal(getSessionCalls, 1);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-DELETE-TOKEN-OTHER-001 preserves the current user after deleting another user", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "user-b-access-token",
    sessionToken: "user-b-session-token",
  });
  let getSessionCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/delete-user/callback")) {
      return new Response(JSON.stringify({ status: true, success: true }), {
        status: 200,
      });
    }
    if (pathname.endsWith("/get-session")) {
      getSessionCalls += 1;
      return new Response(
        JSON.stringify({
          session: {
            id: "user-b-session",
            token: "user-b-session-token",
            userId: "user-b",
          },
          user: { id: "user-b" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await client.auth.getSession();
    await client.auth.deleteUser.callback({ token: "user-a-delete-token" });
    assert.equal(getSessionCalls, 2);
    assert.equal(client.auth.session.get()?.user.id, "user-b");
    assert.equal(await tokenStore.getAccessToken(), "user-b-access-token");
    assert.equal(await tokenStore.getSessionToken(), "user-b-session-token");
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-011 session refresh persists a rotated session token", async () => {
  const tokenStore = createMemoryTokenStore({
    sessionToken: "old-session-token",
  });
  const { restore } = mockFetch({
    session: {
      id: "session-2",
      token: "rotated-session-token",
      userId: "user-1",
    },
    user: { id: "user-1" },
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.getSession();
    assert.equal(result.ok, true);
    assert.equal(await tokenStore.getSessionToken(), "rotated-session-token");
  } finally {
    restore();
  }
});

test("T-RN-012 persistence failures are typed and redact session tokens", async () => {
  const secretToken = "secret-session-token";
  const tokenStore = {
    async getAccessToken() {
      return null;
    },
    async getSessionToken() {
      return null;
    },
    async setAccessToken() {},
    async setSessionToken() {
      throw new Error(`storage rejected ${secretToken}`);
    },
  };
  const { restore } = mockFetch({
    token: secretToken,
    user: { id: "user-1" },
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await assert.rejects(
      client.auth.signIn.email({
        email: "user@example.com",
        password: "secret",
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ATHENA_AUTH_SESSION_PERSISTENCE_FAILED"
        );
        assert.equal(
          (error as { operation?: string }).operation,
          "persist"
        );
        assert.equal((error as Error).name, "AthenaAuthSessionPersistenceError");
        assert.equal((error as Error).message.includes(secretToken), false);
        assert.equal("cause" in (error as object), false);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("T-RN-012b clear attempts session-token deletion after access-token failure", async () => {
  const attempts: string[] = [];
  const tokenStore = {
    async getAccessToken() {
      return "access-token";
    },
    async getSessionToken() {
      return "session-token";
    },
    async setAccessToken(token: string | null) {
      attempts.push(`access:${token ?? "null"}`);
      throw new Error("secure access key unavailable");
    },
    async setSessionToken(token: string | null) {
      attempts.push(`session:${token ?? "null"}`);
    },
  };
  const { restore } = mockFetch({ success: true });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await assert.rejects(
      client.auth.signOut(),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ATHENA_AUTH_SESSION_PERSISTENCE_FAILED"
        );
        assert.equal((error as { operation?: string }).operation, "clear");
        assert.equal((error as Error).message.includes("secure"), false);
        return true;
      }
    );
    assert.deepEqual(attempts, ["access:null", "session:null"]);
  } finally {
    restore();
  }
});

test("T-RN-015 a stale getSession response cannot restore storage after sign-out", async () => {
  let releaseSession: (() => void) | undefined;
  const sessionResponse = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "old-session",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(String(url)).pathname.endsWith("/get-session")) {
      await sessionResponse;
      return new Response(
        JSON.stringify({
          session: {
            id: "old-session",
            token: "old-session",
            userId: "user-1",
          },
          user: { id: "user-1" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const refresh = client.auth.getSession();
    await Promise.resolve();
    await client.auth.signOut();
    releaseSession?.();
    await refresh;
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-016 sign-out waits behind an in-flight stale token write", async () => {
  let releaseWrite: (() => void) | undefined;
  const writeStarted = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let resolveWrite: (() => void) | undefined;
  const writeRelease = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  let sessionToken: string | null = "old-session";
  const tokenStore = {
    async getAccessToken() {
      return null;
    },
    async getSessionToken() {
      return sessionToken;
    },
    async setAccessToken() {},
    async setSessionToken(token: string | null) {
      if (token === "old-session") {
        releaseWrite?.();
        await writeRelease;
      }
      sessionToken = token;
    },
  };
  const { restore } = mockFetch({
    session: {
      id: "old-session",
      token: "old-session",
      userId: "user-1",
    },
    user: { id: "user-1" },
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const refresh = client.auth.getSession();
    await writeStarted;
    const signOut = client.auth.signOut();
    resolveWrite?.();
    await signOut;
    await refresh;
    assert.equal(sessionToken, null);
  } finally {
    restore();
  }
});

test("T-RN-016c contextual sign-out invalidates a root-view stale session write", async () => {
  let releaseSession: (() => void) | undefined;
  const sessionResponse = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  const tokenStore = createMemoryTokenStore({
    sessionToken: "old-session",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/get-session")) {
      await sessionResponse;
      return new Response(
        JSON.stringify({
          session: {
            id: "old-session",
            token: "old-session",
            userId: "user-1",
          },
          user: { id: "user-1" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const refresh = client.auth.getSession();
    await Promise.resolve();
    await client.withContext({ userId: "user-1" }).auth.signOut();
    releaseSession?.();
    await refresh;
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-016b a newer sign-in survives completion of an in-flight sign-out", async () => {
  let releaseSignOut: (() => void) | undefined;
  const signOutRelease = new Promise<void>((resolve) => {
    releaseSignOut = resolve;
  });
  const tokenStore = createMemoryTokenStore({
    sessionToken: "old-session",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/sign-out")) {
      await signOutRelease;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (pathname.endsWith("/sign-in/email")) {
      return new Response(
        JSON.stringify({
          token: "new-session",
          user: { id: "user-2" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ session: null, user: null }), {
      status: 200,
    });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const signOut = client.auth.signOut();
    await client.auth.signIn.email({
      email: "new@example.com",
      password: "secret",
    });
    releaseSignOut?.();
    await signOut;
    assert.equal(await tokenStore.getSessionToken(), "new-session");
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-016e overlapping sign-outs keep stale getSession blocked until both complete", async () => {
  const firstSignOut = deferred<void>();
  const secondSignOut = deferred<void>();
  const tokenStore = createMemoryTokenStore({
    accessToken: "old-access",
    sessionToken: "old-session",
  });
  let signOutCalls = 0;
  let getSessionCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/sign-out")) {
      signOutCalls += 1;
      await (signOutCalls === 1 ? firstSignOut.promise : secondSignOut.promise);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (pathname.endsWith("/get-session")) {
      getSessionCalls += 1;
      return new Response(
        JSON.stringify({
          session: {
            id: "stale-session",
            token: "stale-session",
            userId: "user-1",
          },
          user: { id: "user-1" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ session: null, user: null }), {
      status: 200,
    });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const first = client.auth.signOut();
    const second = client.auth.signOut();
    while (signOutCalls < 2) {
      await Promise.resolve();
    }

    firstSignOut.resolve();
    await first;
    const refresh = await client.auth.getSession();

    assert.equal(refresh.data, null);
    assert.equal(getSessionCalls, 0);

    secondSignOut.resolve();
    await second;
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-016d a sign-in started during getSession survives refresh completion", async () => {
  let releaseRefresh: (() => void) | undefined;
  const refreshRelease = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const tokenStore = createMemoryTokenStore();
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/get-session")) {
      await refreshRelease;
      return new Response(
        JSON.stringify({
          session: null,
          user: null,
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    if (pathname.endsWith("/sign-in/email")) {
      return new Response(
        JSON.stringify({
          token: "new-session",
          user: { id: "user-2" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const refresh = client.auth.getSession();
    await Promise.resolve();
    const signIn = client.auth.signIn.email({
      email: "new@example.com",
      password: "secret",
    });
    releaseRefresh?.();
    await refresh;
    const result = await signIn;
    assert.equal(result.ok, true);
    assert.equal(client.auth.session.get()?.user.id, "user-2");
    assert.equal(await tokenStore.getSessionToken(), "new-session");
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-016f a sign-in started before getSession survives null refresh completion", async () => {
  const releaseSignIn = deferred<void>();
  const tokenStore = createMemoryTokenStore();
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/sign-in/email")) {
      await releaseSignIn.promise;
      return new Response(
        JSON.stringify({
          token: "new-session",
          user: { id: "user-2" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    if (pathname.endsWith("/get-session")) {
      return new Response(JSON.stringify({ session: null, user: null }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const signIn = client.auth.signIn.email({
      email: "new@example.com",
      password: "secret",
    });
    await Promise.resolve();
    const refresh = client.auth.getSession();
    await refresh;
    releaseSignIn.resolve();
    const result = await signIn;
    assert.equal(result.ok, true);
    assert.equal(client.auth.session.get()?.user.id, "user-2");
    assert.equal(await tokenStore.getSessionToken(), "new-session");
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-017 an unauthenticated successful session response clears storage", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "old-session",
  });
  const { restore } = mockFetch(null, {
  headers: { "content-type": "application/json" },
  status: 200,
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    const result = await client.auth.getSession();
    assert.equal(result.ok, true);
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    restore();
  }
});

test("T-RN-017b a 401 clears the canonical session when durable clearing fails", async () => {
  const tokenStore = {
    async getAccessToken() {
      return "access-token";
    },
    async getSessionToken() {
      return "session-token";
    },
    async setAccessToken() {},
    async setSessionToken() {
      throw new Error("secure storage unavailable");
    },
  };
  const { restore } = mockFetch(
    { error: "expired" },
    { status: 401, headers: { "content-type": "application/json" } }
  );
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    client.auth.session.setSession({
      session: { id: "session-1", token: "session-token", userId: "user-1" },
      user: { id: "user-1" },
    });
    await assert.rejects(client.auth.getSession());
    assert.equal(client.auth.session.getSnapshot().session, null);
    assert.equal(
      client.auth.session.getSnapshot().status,
      "unauthenticated"
    );
  } finally {
    restore();
  }
});

test("T-RN-017c a null session clears the canonical session when durable clearing fails", async () => {
  const tokenStore = {
    async getAccessToken() {
      return "access-token";
    },
    async getSessionToken() {
      return "session-token";
    },
    async setAccessToken() {},
    async setSessionToken() {
      throw new Error("secure storage unavailable");
    },
  };
  const { restore } = mockFetch(null, {
    headers: { "content-type": "application/json" },
    status: 200,
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    client.auth.session.setSession({
      session: { id: "session-1", token: "session-token", userId: "user-1" },
      user: { id: "user-1" },
    });
    await assert.rejects(client.auth.getSession());
    assert.equal(client.auth.session.getSnapshot().session, null);
    assert.equal(
      client.auth.session.getSnapshot().status,
      "unauthenticated"
    );
  } finally {
    restore();
  }
});

test("T-RN-018 a stale getSession response cannot restore storage after revoke", async () => {
  let releaseSession: (() => void) | undefined;
  const sessionResponse = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "current-session",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/get-session")) {
      await sessionResponse;
      return new Response(
        JSON.stringify({
          session: {
            id: "old-session",
            token: "old-session",
            userId: "user-1",
          },
          user: { id: "user-1" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    client.auth.session.setSession({
      grants: [],
      rights: [],
      session: {
        id: "session-1",
        token: "current-session",
        userId: "user-1",
      },
      user: { id: "user-1" },
    });
    const refresh = client.auth.getSession();
    await Promise.resolve();
    await client.auth.session.revoke({ token: "current-session" });
    releaseSession?.();
    await refresh;
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("T-RN-019 a session response without token rotation preserves storage", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "current-session",
  });
  const { restore } = mockFetch({
    session: { id: "session-1", userId: "user-1" },
    user: { id: "user-1" },
  });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    await client.auth.getSession();
    assert.equal(await tokenStore.getSessionToken(), "current-session");
  } finally {
    restore();
  }
});

test("T-RN-013 revoking the current session clears durable credentials", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "current-session",
  });
  const { restore } = mockFetch({ success: true });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    client.auth.session.setSession({
      grants: [],
      rights: [],
      session: {
        id: "session-1",
        token: "current-session",
        userId: "user-1",
      },
      user: { id: "user-1" },
    });
    await client.auth.session.revoke({ token: "current-session" });
    assert.equal(await tokenStore.getAccessToken(), null);
    assert.equal(await tokenStore.getSessionToken(), null);
  } finally {
    restore();
  }
});

test("T-RN-014 revoking another session preserves durable credentials", async () => {
  const tokenStore = createMemoryTokenStore({
    accessToken: "access-token",
    sessionToken: "current-session",
  });
  const { restore } = mockFetch({ success: true });
  try {
    const client = createReactNativeClient({
      auth: { url: "https://auth.example.com/api/auth" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
      tokenStore,
    });
    client.auth.session.setSession({
      grants: [],
      rights: [],
      session: {
        id: "session-1",
        token: "current-session",
        userId: "user-1",
      },
      user: { id: "user-1" },
    });
    await client.auth.session.revoke({ token: "other-session" });
    assert.equal(await tokenStore.getAccessToken(), "access-token");
    assert.equal(await tokenStore.getSessionToken(), "current-session");
  } finally {
    restore();
  }
});

test("T-RN-005 react-native source must not import query builders or expo", async () => {
  const root = join(process.cwd(), "src", "react-native");
  const { readdir, readFile: rf } = await import("node:fs/promises");
  const names = await readdir(root);
  const banned =
    /from\s+["']react-native["']|from\s+["']expo|from\s+["'][^"']*query\/|assembleSql|buildFilter/i;
  for (const name of names) {
    if (!name.endsWith(".ts")) {
      continue;
    }
    const text = await rf(join(root, name), "utf8");
    assert.equal(banned.test(text), false, `forbidden pattern in ${name}`);
  }
});

test("T-RN-007 no prettier dependency in package.json", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.prettier, undefined);
  assert.equal(pkg.devDependencies?.prettier, undefined);
  assert.ok(pkg.devDependencies?.["@biomejs/biome"]);
  assert.ok(pkg.devDependencies?.ultracite);
});

test("T-RN-004 browser createClient and RN client emit identical query payloads", async () => {
  const { createClient } = await import("../src/v3-client.ts");
  const callsA: Captured[] = [];
  const callsB: Captured[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    callsA.push({ init, url: String(url) });
    return new Response(JSON.stringify({ data: [], status: 200 }), {
      status: 200,
    });
  };
  try {
    const browserLike = createClient({
      db: { url: "https://athena-db.example" },
      key: "secret",
    });
    await browserLike
      .from("characters")
      .eq("role", "mage")
      .order("name", { ascending: true })
      .range(0, 9)
      .select("id,name");
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = async (url, init) => {
    callsB.push({ init, url: String(url) });
    return new Response(JSON.stringify({ data: [], status: 200 }), {
      status: 200,
    });
  };
  try {
    const rn = createReactNativeClient({
      db: { url: "https://athena-db.example" },
      key: "secret",
      tokenStore: createMemoryTokenStore(),
    });
    await rn
      .from("characters")
      .eq("role", "mage")
      .order("name", { ascending: true })
      .range(0, 9)
      .select("id,name");
  } finally {
    globalThis.fetch = original;
  }

  assert.ok(callsA.length >= 1 && callsB.length >= 1);
  const bodyA = JSON.parse(String(callsA[0].init?.body ?? "{}"));
  const bodyB = JSON.parse(String(callsB[0].init?.body ?? "{}"));
  assert.deepEqual(bodyB, bodyA);
  assert.equal(
    new URL(callsA[0].url).pathname,
    new URL(callsB[0].url).pathname
  );
});

test("T-RN-004 insert/update/delete payloads match between createClient and RN", async () => {
  const { createClient } = await import("../src/v3-client.ts");

  async function capture(
    run: (client: AthenaClient<undefined>) => Promise<void>
  ): Promise<unknown[]> {
    const calls: Captured[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ init, url: String(url) });
      return new Response(JSON.stringify({ data: null, status: 200 }), {
        status: 200,
      });
    };
    try {
      const client = createReactNativeClient({
        db: { url: "https://athena-db.example" },
        key: "secret",
      });
      await run(client);
    } finally {
      globalThis.fetch = original;
    }
    return calls.map((c) => JSON.parse(String(c.init?.body ?? "{}")));
  }

  async function captureCore(
    run: (client: AthenaClient<undefined>) => Promise<void>
  ): Promise<unknown[]> {
    const calls: Captured[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ init, url: String(url) });
      return new Response(JSON.stringify({ data: null, status: 200 }), {
        status: 200,
      });
    };
    try {
      const client = createClient({
        db: { url: "https://athena-db.example" },
        key: "secret",
      });
      await run(client);
    } finally {
      globalThis.fetch = original;
    }
    return calls.map((c) => JSON.parse(String(c.init?.body ?? "{}")));
  }

  const coreBodies = await captureCore(async (c) => {
    await c.from("characters").insert({ name: "Aragorn" });
    await c.from("characters").update({ name: "Strider" }).eq("id", 1);
    await c.from("characters").delete({ resourceId: "abc" });
  });
  const rnBodies = await capture(async (c) => {
    await c.from("characters").insert({ name: "Aragorn" });
    await c.from("characters").update({ name: "Strider" }).eq("id", 1);
    await c.from("characters").delete({ resourceId: "abc" });
  });
  assert.deepEqual(rnBodies, coreBodies);
});
