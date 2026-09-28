import assert from "node:assert/strict";
import test from "node:test";
import { createAthenaAuthSessionStore } from "../src/auth/session-store.ts";

test("session store last-authoritative wins and single-flight refresh", async () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  const seen: number[] = [];
  store.subscribe((s) => seen.push(s.epoch));

  const a = store.beginRefresh();
  assert.equal(a.skipped, false);
  const b = store.beginRefresh();
  assert.equal(b.skipped, true);
  assert.equal(b.epoch, a.epoch);

  store.completeRefresh(a.epoch, { ok: true, session: { id: "s1" } });
  assert.equal(store.getSnapshot().session?.id, "s1");
  assert.equal(store.getSnapshot().status, "authenticated");

  // Stale completion ignored
  store.completeRefresh(a.epoch, { ok: true, session: { id: "stale" } });
  assert.equal(store.getSnapshot().session?.id, "s1");
});

test("signOut invalidates in-flight refresh", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  store.setSession({ id: "s1" });
  const flight = store.beginRefresh();
  store.invalidate("signOut");
  store.completeRefresh(flight.epoch, { ok: true, session: { id: "s2" } });
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().status, "unauthenticated");
});

test("aborted get-session does not become a session error", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  const flight = store.beginRefresh();
  assert.equal(store.getSnapshot().status, "loading");
  store.completeRefresh(flight.epoch, {
    error:
      "Network error while calling GET /get-session: signal is aborted without reason",
    ok: false,
  });
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().status, "unauthenticated");
});

test("aborted refresh keeps an existing session", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  store.setSession({ id: "s1" });
  const flight = store.beginRefresh();
  store.completeRefresh(flight.epoch, {
    error: { message: "signal is aborted without reason" },
    ok: false,
  });
  assert.equal(store.getSnapshot().session?.id, "s1");
  assert.equal(store.getSnapshot().status, "authenticated");
  assert.equal(store.getSnapshot().error, null);
});

test("setError does not clear valid session", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  store.setSession({ id: "s1" });
  store.setError(new Error("upstream down"));
  assert.equal(store.getSnapshot().session?.id, "s1");
  assert.equal(store.getSnapshot().status, "authenticated");
  assert.ok(store.getSnapshot().error);
});

test("subscribers notified in registration order", () => {
  const store = createAthenaAuthSessionStore();
  const order: number[] = [];
  store.subscribe(() => order.push(1));
  store.subscribe(() => order.push(2));
  store.setSession(null, "unauthenticated");
  assert.deepEqual(order, [1, 2]);
});

test("auth module session exposes snapshot store alongside revoke", async () => {
  const { createAuthModule } = await import("../src/auth/client.ts");
  const mod = createAuthModule({
    baseUrl: "https://auth.example.test",
    key: "test-key",
  });
  const session = mod.auth.session as typeof mod.auth.session & {
    getSnapshot: () => { status: string };
    hydrate: (state: {
      status: "authenticated" | "unauthenticated";
      session: unknown;
    }) => boolean;
    refresh: () => Promise<unknown>;
    setSession: (s: unknown, status?: string) => void;
    subscribe: (l: (s: unknown) => void) => () => void;
    revoke: (input: unknown) => Promise<unknown>;
  };
  const snap = session.getSnapshot();
  assert.equal(snap.status, "unknown");
  assert.equal(typeof session.subscribe, "function");
  assert.equal(typeof session.refresh, "function");
  assert.equal(typeof session.setSession, "function");
  assert.equal(typeof session.hydrate, "function");
  assert.equal(typeof session.revoke, "function");
});

test("hydrate seeds unknown store and does not override later mutations", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  const session = { id: "s1" };

  assert.equal(store.hydrate({ session, status: "authenticated" }), true);
  assert.equal(store.getSnapshot().status, "authenticated");
  assert.equal(store.getSnapshot().session?.id, "s1");

  assert.equal(store.hydrate({ session, status: "authenticated" }), false);
  assert.equal(
    store.hydrate({ session: null, status: "unauthenticated" }),
    false
  );
  assert.equal(store.getSnapshot().session?.id, "s1");

  store.setSession({ id: "s2" });
  assert.equal(
    store.hydrate({ session: { id: "s1" }, status: "authenticated" }),
    false
  );
  assert.equal(store.getSnapshot().session?.id, "s2");
});

test("hydrate unauthenticated is valid for a cold store", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  assert.equal(
    store.hydrate({ session: null, status: "unauthenticated" }),
    true
  );
  assert.equal(store.getSnapshot().status, "unauthenticated");
  assert.equal(store.getSnapshot().session, null);
});

test("hydrate does not start a refresh", () => {
  const store = createAthenaAuthSessionStore<{ id: string }>();
  store.hydrate({ session: { id: "s1" }, status: "authenticated" });
  assert.equal(store.getSnapshot().status, "authenticated");
  const flight = store.beginRefresh();
  assert.equal(flight.skipped, false);
  assert.equal(store.getSnapshot().status, "loading");
  assert.equal(store.getSnapshot().session?.id, "s1");
});

test("setSession cancels in-flight refresh (setActive wins over stale getSession)", () => {
  const store = createAthenaAuthSessionStore<{
    session: { id: string; activeOrganizationId?: string | null };
    user: { id: string; email: string };
  }>();

  store.setSession({
    session: { activeOrganizationId: "org-a", id: "s1" },
    user: { email: "a@example.com", id: "u1" },
  });

  const flight = store.beginRefresh();
  assert.equal(flight.skipped, false);

  // setActive-style authoritative patch
  store.setSession({
    session: { activeOrganizationId: "org-b", id: "s1" },
    user: { email: "a@example.com", id: "u1" },
  });

  // Stale getSession completes with org-a — must be ignored
  store.completeRefresh(flight.epoch, {
    ok: true,
    session: {
      session: { activeOrganizationId: "org-a", id: "s1" },
      user: { email: "a@example.com", id: "u1" },
    },
  });

  assert.equal(
    store.getSnapshot().session?.session.activeOrganizationId,
    "org-b"
  );
  assert.equal(store.getSnapshot().status, "authenticated");
});

test("concurrent getSession does not return session_loading as a request error", async () => {
  let releaseHang: (() => void) | undefined;
  const hang = new Promise<void>((resolve) => {
    releaseHang = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    await hang;
    return new Response(
      JSON.stringify({
        session: { id: "s1", token: "tok", userId: "u1" },
        user: { email: "a@example.com", id: "u1" },
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    );
  }) as typeof fetch;

  try {
    const { createAuthModule } = await import("../src/auth/client.ts");
    const mod = createAuthModule({
      apiKey: "test-key",
      baseUrl: "https://auth.example.test",
    });
    const first = mod.auth.getSession();
    const coalesced = mod.auth.getSession();
    releaseHang?.();
    const [settled, joined] = await Promise.all([first, coalesced]);
    assert.notEqual(joined.error, "session_loading");
    assert.equal(joined.ok, true);
    assert.equal(settled.ok, true);
    assert.equal(joined.data?.user?.id ?? settled.data?.user?.id, "u1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signIn.email updates session store from token+user payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        redirect: false,
        token: "tok_abc",
        user: { email: "a@example.com", id: "u1" },
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    )) as typeof fetch;

  try {
    const { createAuthModule } = await import("../src/auth/client.ts");
    const mod = createAuthModule({
      baseUrl: "https://auth.example.test",
      key: "test-key",
    });

    const result = await mod.auth.signIn.email({
      email: "a@example.com",
      password: "password-long-enough",
    });
    assert.equal(result.ok, true);
    const snap = mod.auth.session.getSnapshot();
    assert.equal(snap.status, "authenticated");
    assert.equal(snap.session?.user.id, "u1");
    assert.equal(snap.session?.session.token, "tok_abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delayed sign-in after signOut cannot restore the invalidated session", async () => {
  let releaseSignIn: (() => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/sign-in/email")) {
      await new Promise<void>((resolve) => {
        releaseSignIn = resolve;
      });

      return new Response(
        JSON.stringify({
          redirect: false,
          token: "stale-token",
          user: { email: "stale@example.com", id: "stale-user" },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const { createAuthModule } = await import("../src/auth/client.ts");
    const mod = createAuthModule(
      {
        apiKey: "test-key",
        baseUrl: "https://auth.example.test",
      },
      {
        sessionPersistence: {
          clearSession: async () => {},
          persistSessionToken: async () => {},
        },
      }
    );
    const signIn = mod.auth.signIn.email({
      email: "stale@example.com",
      password: "password-long-enough",
    });
    await mod.auth.signOut();
    releaseSignIn?.();
    const result = await signIn;

    assert.equal(result.ok, true);
    assert.equal(mod.auth.session.getSnapshot().session, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getSession after signOut invalidation cannot revive durable auth", async () => {
  let releaseSignOut: (() => void) | undefined;
  let getSessionCalls = 0;
  let sessionToken = "old-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/sign-out")) {
      await new Promise<void>((resolve) => {
        releaseSignOut = resolve;
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    getSessionCalls += 1;
    return new Response(
      JSON.stringify({
        session: {
          id: "stale-session",
          token: "stale-token",
          userId: "old-user",
        },
        user: { email: "old@example.com", id: "old-user" },
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    );
  }) as typeof fetch;

  try {
    const { createAuthModule } = await import("../src/auth/client.ts");
    const mod = createAuthModule(
      {
        apiKey: "test-key",
        baseUrl: "https://auth.example.test",
      },
      {
        sessionPersistence: {
          clearSession: async () => {
            sessionToken = "";
          },
          persistSessionToken: async (token: string) => {
            sessionToken = token;
          },
        },
      }
    );

    const signOut = mod.auth.signOut();
    const refresh = await mod.auth.getSession();
    assert.equal(refresh.data, null);
    assert.equal(getSessionCalls, 0);
    releaseSignOut?.();
    await signOut;
    assert.equal(sessionToken, "");
    assert.equal(mod.auth.session.getSnapshot().session, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
