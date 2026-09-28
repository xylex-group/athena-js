/**
 * PR #767 review-comment regressions. Each title is `P?: <exact subject>`.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { NOTIFICATION_CATALOG } from "../../src/notifications/catalog.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function resolveRelativeImport(fromRel: string, spec: string): string {
  const base = dirname(join(srcRoot, fromRel));
  const raw = join(base, spec);
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, join(raw, "index.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return raw;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function mockTransport(): AthenaGatewayClient {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
  return {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
}

test("P?: Restore the existing social-config import", async () => {
  const v3 = readSrc("v3-client.ts");
  const runtime = readSrc("auth/local/social/runtime.ts");
  const specs = [
    ...v3.matchAll(/\bfrom\s+["']([^"']*social-config[^"']*)["']/g),
    ...runtime.matchAll(/\bfrom\s+["']([^"']*social-config[^"']*)["']/g),
  ].map((match) => match[1] ?? "");
  assert.ok(specs.length > 0, "expected a social-config import");
  assert.equal(
    specs.some((spec) => spec.includes("social-config-core")),
    false,
    "social-config-core.ts does not exist; import social-config.ts"
  );
  assert.equal(
    existsSync(join(srcRoot, "auth/social/server/social-config.ts")),
    true
  );
  assert.equal(
    existsSync(join(srcRoot, "auth/social/server/social-config-core.ts")),
    false
  );
  for (const spec of specs) {
    if (!(spec.startsWith("./") || spec.startsWith("../"))) {
      continue;
    }
    const fromRel = v3.includes(spec)
      ? "v3-client.ts"
      : "auth/local/social/runtime.ts";
    assert.equal(
      existsSync(resolveRelativeImport(fromRel, spec)),
      true,
      `missing ${spec} from ${fromRel}`
    );
  }
  await import("../../src/v3-client.ts");
});

test("P?: Select the notifications transport from the runtime", () => {
  const core = readSrc("v3-client-assembly.ts");
  const node = readSrc("v3-client.ts");
  assert.equal(
    /transport:\s*"embedded"/.test(core),
    false,
    "createClientView must not hard-code embedded Memory for every client"
  );
  assert.match(
    core,
    /transport:\s*[\s\S]{0,80}attachEmbeddedHttpNotifications \|\| useRemoteNotifications/
  );
  assert.match(node, /createPostgresNotificationPreferenceStore/);
  assert.match(node, /attachLocalNotificationsRuntime/);
  assert.equal(/void client\.notifications/.test(node), false);
});

test("P?: Add generation 29 to the executed Auth migration ledger", () => {
  const schema = readSrc("auth/schema/migrations.ts");
  assert.match(schema, /name:\s*"029_notification_preferences"/);
  assert.match(
    schema,
    /CREATE TABLE IF NOT EXISTS athena\.notification_preferences/
  );
  assert.match(
    schema,
    /ATHENA_AUTH_SCHEMA_STATEMENTS[\s\S]*029_notification_preferences[\s\S]*version:\s*29/
  );
});

test("P?: Resolve notification identity for the Auth UI root client", async () => {
  const core = readSrc("v3-client-assembly.ts");
  assert.match(core, /getUserId:/);
  assert.match(core, /userIdFromAuthSession/);
  assert.match(core, /auth\?\.session|auth\.session/);
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        item: {
          channel: "email",
          digest: null,
          enabled: false,
          source: "user",
          topic: "security.login",
        },
      }),
      { status: 200 }
    );
  try {
    const { createClient } = await import("../../src/v3-client.ts");
    const client = createClient({
      auth: {
        mode: "remote",
        url: "https://auth.example.test",
      },
      env: {},
      notifications: { catalog: NOTIFICATION_CATALOG },
    });
    client.auth.session.setSession({
      session: { id: "sess-pr767", userId: "user-pr767" },
      user: { email: "pr767@example.test", id: "user-pr767" },
    });
    const updated = await client.notifications.preferences.update({
      channel: "email",
      enabled: false,
      topic: "security.login",
    });
    assert.equal(updated.item.enabled, false);
    assert.equal(updated.item.source, "user");
    await assert.rejects(
      () =>
        createClient({
          auth: {
            mode: "remote",
            url: "https://auth.example.test",
          },
          env: {},
          notifications: { catalog: NOTIFICATION_CATALOG },
        }).notifications.preferences.update({
          channel: "email",
          enabled: true,
          topic: "security.login",
        }),
      (error: unknown) =>
        errorCode(error) === "ATHENA_NOTIFICATIONS_UNAUTHENTICATED"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("P?: Restore local storage lifecycle wrapping", async () => {
  const core = readSrc("v3-client-assembly.ts");
  const contracts = readSrc("client/contracts.ts");
  const node = readSrc("v3-client.ts");
  assert.match(core, /wrapStorageModuleWithRuntime/);
  assert.match(core, /boundStorage/);
  assert.match(core, /storageRuntime/);
  assert.match(contracts, /lifecycle\?:\s*\{[\s\S]*storage\?:/);
  assert.match(node, /storageRuntime/);
  const { createClient } = await import("../../src/v3-client.ts");
  const root = mkdtempSync(join(tmpdir(), "athena-pr767-storage-"));
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_pr767",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root },
  });
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.storageRuntime);
});

test("P?: Encode remote list filters as query parameters", async () => {
  const { createRemoteNotificationsModule } = await import(
    "../../src/notifications/module.ts"
  );
  const calls: Array<{
    body?: Record<string, unknown>;
    method: string;
    path: string;
    query?: Record<string, unknown>;
  }> = [];
  const mod = createRemoteNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    getUserId: () => "user-pr767",
    request: async (input) => {
      calls.push(input);
      return { items: [] };
    },
  });
  await mod.preferences.list();
  await mod.preferences.list({ organizationId: "org-pr767" });
  await mod.list();
  await mod.list({ unread: true });

  for (const call of calls) {
    if (call.method === "GET") {
      assert.equal(
        call.body,
        undefined,
        "GET notifications list must not send a JSON body"
      );
    }
  }
  assert.equal(calls[0]?.path, "/notifications/v1/preferences");
  assert.notDeepEqual(calls[0]?.body, { organizationId: null });
  assert.equal(calls[0]?.query, undefined);
  assert.deepEqual(calls[1]?.query, { organizationId: "org-pr767" });
  assert.equal(calls[2]?.path, "/notifications/v1/events");
  assert.equal(calls[2]?.query, undefined);
  assert.deepEqual(calls[3]?.query, { unread: true });

  const core = readSrc("v3-client-assembly.ts");
  assert.match(core, /query:\s*input\.query/);
  assert.match(core, /input\.method === "GET" \|\| input\.method === "DELETE"/);
});

test("P?: Propagate failed remote notification responses", async () => {
  const { unwrapNotificationsGatewayResult } = await import(
    "../../src/notifications/module.ts"
  );
  await assert.rejects(
    async () => {
      unwrapNotificationsGatewayResult({
        data: { items: [] },
        ok: false,
        status: 401,
      });
    },
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_UNAUTHENTICATED"
  );
  await assert.rejects(
    async () => {
      unwrapNotificationsGatewayResult({
        data: { ok: true },
        ok: false,
        status: 404,
      });
    },
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND"
  );
  await assert.rejects(
    async () => {
      unwrapNotificationsGatewayResult({
        data: {},
        ok: false,
        status: 500,
      });
    },
    (error: unknown) => errorCode(error) === "ATHENA_NOTIFICATIONS_UNAVAILABLE"
  );
  const okPayload = unwrapNotificationsGatewayResult({
    data: { items: [] },
    ok: true,
    status: 200,
  });
  assert.deepEqual(okPayload, { items: [] });

  const core = readSrc("v3-client-assembly.ts");
  const remoteBlock = core.match(
    /remoteRequest:\s*attachEmbeddedHttpNotifications[\s\S]*?transport:/
  )?.[0];
  assert.ok(remoteBlock, "expected remoteRequest adapter");
  assert.match(remoteBlock, /unwrapNotificationsGatewayResult/);
  assert.equal(
    /return result\.data;/.test(remoteBlock),
    false,
    "adapter must not discard ok/status by returning result.data"
  );
});

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  if (!raw) {
    return {};
  }
  if (raw instanceof Headers) {
    return Object.fromEntries(raw.entries());
  }
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw);
  }
  return { ...(raw as Record<string, string>) };
}

test("P?: Route auth-only clients to a persistent notifications transport", async () => {
  const core = readSrc("v3-client-assembly.ts");
  assert.equal(
    /Boolean\(core\.urls\.db\);/.test(core),
    false,
    "auth-only clients must not require a DB URL for remote notifications"
  );
  assert.match(
    core,
    /core\.urls\.db\s*\|\|\s*core\.urls\.auth/,
    "remote notifications must accept auth.url when db is absent"
  );

  const original = globalThis.fetch;
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(
      JSON.stringify({
        item: {
          channel: "email",
          digest: null,
          enabled: false,
          source: "user",
          topic: "security.login",
        },
      }),
      { status: 200 }
    );
  };
  try {
    const { createClient } = await import("../../src/v3-client.ts");
    const client = createClient({
      auth: {
        credentials: "include",
        url: "https://auth.example.test",
      },
      env: {},
      key: "pr767-auth-only",
      notifications: { catalog: NOTIFICATION_CATALOG },
    });
    client.auth.session.setSession({
      session: { id: "sess-auth-only", userId: "user-auth-only" },
      user: { email: "auth-only@example.test", id: "user-auth-only" },
    });
    await client.notifications.preferences.update({
      channel: "email",
      enabled: false,
      topic: "security.login",
    });
    assert.ok(
      calls.length > 0,
      "auth-only roots must not silently persist preferences in Memory"
    );
    assert.match(calls[0]?.url ?? "", /auth\.example\.test/);
    assert.match(calls[0]?.url ?? "", /\/notifications\/v1\/preferences/);
  } finally {
    globalThis.fetch = original;
  }
});

test("P?: Forward the canonical session identity on remote requests", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(
      JSON.stringify({
        item: {
          channel: "email",
          digest: null,
          enabled: false,
          source: "user",
          topic: "security.login",
        },
      }),
      { status: 200 }
    );
  };
  try {
    const { createClient } = await import("../../src/v3-client.ts");
    const client = createClient({
      auth: {
        credentials: "include",
        url: "https://auth.example.test",
      },
      env: {},
      key: "pr767-session-forward",
      notifications: { catalog: NOTIFICATION_CATALOG },
      url: "https://db.example.test",
    });
    client.auth.session.setSession({
      session: {
        id: "sess-forward",
        token: "session-token-forward",
        userId: "user-forward",
      },
      user: { email: "forward@example.test", id: "user-forward" },
    });
    await client.notifications.preferences.update({
      channel: "email",
      enabled: false,
      topic: "security.login",
    });
    assert.ok(calls.length > 0, "expected a remote notifications request");
    const headers = headersOf(calls[0]?.init);
    assert.equal(
      headers["X-User-Id"] ?? headers["x-user-id"],
      "user-forward",
      "session user must be forwarded on the gateway request"
    );
    assert.equal(
      headers["X-Athena-Auth-Session-Token"] ??
      headers["x-athena-auth-session-token"],
      "session-token-forward"
    );
    assert.equal(calls[0]?.init?.credentials, "include");
  } finally {
    globalThis.fetch = original;
  }
});

test("P?: Reject unauthenticated bulk read mutations", async () => {
  const { createEmbeddedNotificationsModule } = await import(
    "../../src/notifications/module.ts"
  );
  const mod = createEmbeddedNotificationsModule({
    getUserId: () => null,
  });
  await assert.rejects(
    () => mod.markAllRead(),
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_UNAUTHENTICATED"
  );
  const moduleSrc = readSrc("notifications/module.ts");
  const embeddedMarkAll = moduleSrc.match(
    /export function createEmbeddedNotificationsModule[\s\S]*?async markAllRead\(\)[\s\S]*?return \{ ok: true \};/
  )?.[0];
  assert.ok(embeddedMarkAll, "expected embedded markAllRead");
  assert.match(embeddedMarkAll, /requireUserId/);
  assert.equal(
    /if \(userId\) \{/.test(embeddedMarkAll),
    false,
    "unauthenticated markAllRead must not succeed as a no-op"
  );
});
