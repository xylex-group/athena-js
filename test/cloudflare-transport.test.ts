import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  createCloudflareClient,
  createCloudflareD1GatewayTransport,
} from "../src/cloudflare/index.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
  R2BucketLike,
} from "../src/cloudflare/types.ts";

/** Default INTEGER PRIMARY KEY so bounded UPDATE/DELETE resolve identity. */
const DEFAULT_BOUNDED_IDENTITY_TABLE_INFO = [
  {
    cid: 0,
    dflt_value: null,
    name: "id",
    notnull: 0,
    pk: 1,
    type: "INTEGER",
  },
];

function createRecordingD1(options?: { rows?: unknown[] }) {
  const log: Array<{
    sql: string;
    params: unknown[];
    kind: "all" | "run" | "batch";
  }> = [];
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      log.push({ kind: "batch", params: [statements.length], sql: "BATCH" });
      return Promise.all(statements.map((s) => s.run()));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          log.push({ kind: "all", params: bound, sql: query });
          if (/COUNT\(\*\)/i.test(query)) {
            return {
              meta: { duration: 1 },
              results: [{ __athena_count: 42 } as T],
              success: true,
            };
          }
          // Bounded mutations introspect schema; empty PRAGMA rows fail identity.
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { duration: 1 },
              results: DEFAULT_BOUNDED_IDENTITY_TABLE_INFO as T[],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            // Empty list ⇒ INTEGER PRIMARY KEY is a true rowid alias.
            return { meta: { duration: 1 }, results: [] as T[], success: true };
          }
          if (options?.rows) {
            return {
              meta: { duration: 1 },
              results: options.rows as T[],
              success: true,
            };
          }
          return { meta: { duration: 1 }, results: [] as T[], success: true };
        },
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          log.push({ kind: "run", params: bound, sql: query });
          return { meta: { changes: 1 }, results: [] as T[], success: true };
        },
      };
      return statement;
    },
  };
  return { db: db as D1DatabaseLike, log };
}

function createMockR2(): R2BucketLike & { keys: string[] } {
  const store = new Map<string, Uint8Array>();
  return {
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        store.delete(key);
      }
      this.keys = [...store.keys()];
    },
    async get(key: string) {
      const bytes = store.get(key);
      if (!bytes) {
        return null;
      }
      return {
        async arrayBuffer() {
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          return copy.buffer;
        },
        async blob() {
          return new Blob([
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            ) as ArrayBuffer,
          ]);
        },
        async json() {
          return JSON.parse(new TextDecoder().decode(bytes));
        },
        key,
        size: bytes.byteLength,
        async text() {
          return new TextDecoder().decode(bytes);
        },
      };
    },
    keys: [] as string[],
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      const objects = [...store.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, bytes]) => ({ key, size: bytes.byteLength }));
      return { objects, truncated: false };
    },
    async put(key: string, value: string | Uint8Array | ArrayBuffer | null) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array();
      store.set(key, bytes);
      this.keys = [...store.keys()];
      return { key };
    },
  } as R2BucketLike & { keys: string[] };
}

test("transport head fetch returns empty data and COUNT", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway({
    conditions: [{ column: "active", operator: "eq", value: true }],
    head: true,
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data, []);
  assert.equal(response.count, 42);
  assert.ok(
    log.some((entry) => /COUNT\(\*\) AS __athena_count/.test(entry.sql))
  );
});

test("transport runs sparse multi-row insert as batch", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.insertGateway({
    insert_body: [{ name: "a", role: "admin" }, { name: "b" }],
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.ok(log.some((entry) => entry.kind === "batch"));
  assert.ok(
    log.filter((entry) => entry.kind === "run").length >= 2 ||
      log.some((entry) => entry.kind === "batch")
  );
  // No RETURNING → empty results arrays; count must sum meta.changes.
  assert.equal(response.count, 2);
});

test("transport delete with limit/offset uses rowid subquery", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.deleteGateway({
    conditions: [{ column: "expired", operator: "eq", value: true }],
    limit: 10,
    offset: 0,
    table_name: "events",
  });
  assert.equal(response.ok, true);
  assert.ok(log.some((entry) => entry.sql.includes('DELETE FROM "events"')));
  assert.ok(log.some((entry) => entry.sql.includes('"id" IN')));
  assert.ok(log.some((entry) => entry.sql.includes("LIMIT 10")));
});

test("transport update with page bounds uses rowid subquery", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.updateGateway({
    conditions: [{ column: "active", operator: "eq", value: 1 }],
    current_page: 1,
    page_size: 10,
    sort_by: { direction: "ascending", field: "id" },
    table_name: "users",
    update_body: { name: "x" },
  });
  assert.equal(response.ok, true);
  assert.ok(log.some((entry) => entry.sql.includes('"id" IN')));
  assert.ok(log.some((entry) => entry.sql.includes("LIMIT 10")));
});

test("transport update with limit/offset uses rowid subquery", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.updateGateway({
    conditions: [{ column: "pending", operator: "eq", value: true }],
    limit: 1,
    offset: 0,
    table_name: "events",
    update_body: { done: true },
  });
  assert.equal(response.ok, true);
  assert.ok(log.some((entry) => entry.sql.includes('UPDATE "events"')));
  assert.ok(log.some((entry) => entry.sql.includes('"id" IN')));
  assert.ok(log.some((entry) => entry.sql.includes("LIMIT 1")));
});

test("transport fetch strips null keys by default", async () => {
  const { db } = createRecordingD1({
    rows: [{ id: 1, name: "a", nickname: null }],
  });
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway({
    strip_nulls: true,
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data, [{ id: 1, name: "a" }]);
});

test("transport fetch keeps null keys when strip_nulls is false", async () => {
  const { db } = createRecordingD1({
    rows: [{ id: 1, name: "a", nickname: null }],
  });
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway({
    strip_nulls: false,
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data, [{ id: 1, name: "a", nickname: null }]);
});

test("transport head insert omits RETURNING and reports changes count", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.insertGateway({
    columns: "id,email",
    head: true,
    insert_body: { email: "a@example.com" },
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data, []);
  assert.equal(response.count, 1);
  assert.ok(log.some((entry) => entry.sql.includes('INSERT INTO "users"')));
  assert.equal(
    log.some((entry) => entry.sql.includes("RETURNING")),
    false
  );
});

test("transport fetch compiles response aliases", async () => {
  const { db, log } = createRecordingD1({
    rows: [{ user_email: "a@example.com", user_id: 1 }],
  });
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway({
    columns: "user_id:id, user_email:email",
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.ok(log.some((entry) => entry.sql.includes('"id" AS "user_id"')));
  assert.ok(log.some((entry) => entry.sql.includes('"email" AS "user_email"')));
  assert.deepEqual(response.data, [
    { user_email: "a@example.com", user_id: 1 },
  ]);
});

test("transport delete with page bounds uses rowid subquery", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.deleteGateway({
    conditions: [{ column: "active", operator: "eq", value: 1 }],
    current_page: 2,
    page_size: 5,
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.ok(log.some((entry) => entry.sql.includes('DELETE FROM "users"')));
  assert.ok(log.some((entry) => entry.sql.includes('"id" IN')));
  assert.ok(log.some((entry) => entry.sql.includes("OFFSET 5")));
});

test("createCloudflareClient end-to-end head via from().select", async () => {
  const { db } = createRecordingD1();
  const client = createCloudflareClient({ d1: db });
  const result = await client
    .from("users")
    .eq("active", true)
    .select("*", { head: true });
  assert.equal(result.error, null);
  assert.equal(result.count, 42);
});

test("createCloudflareClient R2 round-trip with prefix", async () => {
  const { db } = createRecordingD1();
  const r2 = createMockR2();
  const client = createCloudflareClient({
    d1: db,
    r2,
    storagePrefix: "tenant/",
  });
  const put = await client.storage.putObject({ body: "hello", key: "a.txt" });
  assert.equal(put.key, "a.txt");
  assert.ok(r2.keys.includes("tenant/a.txt"));
  const got = await client.storage.getObject({ key: put.key });
  assert.ok(got);
  assert.equal(got.key, "a.txt");
  assert.equal(await got.body.text(), "hello");
  const listed = await client.storage.listObjects({ prefix: "" });
  assert.equal(listed.objects.length, 1);
  assert.equal(listed.objects[0]?.key, "a.txt");
  const deleted = await client.storage.deleteObject({
    key: listed.objects[0]?.key,
  });
  assert.deepEqual(deleted.deleted, ["a.txt"]);
  assert.equal(r2.keys.length, 0);
});

test("capabilities reflect r2 and hybrid auth", () => {
  const { db } = createRecordingD1();
  const r2 = createMockR2();
  const local = createCloudflareClient({ d1: db });
  assert.equal(local.capabilities.storage.objects, false);
  assert.equal(local.capabilities.storage.local, false);
  assert.equal(local.capabilities.auth.remote, false);

  const hybrid = createCloudflareClient({
    auth: { url: "https://auth.example.com" },
    d1: db,
    key: "k",
    r2,
  });
  assert.equal(hybrid.capabilities.mode, "cloudflare-edge");
  assert.equal(hybrid.capabilities.storage.objects, true);
  assert.equal(hybrid.capabilities.storage.local, true);
  assert.equal(hybrid.capabilities.auth.remote, true);
  assert.equal(hybrid.capabilities.db.layers.rpc, false);
});

test("hybrid url without R2 advertises remote storage.objects", () => {
  const { db } = createRecordingD1();
  const hybrid = createCloudflareClient({
    d1: db,
    key: "k",
    url: "https://athena.example.com",
  });
  assert.equal(hybrid.capabilities.storage.objects, true);
  assert.equal(hybrid.capabilities.storage.local, false);
  assert.equal(hybrid.capabilities.auth.remote, true);
});

test("hybrid billing routes to remote root not D1 sentinel", async () => {
  const { db } = createRecordingD1();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    const client = createCloudflareClient({
      d1: db,
      key: "k",
      url: "https://athena.example.com",
    });
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /^https:\/\/athena\.example\.com\//);
    assert.equal(calls[0]?.includes("athena.local"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rpc fails clearly on edge transport", async () => {
  const { db } = createRecordingD1();
  const client = createCloudflareClient({ d1: db });
  const result = await client.rpc("nope", {});
  assert.ok(result.error);
  assert.match(result.error?.message ?? "", /RPC is unsupported|unsupported/i);
});
