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
  assert.equal(typeof session.revoke, "function");
});

test("setSession cancels in-flight refresh (setActive wins over stale getSession)", () => {
  const store = createAthenaAuthSessionStore<{
    session: { id: string; activeOrganizationId?: string | null };
    user: { id: string; email: string };
  }>();

  store.setSession({
    session: { id: "s1", activeOrganizationId: "org-a" },
    user: { id: "u1", email: "a@example.com" },
  });

  const flight = store.beginRefresh();
  assert.equal(flight.skipped, false);

  // setActive-style authoritative patch
  store.setSession({
    session: { id: "s1", activeOrganizationId: "org-b" },
    user: { id: "u1", email: "a@example.com" },
  });

  // Stale getSession completes with org-a — must be ignored
  store.completeRefresh(flight.epoch, {
    ok: true,
    session: {
      session: { id: "s1", activeOrganizationId: "org-a" },
      user: { id: "u1", email: "a@example.com" },
    },
  });

  assert.equal(
    store.getSnapshot().session?.session.activeOrganizationId,
    "org-b"
  );
  assert.equal(store.getSnapshot().status, "authenticated");
});

test("signIn.email updates session store from token+user payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        redirect: false,
        token: "tok_abc",
        user: { id: "u1", email: "a@example.com" },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
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
