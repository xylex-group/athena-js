/**
 * One regression lock per Codex PR #508 P1/P2 finding on the Cloudflare edge adapter.
 * Titles match the review comment subjects for traceability.
 *
 * App-level Worker proxy issues (CORS / edge token / WebSocket rewrap) live in
 * apps/cloudflare-athena/test/edge-http.test.ts.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileD1Delete,
  compileD1Fetch,
  compileD1Insert,
  compileD1Update,
  createAthenaFromWorkerEnv,
  createAthenaRuntime,
  createAthenaRuntimeClient,
  createCloudflareClient,
  createCloudflareD1GatewayTransport,
  createCloudflareR2StorageModule,
  D1SqlCompileError,
  executeD1Batch,
  executeD1Query,
  isMultiStatement,
  resolveAthenaExecutionMode,
  resolveD1BoundedIdentityColumn,
  rewritePostgresSqlForSqlite,
  splitSqlStatements,
  sqlContainsKeywordOutsideLiterals,
} from "../src/cloudflare/index.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
  R2BucketLike,
} from "../src/cloudflare/types.ts";
import {
  CLOUDFLARE_EDGE_API_KEY,
  CLOUDFLARE_EDGE_BASE_URL,
} from "../src/cloudflare/types.ts";
import { createClient } from "../src/v3-client.ts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockD1(store?: {
  rows?: unknown[];
  changes?: number;
  inserts?: Array<{ sql: string; params: unknown[] }>;
  allCalls?: string[];
  runCalls?: string[];
  execCalls?: number;
  sessionBatch?: boolean;
}): D1DatabaseLike {
  const inserts = store?.inserts;
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      if (store) {
        store.sessionBatch = true;
      }
      // Use all() so SELECT/COUNT rows match real D1 batch result shapes.
      return Promise.all(
        statements.map((s: D1PreparedStatementLike) => s.all())
      );
    },
    async exec() {
      if (store) {
        store.execCalls = (store.execCalls ?? 0) + 1;
      }
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          store?.allCalls?.push(query);
          if (!/^\s*(select|with|pragma|explain)\b/i.test(query)) {
            inserts?.push({ params: bound, sql: query });
          }
          return {
            meta: { changes: store?.changes ?? 1, duration: 1 },
            results: (store?.rows ?? []) as T[],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          store?.runCalls?.push(query);
          inserts?.push({ params: bound, sql: query });
          return {
            meta: { changes: store?.changes ?? 1, duration: 1 },
            results: [] as T[],
            success: true,
          };
        },
      };
      return statement;
    },
    withSession() {
      return {
        batch: db.batch.bind(db),
        getBookmark: () => "bm-1",
        prepare: db.prepare.bind(db),
      };
    },
  };
  return db as D1DatabaseLike;
}

function createMockR2(): R2BucketLike & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
      }
    },
    async get(key) {
      const bytes = objects.get(key);
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
        httpMetadata: { contentType: "text/plain" },
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
    async list(options) {
      const prefix = options?.prefix ?? "";
      const listed = [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, bytes]) => ({ key, size: bytes.byteLength }));
      return { objects: listed, truncated: false };
    },
    objects,
    async put(key, value) {
      if (typeof value === "string") {
        objects.set(key, new TextEncoder().encode(value));
      } else if (value instanceof Uint8Array) {
        objects.set(key, value);
      } else {
        objects.set(key, new Uint8Array());
      }
      return { key };
    },
  } as R2BucketLike & { objects: Map<string, Uint8Array> };
}

// ===========================================================================
// P1
// ===========================================================================

test("P1: Update conflicts from inserted values by default", () => {
  const compiled = compileD1Insert({
    insert_body: { email: "a@example.com", name: "Ada" },
    on_conflict: "email",
    table_name: "users",
  });
  assert.match(compiled.sql, /DO UPDATE SET "name" = excluded\."name"/);
  assert.doesNotMatch(compiled.sql, /DO NOTHING/);
  assert.deepEqual(compiled.params, ["a@example.com", "Ada"]);
});

test("P1: Avoid DEFAULT tokens inside SQLite VALUES rows", () => {
  const compiled = compileD1Insert({
    insert_body: [{ name: "a", role: "admin" }, { name: "b" }],
    table_name: "users",
  });
  assert.ok(compiled.statements);
  for (const statement of compiled.statements!) {
    assert.equal(statement.sql.includes("DEFAULT"), false);
  }
  assert.equal(
    compiled.statements?.[1]?.sql,
    'INSERT INTO "users" ("name") VALUES (?)'
  );
});

test("P1: Preserve column defaults for sparse batch inserts", () => {
  // Sparse rows omit missing columns entirely so SQLite column defaults apply.
  const compiled = compileD1Insert({
    insert_body: [{ email: "a@x.com", role: "admin" }, { email: "b@x.com" }],
    table_name: "users",
  });
  assert.equal(compiled.statements?.length, 2);
  assert.equal(compiled.statements?.[0]?.sql.includes('"role"'), true);
  assert.equal(compiled.statements?.[1]?.sql.includes('"role"'), false);
});

const idIdentity = { identityColumn: "id" };

test("P1: Preserve pagination when compiling deletes", () => {
  const compiled = compileD1Delete(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      current_page: 2,
      page_size: 10,
      table_name: "users",
    },
    idIdentity
  );
  assert.match(compiled.sql, /"id" IN \(SELECT "id"/);
  assert.match(compiled.sql, /LIMIT 10 OFFSET 10/);
});

test("P1: Preserve pagination when compiling updates", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      current_page: 3,
      page_size: 5,
      table_name: "users",
      update_body: { name: "x" },
    },
    idIdentity
  );
  assert.match(compiled.sql, /"id" IN \(SELECT "id"/);
  assert.match(compiled.sql, /LIMIT 5 OFFSET 10/);
});

test("P1: Apply current_page when limit provides the bound", () => {
  // .limit(10).currentPage(2) â€” limit is the page length; OFFSET must be 10 not 0.
  const compiled = compileD1Update(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      current_page: 2,
      limit: 10,
      table_name: "users",
      update_body: { name: "x" },
    },
    idIdentity
  );
  assert.match(compiled.sql, /LIMIT 10 OFFSET 10/);
  assert.doesNotMatch(compiled.sql, /LIMIT 10(?! OFFSET)/);
});

test("P1: Preserve range bounds for D1 deletes", () => {
  const compiled = compileD1Delete(
    {
      conditions: [{ column: "expired", operator: "eq", value: true }],
      limit: 10,
      offset: 5,
      table_name: "events",
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'DELETE FROM "events" WHERE "id" IN (SELECT "id" FROM "events" WHERE "expired" = ? LIMIT 10 OFFSET 5)'
  );
});

test("P1: Propagate limit and range bounds into D1 updates", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "pending", operator: "eq", value: true }],
      limit: 1,
      offset: 2,
      table_name: "events",
      update_body: { done: true },
    },
    idIdentity
  );
  assert.match(compiled.sql, /LIMIT 1 OFFSET 2/);
  assert.match(compiled.sql, /"id" IN/);
});

test("P1: Require page_size for current_page mutations", () => {
  assert.throws(
    () =>
      compileD1Update(
        {
          conditions: [{ column: "active", operator: "eq", value: true }],
          current_page: 2,
          table_name: "users",
          update_body: { name: "x" },
        },
        idIdentity
      ),
    (error: unknown) =>
      error instanceof D1SqlCompileError && error.code === "page_without_size"
  );
});

test("P1: Resolve bounded mutations without assuming an id column", () => {
  // Pure compiler requires a proven identity from schema (transport supplies via PRAGMA).
  assert.throws(
    () =>
      compileD1Delete({
        conditions: [{ column: "active", operator: "eq", value: true }],
        limit: 1,
        table_name: "users",
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
  const withUuid = compileD1Delete(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      limit: 1,
      table_name: "events",
    },
    { identityColumn: "uuid" }
  );
  assert.match(withUuid.sql, /"uuid" IN \(SELECT "uuid"/);
  assert.doesNotMatch(withUuid.sql, /_rowid_|rowid IN/i);
});

test("P1: Preserve resource_id filters on D1 deletes", () => {
  const compiled = compileD1Delete({
    conditions: [
      { column: "resource_id", operator: "eq", value: "u1" },
      { column: "tenant_id", operator: "eq", value: "t1" },
    ],
    resource_id: "u1",
    table_name: "users",
  });
  assert.match(compiled.sql, /"resource_id" = \?/);
  assert.doesNotMatch(compiled.sql, /"id" = \?/);
  assert.match(compiled.sql, /"tenant_id" = \?/);
  assert.deepEqual(compiled.params, ["u1", "t1"]);
});

test("P1: Use all() for statements with RETURNING", async () => {
  const allCalls: string[] = [];
  const runCalls: string[] = [];
  const db = createMockD1({
    allCalls,
    rows: [{ email: "a@x.com", id: 1 }],
    runCalls,
  });
  const result = await executeD1Query(db, {
    params: ["a@x.com"],
    query: "INSERT INTO users (email) VALUES (?) RETURNING id, email",
  });
  assert.equal(result.ok, true);
  assert.equal(allCalls.length, 1);
  assert.equal(runCalls.length, 0);
  if (result.ok) {
    assert.deepEqual(result.rows, [{ email: "a@x.com", id: 1 }]);
  }
});

test("P1: Preserve SQL literals while rewriting planner casts", () => {
  const out = rewritePostgresSqlForSqlite(
    `SELECT 'id::uuid' AS label, "id"::uuid AS id WHERE note = '::text'`
  );
  assert.ok(out.includes("'id::uuid'"));
  assert.ok(out.includes("'::text'"));
  assert.ok(out.includes('"id" AS id'));
  assert.equal(out.includes('"id"::uuid'), false);
});

test("P1: Use SQLite syntax for UUID equality selects", async () => {
  const allCalls: string[] = [];
  const db = createMockD1({
    allCalls,
    rows: [{ id: "550e8400-e29b-41d4-a716-446655440000" }],
  });
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.queryGateway({
    query: `SELECT * FROM users WHERE id::uuid = '550e8400-e29b-41d4-a716-446655440000'::uuid`,
  });
  assert.equal(response.ok, true);
  assert.equal(allCalls.length, 1);
  assert.equal(allCalls[0]?.includes("::"), false);
  assert.match(allCalls[0]!, /id = '550e8400/);
});

test("P1: Expose the R2 object methods in the client type (runtime surface)", async () => {
  const r2 = createMockR2();
  const client = createCloudflareClient({ d1: createMockD1({}), r2 });
  // Overload types storage with L3a methods â€” assert runtime methods exist without cast.
  assert.equal(typeof client.storage.putObject, "function");
  assert.equal(typeof client.storage.getObject, "function");
  assert.equal(typeof client.storage.deleteObject, "function");
  assert.equal(typeof client.storage.listObjects, "function");
  const put = await client.storage.putObject({ body: "v", key: "k.txt" });
  assert.equal(put.key, "k.txt");
});

test("P1: Refine runtime return types when R2 is configured (runtime surface)", async () => {
  const r2 = createMockR2();
  const runtime = createAthenaRuntime({
    d1: createMockD1({}),
    mode: "edge",
    r2,
  });
  assert.equal(runtime.mode, "edge");
  const storage = runtime.client.storage as {
    putObject: (input: {
      key: string;
      body: string;
    }) => Promise<{ key: string }>;
  };
  assert.equal(typeof storage.putObject, "function");
  await storage.putObject({ body: "ok", key: "r.txt" });
  assert.ok(r2.objects.has("r.txt"));
});

// ===========================================================================
// P2 â€” SQL compiler
// ===========================================================================

test("P2: Split comma-separated conflict targets", () => {
  const compiled = compileD1Insert({
    insert_body: { email: "a@x.com", name: "Ada", tenant_id: "t1" },
    on_conflict: "tenant_id,email",
    table_name: "users",
  });
  assert.match(compiled.sql, /ON CONFLICT \("tenant_id", "email"\)/);
  assert.match(compiled.sql, /excluded\."name"/);
});

test("P2: Avoid ON CONFLICT after DEFAULT VALUES inserts", () => {
  assert.throws(
    () =>
      compileD1Insert({
        insert_body: {},
        on_conflict: "id",
        table_name: "users",
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "default_values_upsert_unsupported"
  );
});

test("P2: Allow single-row default-only inserts", () => {
  const compiled = compileD1Insert({
    insert_body: {},
    table_name: "users",
  });
  assert.equal(compiled.sql, 'INSERT INTO "users" DEFAULT VALUES');
});

test("P2: Honor head-only insert and upsert requests", () => {
  const insert = compileD1Insert({
    columns: "id,email",
    head: true,
    insert_body: { email: "a@x.com" },
    table_name: "users",
  });
  assert.equal(insert.sql.includes("RETURNING"), false);

  const upsert = compileD1Insert({
    head: true,
    insert_body: { email: "a@x.com", name: "Ada" },
    on_conflict: "email",
    table_name: "users",
    update_body: { name: "B" },
  });
  assert.equal(upsert.sql.includes("RETURNING"), false);
  assert.match(upsert.sql, /ON CONFLICT/);
});

test("P2: Honor head-only selects in the D1 compiler", () => {
  const compiled = compileD1Fetch({
    conditions: [{ column: "active", operator: "eq", value: true }],
    head: true,
    table_name: "users",
  });
  assert.match(compiled.sql, /COUNT\(\*\) AS __athena_count/);
});

test("P2: Compile documented select aliases instead of quoting them", () => {
  const colon = compileD1Fetch({
    columns: "user_id:id, user_email:email",
    table_name: "users",
  });
  assert.equal(
    colon.sql,
    'SELECT "id" AS "user_id", "email" AS "user_email" FROM "users"'
  );

  const asStyle = compileD1Fetch({
    columns: "id as user_id",
    table_name: "users",
  });
  assert.equal(asStyle.sql, 'SELECT "id" AS "user_id" FROM "users"');
});

test("P2: Preserve null equality semantics in D1 filters", () => {
  const eq = compileD1Fetch({
    conditions: [{ column: "deleted_at", operator: "eq", value: null }],
    table_name: "users",
  });
  assert.equal(eq.sql, 'SELECT * FROM "users" WHERE "deleted_at" IS NULL');

  const neq = compileD1Fetch({
    conditions: [{ column: "deleted_at", operator: "neq", value: null }],
    table_name: "users",
  });
  assert.equal(neq.sql, 'SELECT * FROM "users" WHERE "deleted_at" IS NOT NULL');
});

test("P2: Emit a SQLite limit when offset is used alone", () => {
  const compiled = compileD1Fetch({
    offset: 10,
    table_name: "users",
  });
  assert.equal(compiled.sql, 'SELECT * FROM "users" LIMIT -1 OFFSET 10');
});

test("P2: Avoid shadowable rowid in bounded mutations", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      limit: 1,
      table_name: "users",
      update_body: { name: "x" },
    },
    idIdentity
  );
  assert.match(compiled.sql, /"id" IN \(SELECT "id"/);
  assert.doesNotMatch(compiled.sql, /\browid\b/i);
});

test("P2: Reject bounded mutations when no safe row identity exists", () => {
  assert.throws(
    () =>
      compileD1Update(
        {
          conditions: [{ column: "oid", operator: "eq", value: 1 }],
          limit: 1,
          table_name: "users",
          update_body: { name: "x" },
        },
        idIdentity
      ),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_unsafe_identity"
  );
});

test("P1: Reject partial unique indexes as mutation identities", async () => {
  // PRAGMA table_info: no pk. PRAGMA index_list: only a partial unique index.
  // Must not treat email as a safe identity for bounded mutations.
  const queries: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "email",
                  notnull: 0,
                  pk: 0,
                  type: "TEXT",
                },
                {
                  cid: 1,
                  dflt_value: null,
                  name: "active",
                  notnull: 0,
                  pk: 0,
                  type: "INTEGER",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "users_email_active_uidx",
                  origin: "c",
                  partial: 1,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          void values;
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "users"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
  assert.ok(queries.some((q) => /index_list/i.test(q)));
  assert.ok(
    !queries.some((q) => /index_info/i.test(q)),
    "must not open partial unique indexes"
  );
});

test("P1: Accept full-table unique index as mutation identity", async () => {
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "email",
                  notnull: 1,
                  pk: 0,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "users_email_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_xinfo/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  coll: "BINARY",
                  desc: 0,
                  key: 1,
                  name: "email",
                  seqno: 0,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 0, name: "email", seqno: 0 }],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE users (email TEXT NOT NULL, UNIQUE (email))",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  const identity = await resolveD1BoundedIdentityColumn(db, "users");
  assert.equal(identity, "email");
});

test("P1: Recognize INTEGER PRIMARY KEY as a bounded identity", async () => {
  // SQLite reports notnull=0 for INTEGER PRIMARY KEY even though it aliases
  // non-null rowid; index_list has no PK entry.
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "id",
                  notnull: 0,
                  pk: 1,
                  type: "INTEGER",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  const identity = await resolveD1BoundedIdentityColumn(db, "items");
  assert.equal(identity, "id");
});

test("P1: Reject unique indexes containing expression terms", async () => {
  // UNIQUE(tenant_id, lower(email)): index_info returns a null-name expression
  // term. Filtering it would leave a false single-column identity on tenant_id.
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "tenant_id",
                  notnull: 1,
                  pk: 0,
                  type: "TEXT",
                },
                {
                  cid: 1,
                  dflt_value: null,
                  name: "email",
                  notnull: 1,
                  pk: 0,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "users_tenant_email_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                { cid: 0, name: "tenant_id", seqno: 0 },
                { cid: -2, name: null, seqno: 1 },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "users"),
    (err: unknown) =>
      err instanceof D1SqlCompileError &&
      err.code === "bounded_mutation_no_unique_identity"
  );
});

test("P1: Reject descending INTEGER primary keys as rowid aliases", async () => {
  // INTEGER PRIMARY KEY DESC is not a rowid alias: PRAGMA still reports type
  // INTEGER, pk=1, notnull=0, but the column may hold multiple NULLs. A separate
  // origin='pk' index (or CREATE TABLE â€¦ PRIMARY KEY DESC) marks the exception.
  const queries: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "id",
                  notnull: 0,
                  pk: 1,
                  type: "INTEGER",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "sqlite_autoindex_items_1",
                  origin: "pk",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 0, name: "id", seqno: 0 }],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE items (id INTEGER PRIMARY KEY DESC, name TEXT)",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "items"),
    (err: unknown) =>
      err instanceof D1SqlCompileError &&
      err.code === "bounded_mutation_no_unique_identity"
  );
  assert.ok(queries.some((q) => /index_list/i.test(q)));
});

test("P2: Check unique indexes after encountering a composite primary key", async () => {
  // Composite PK alone is unusable for IN-subquery, but a separate single-column
  // non-partial NOT NULL unique index must still be accepted.
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "tenant_id",
                  notnull: 1,
                  pk: 1,
                  type: "TEXT",
                },
                {
                  cid: 1,
                  dflt_value: null,
                  name: "slug",
                  notnull: 1,
                  pk: 2,
                  type: "TEXT",
                },
                {
                  cid: 2,
                  dflt_value: null,
                  name: "id",
                  notnull: 1,
                  pk: 0,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "items_id_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_xinfo/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 2,
                  coll: "BINARY",
                  desc: 0,
                  key: 1,
                  name: "id",
                  seqno: 0,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 2, name: "id", seqno: 0 }],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE items (tenant_id TEXT NOT NULL, slug TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (tenant_id, slug), UNIQUE (id))",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  const identity = await resolveD1BoundedIdentityColumn(db, "items");
  assert.equal(identity, "id");
});

test("P1: Reject nullable primary keys as mutation identities", async () => {
  // SQLite rowid tables: TEXT PRIMARY KEY may report pk=1 with notnull=0.
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "key",
                  notnull: 0,
                  pk: 1,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "items"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
});

test("P1: Reject nullable unique columns as mutation identities", async () => {
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                // notnull: 0 â€” SQLite UNIQUE allows many NULLs
                {
                  cid: 0,
                  dflt_value: null,
                  name: "email",
                  notnull: 0,
                  pk: 0,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "users_email_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 0, name: "email", seqno: 0 }],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "users"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
});

test("P1: Anchor collation parsing inside the column list", async () => {
  // Table name equals column name: must read column COLLATE NOCASE, not the
  // earlier BINARY from another column / table-name collision.
  const queries: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "other",
                  notnull: 0,
                  pk: 0,
                  type: "TEXT",
                },
                {
                  cid: 1,
                  dflt_value: null,
                  name: "name",
                  notnull: 1,
                  pk: 0,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "name_name_binary_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_xinfo/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 1,
                  coll: "BINARY",
                  desc: 0,
                  key: 1,
                  name: "name",
                  seqno: 0,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 1, name: "name", seqno: 0 }],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE name (other TEXT COLLATE BINARY, name TEXT COLLATE NOCASE NOT NULL, UNIQUE(name COLLATE BINARY))",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  // Column name is NOCASE; unique index is BINARY â†’ identity must be rejected.
  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "name"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
  assert.ok(
    queries.some((q) => /index_xinfo/i.test(q)),
    "must compare index collation against column NOCASE (not table-name BINARY)"
  );
});

test("P1: Parse collations after parenthesized column types", async () => {
  // VARCHAR(255) COLLATE NOCASE must not be misread as BINARY just because
  // the type closes a parenthesis before COLLATE.
  const queries: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "name",
                  notnull: 1,
                  pk: 0,
                  type: "VARCHAR(255)",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "items_name_binary_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_xinfo/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  coll: "BINARY",
                  desc: 0,
                  key: 1,
                  name: "name",
                  seqno: 0,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 0, name: "name", seqno: 0 }],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE items (name VARCHAR(255) COLLATE NOCASE NOT NULL, UNIQUE (name COLLATE BINARY))",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "items"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
  assert.ok(
    queries.some((q) => /index_xinfo/i.test(q)),
    "must inspect index_xinfo after parsing VARCHAR(255) COLLATE NOCASE"
  );
});

test("P1: Validate collation on non-rowid primary keys", async () => {
  // TEXT COLLATE NOCASE + PRIMARY KEY (name COLLATE BINARY) allows a and A;
  // outer name IN (SELECT name â€¦ LIMIT 1) uses column NOCASE and mutates both.
  const queries: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "name",
                  notnull: 1,
                  pk: 1,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "sqlite_autoindex_items_1",
                  origin: "pk",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_xinfo/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  coll: "BINARY",
                  desc: 0,
                  key: 1,
                  name: "name",
                  seqno: 0,
                },
              ],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE items (name TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY (name COLLATE BINARY))",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "items"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
  assert.ok(
    queries.some((q) => /index_xinfo/i.test(q)),
    "must inspect PK index_xinfo for collation before accepting non-rowid PK"
  );
});

test("P1: Validate index collation before accepting bounded identities", async () => {
  // TEXT COLLATE NOCASE column + UNIQUE COLLATE BINARY index can store both
  // "a" and "A"; column-equality IN (SELECT â€¦ LIMIT n) can match both rows.
  const queries: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        async all() {
          if (/PRAGMA\s+table_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  dflt_value: null,
                  name: "code",
                  notnull: 1,
                  pk: 0,
                  type: "TEXT",
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_list/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  name: "items_code_binary_uidx",
                  origin: "c",
                  partial: 0,
                  seq: 0,
                  unique: 1,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_xinfo/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  cid: 0,
                  coll: "BINARY",
                  desc: 0,
                  key: 1,
                  name: "code",
                  seqno: 0,
                },
              ],
              success: true,
            };
          }
          if (/PRAGMA\s+index_info/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [{ cid: 0, name: "code", seqno: 0 }],
              success: true,
            };
          }
          if (/sqlite_master/i.test(query)) {
            return {
              meta: { changes: 0, duration: 0 },
              results: [
                {
                  create_sql:
                    "CREATE TABLE items (code TEXT NOT NULL COLLATE NOCASE, UNIQUE (code COLLATE BINARY))",
                },
              ],
              success: true,
            };
          }
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return {
            meta: { changes: 0, duration: 0 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };

  await assert.rejects(
    () => resolveD1BoundedIdentityColumn(db, "items"),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
  assert.ok(
    queries.some((q) => /index_xinfo/i.test(q)),
    "must inspect PRAGMA index_xinfo for collation"
  );
});

test("P2: Compute requested counts independently of pagination", () => {
  // Head/count path ignores limit/offset on the COUNT query body.
  const compiled = compileD1Fetch({
    conditions: [{ column: "active", operator: "eq", value: true }],
    head: true,
    limit: 10,
    offset: 20,
    table_name: "users",
  });
  assert.match(compiled.sql, /COUNT\(\*\)/);
  assert.doesNotMatch(compiled.sql, /LIMIT|OFFSET/);
});

test("P2: Fail when the total-count query fails", async () => {
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      return Promise.all(
        statements.map((s: D1PreparedStatementLike) => s.run())
      );
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      const isCount = /COUNT\s*\(\s*\*\s*\)/i.test(query);
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          void bound;
          if (isCount) {
            return {
              error: "count query timed out",
              meta: { changes: 0 },
              results: [] as T[],
              success: false,
            };
          }
          // Page query succeeds with one row â€” must not become the reported total.
          return {
            meta: { changes: 0 },
            results: [{ id: 1 }] as T[],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          void bound;
          if (isCount) {
            return {
              error: "count query timed out",
              meta: { changes: 0 },
              results: [] as T[],
              success: false,
            };
          }
          return {
            meta: { changes: 0 },
            results: [{ id: 1 }] as T[],
            success: true,
          };
        },
      };
      return statement;
    },
  };
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway({
    count: "exact",
    limit: 10,
    table_name: "users",
  });
  assert.equal(response.ok, false);
  // Must not succeed with page length substituted as the exact total.
  assert.notEqual((response as { count?: number }).count, 1);
  assert.match(
    String(
      (response as { error?: { message?: string }; message?: string }).error
        ?.message ??
        (response as { message?: string }).message ??
        JSON.stringify(response)
    ),
    /count query timed out|D1 query failed|HTTP_ERROR/i
  );
});

// ===========================================================================
// P2 â€” SQL rewrite / runner
// ===========================================================================

test("P2: Rewrite OFFSET using the whole SQL clause", () => {
  const out = rewritePostgresSqlForSqlite(
    "SELECT * FROM (SELECT a FROM t LIMIT 1) AS x OFFSET 5"
  );
  assert.equal(
    out,
    "SELECT * FROM (SELECT a FROM t LIMIT 1) AS x LIMIT -1 OFFSET 5"
  );
});

test("P2: Reset OFFSET matching at statement boundaries", () => {
  const out = rewritePostgresSqlForSqlite(
    "SELECT 1 LIMIT 1; SELECT 2 OFFSET 1"
  );
  assert.equal(out, "SELECT 1 LIMIT 1; SELECT 2 LIMIT -1 OFFSET 1");
});

test("P2: Ignore RETURNING tokens inside SQL literals", () => {
  assert.equal(
    sqlContainsKeywordOutsideLiterals(
      `INSERT INTO t (note) VALUES ('has RETURNING word')`,
      "RETURNING"
    ),
    false
  );
  assert.equal(
    sqlContainsKeywordOutsideLiterals(
      "INSERT INTO t (x) VALUES (1) RETURNING x",
      "RETURNING"
    ),
    true
  );
});

test("P2: Parse statements without splitting semicolons inside SQL text", () => {
  assert.equal(isMultiStatement(`SELECT ';' AS semi`), false);
  assert.equal(isMultiStatement("SELECT 1; SELECT 2"), true);
  const parts = splitSqlStatements(`SELECT 'a;b' AS v; SELECT 2`);
  assert.equal(parts.length, 2);
  assert.match(parts[0]!, /'a;b'/);
});

test("P2: Keep trigger bodies as one SQL statement", () => {
  const trigger = `
CREATE TRIGGER audit_ins AFTER INSERT ON items
BEGIN
  UPDATE counters SET n = n + 1;
  INSERT INTO audit(op) VALUES ('insert');
END
`.trim();
  assert.equal(isMultiStatement(trigger), false);
  const only = splitSqlStatements(trigger);
  assert.equal(only.length, 1);
  assert.match(only[0]!, /CREATE TRIGGER/i);
  assert.match(only[0]!, /INSERT INTO audit/i);

  const withFollowOn = `${trigger}; SELECT 1`;
  const parts = splitSqlStatements(withFollowOn);
  assert.equal(parts.length, 2);
  assert.match(parts[0]!, /CREATE TRIGGER/i);
  assert.equal(parts[1]?.trim(), "SELECT 1");

  // CASE ... END inside WHEN / body must not close the trigger early.
  const withCase = `
CREATE TRIGGER t1 AFTER UPDATE ON items
WHEN NEW.flag = CASE WHEN OLD.flag THEN 1 ELSE 0 END
BEGIN
  UPDATE items SET note = CASE WHEN NEW.x > 0 THEN 'pos' ELSE 'neg' END;
END
`.trim();
  assert.equal(splitSqlStatements(withCase).length, 1);

  // Transaction BEGIN is not a trigger body opener.
  assert.equal(
    isMultiStatement("BEGIN; INSERT INTO t VALUES (1); COMMIT"),
    true
  );
});

test("P2: Skip SQL comments while recognizing trigger declarations", () => {
  // Original case: SQLite allows comments between CREATE/TEMP/TRIGGER; a scanner
  // that only skips whitespace never sets awaitTriggerBegin, so body `;` split the DDL.
  const withBlockComment = `
CREATE /* audit */ TRIGGER t1 AFTER INSERT ON items
BEGIN
  UPDATE items SET n = n + 1 WHERE id = NEW.id;
  INSERT INTO audit(msg) VALUES ('ins');
END
`.trim();
  const withLineComment = `
CREATE -- temp-ish
TEMP -- keyword
TRIGGER t2 AFTER UPDATE ON items
BEGIN
  INSERT INTO audit(msg) VALUES ('upd');
END
`.trim();
  for (const ddl of [withBlockComment, withLineComment]) {
    assert.equal(isMultiStatement(ddl), false, ddl);
    const parts = splitSqlStatements(ddl);
    assert.equal(parts.length, 1, ddl);
    assert.match(parts[0]!, /INSERT INTO audit/i);
    assert.match(parts[0]!, /BEGIN/i);
    assert.match(parts[0]!, /END/i);
  }
});

test("P2: Track SQLite backtick and bracket identifiers when splitting", () => {
  assert.equal(isMultiStatement("SELECT `[semi;col]` FROM t"), false);
  assert.equal(isMultiStatement("SELECT [semi;col] FROM t"), false);
  assert.equal(
    sqlContainsKeywordOutsideLiterals("SELECT `RETURNING` FROM t", "RETURNING"),
    false
  );
  assert.equal(
    sqlContainsKeywordOutsideLiterals("SELECT [RETURNING] FROM t", "RETURNING"),
    false
  );
});

test("P2: Do not call exec on a D1 session", async () => {
  const store = { execCalls: 0, sessionBatch: false };
  const db = createMockD1(store);
  // Multi-statement with session should batch, not exec.
  const result = await executeD1Query(db, {
    query: "SELECT 1; SELECT 2",
    sessionMode: "first-unconstrained",
  });
  assert.equal(result.ok, true);
  assert.equal(store.execCalls, 0);
  assert.equal(store.sessionBatch, true);
});

test("P2: Keep counted reads in one D1 session", async () => {
  let withSessionCalls = 0;
  let sessionBatchCalls = 0;
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      sessionBatchCalls += 1;
      return Promise.all(
        statements.map((s: D1PreparedStatementLike) => s.all())
      );
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      const sql = query;
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          if (/COUNT\(\*\)/i.test(sql)) {
            return {
              meta: {},
              results: [{ __athena_count: 42 } as T],
              success: true,
            };
          }
          return {
            meta: {},
            results: [{ id: 1 }, { id: 2 }] as T[],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return statement.all();
        },
      };
      return statement;
    },
    withSession() {
      withSessionCalls += 1;
      return {
        batch: async (statements: D1PreparedStatementLike[]) => {
          sessionBatchCalls += 1;
          return Promise.all(
            statements.map((s: D1PreparedStatementLike) => s.all())
          );
        },
        getBookmark: () => "session-bm-after-count",
        prepare: db.prepare.bind(db),
      };
    },
  };

  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway(
    {
      count: "exact",
      limit: 2,
      table_name: "users",
    },
    {
      headers: {
        "x-athena-d1-session-mode": "first-unconstrained",
      },
    }
  );

  assert.equal(response.ok, true);
  assert.equal(response.count, 42);
  assert.equal(Array.isArray(response.data) ? response.data.length : 0, 2);
  // One withSession for the combined page+COUNT batch â€” not two independent sessions.
  assert.equal(withSessionCalls, 1);
  assert.equal(sessionBatchCalls, 1);
  const raw = response.raw as { bookmark?: string } | null;
  assert.equal(raw?.bookmark, "session-bm-after-count");
});

test("P2: Preserve result rows from multi-statement queries", async () => {
  let execCalled = false;
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      return Promise.all(
        statements.map((s: D1PreparedStatementLike) => s.run())
      );
    },
    async exec() {
      execCalled = true;
      return { count: 2, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      const sql = query;
      const statement: D1PreparedStatementLike = {
        async all() {
          return statement.run();
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          if (/SELECT\s+1\s+AS\s+a/i.test(sql)) {
            return { meta: {}, results: [{ a: 1 }], success: true };
          }
          if (/SELECT\s+2\s+AS\s+b/i.test(sql)) {
            return { meta: {}, results: [{ b: 2 }], success: true };
          }
          return { meta: {}, results: [], success: true };
        },
      };
      return statement;
    },
  };
  const result = await executeD1Query(db, {
    query: "SELECT 1 AS a; SELECT 2 AS b",
  });
  assert.equal(result.ok, true);
  assert.equal(execCalled, false);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }]);
});

// Raw VALUES (and WITH â€¦ VALUES) must use all() â€” SQLite returns rows; run() yields empty data.
test("P2: Execute VALUES statements through the row-producing path", async () => {
  const calls: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(): D1PreparedStatementLike {
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return {
            meta: { changes: 0 },
            results: [{ column1: 1 }],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          // Metadata path: no result set (the bug clients saw as empty data).
          return { meta: { changes: 0 }, results: [], success: true };
        },
      };
      return statement;
    },
  };

  const bare = await executeD1Query(db, { query: "VALUES (1)" });
  assert.equal(bare.ok, true);
  if (!bare.ok) {
    return;
  }
  assert.deepEqual(calls, ["all"], "bare VALUES must use all(), not run()");
  assert.deepEqual(bare.rows, [{ column1: 1 }], "VALUES must return row data");
  assert.equal(bare.count, 1);

  calls.length = 0;
  const withValues = await executeD1Query(db, {
    query: "WITH x(a) AS (SELECT 1) VALUES (2)",
  });
  assert.equal(withValues.ok, true);
  if (!withValues.ok) {
    return;
  }
  assert.deepEqual(calls, ["all"], "WITH â€¦ VALUES terminal must use all()");
  assert.deepEqual(withValues.rows, [{ column1: 1 }]);
});

test("P2: Skip leading comments when classifying row-producing SQL", async () => {
  const calls: string[] = [];
  const focused: D1DatabaseLike = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(): D1PreparedStatementLike {
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return { meta: {}, results: [{ ok: 1 }], success: true };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          return { meta: { changes: 0 }, results: [], success: true };
        },
      };
      return statement;
    },
  };
  const result = await executeD1Query(focused, {
    query: "-- diagnostic\nSELECT 1 AS ok",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["all"]);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ ok: 1 }]);
});

test("P2: Forward supported DB URL keys from Worker environments", () => {
  const { mode, capabilities } = createAthenaFromWorkerEnv({
    ATHENA_API_KEY: "k",
    ATHENA_DB_URL: "https://db-only.example.com",
  });
  assert.equal(mode, "gateway");
  assert.equal(capabilities.mode, "gateway");

  const viaGateway = createAthenaFromWorkerEnv({
    ATHENA_API_KEY: "k",
    ATHENA_GATEWAY_URL: "https://gw-only.example.com",
  });
  assert.equal(viaGateway.mode, "gateway");
});

test("P2: Forward supported API-key aliases in Worker environments", () => {
  const { mode, capabilities } = createAthenaFromWorkerEnv({
    ATHENA_GATEWAY_API_KEY: "from-gateway-alias",
    ATHENA_URL: "https://gw-alias-key.example.com",
  });
  assert.equal(mode, "gateway");
  assert.equal(capabilities.mode, "gateway");

  const viaPublic = createAthenaFromWorkerEnv({
    ATHENA_URL: "https://gw-public-key.example.com",
    NEXT_PUBLIC_ATHENA_API_KEY: "from-next-public",
  });
  assert.equal(viaPublic.mode, "gateway");

  const viaXApiKey = createAthenaFromWorkerEnv({
    ATHENA_URL: "https://gw-x-api-key.example.com",
    X_API_KEY: "from-x-api-key",
  });
  assert.equal(viaXApiKey.mode, "gateway");
});

// ===========================================================================
// P2 â€” Transport / stripNulls / batch counts
// ===========================================================================

test("P2: Apply stripNulls before returning D1 rows", async () => {
  const db = createMockD1({
    rows: [{ deleted_at: null, email: "a@x.com", id: 1 }],
  });
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const stripped = await transport.fetchGateway({
    strip_nulls: true,
    table_name: "users",
  });
  assert.equal(stripped.ok, true);
  assert.deepEqual(stripped.data, [{ email: "a@x.com", id: 1 }]);

  const kept = await transport.fetchGateway({
    strip_nulls: false,
    table_name: "users",
  });
  assert.deepEqual(kept.data, [{ deleted_at: null, email: "a@x.com", id: 1 }]);
});

test("P2: Count changes in sparse insert batches", async () => {
  const log: Array<{ kind: string }> = [];
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      log.push({ kind: "batch" });
      return Promise.all(
        statements.map((s: D1PreparedStatementLike) => s.run())
      );
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          log.push({ kind: "all" });
          return { meta: { changes: 1 }, results: [] as T[], success: true };
        },
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          log.push({ kind: "run" });
          void bound;
          void query;
          return { meta: { changes: 1 }, results: [] as T[], success: true };
        },
      };
      return statement;
    },
  };
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  // Sparse rows (different column sets) expand to a multi-statement batch.
  const response = await transport.insertGateway({
    insert_body: [
      { name: "a", role: "admin" },
      { name: "b" },
      { name: "c", role: "user" },
    ],
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.ok(
    log.some((entry) => entry.kind === "batch") ||
      log.filter((e) => e.kind === "run").length >= 3,
    `expected batch or 3 runs, got ${JSON.stringify(log)}`
  );
  // Count must sum meta.changes across the batch (not only the first statement).
  assert.equal(response.count, 3);
});

// ===========================================================================
// P2 â€” Client materialization / hybrid / env keys
// ===========================================================================

test("P2: Let an R2 binding configure a storage-only client", async () => {
  const r2 = createMockR2();
  const client = createClient({ storage: { prefix: "p/", r2 } });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.local, true);
  await client.storage.putObject({ body: "x", key: "a.txt" });
  assert.ok(r2.objects.has("p/a.txt"));
});

test("P2: Advertise remote storage in edge capabilities", () => {
  const client = createCloudflareClient({
    d1: createMockD1({}),
    key: "k",
    url: "https://athena.example.com",
  });
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.local, false);
});

test("P2: Include explicit storage URLs in edge capabilities", () => {
  const client = createClient({
    db: { d1: createMockD1({}) },
    key: "k",
    storage: { url: "https://storage.example.com" },
  });
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.local, false);
});

test("P2: Derive gateway storage capabilities from configured URLs", () => {
  // Gateway-only client with only db.url (no R2) still advertises remote storage
  // when a storage/root URL is configured.
  const client = createClient({
    key: "k",
    url: "https://athena.example.com",
  });
  assert.equal(client.capabilities.mode, "gateway");
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.local, false);
});

test("P2: Route hybrid billing to the remote root", async () => {
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
      d1: createMockD1({}),
      key: "real-key",
      url: "https://remote.athena.test",
    });
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /^https:\/\/remote\.athena\.test\//);
    assert.equal(calls[0]?.includes("athena.local"), false);
    assert.equal(calls[0]?.includes(CLOUDFLARE_EDGE_BASE_URL), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function captureAthenaKeyHeaders(): {
  headersSeen: string[];
  urlsSeen: string[];
  install: () => void;
  restore: () => void;
} {
  const headersSeen: string[] = [];
  const urlsSeen: string[] = [];
  const originalFetch = globalThis.fetch;
  return {
    headersSeen,
    install() {
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        urlsSeen.push(url);
        const headers = new Headers(init?.headers);
        headersSeen.push(
          headers.get("X-Athena-Key") ??
            headers.get("x-athena-key") ??
            headers.get("X-Api-Key") ??
            headers.get("x-api-key") ??
            ""
        );
        return new Response(JSON.stringify({ data: {} }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }) as typeof fetch;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
    urlsSeen,
  };
}

test("P2: Honor env API keys for hybrid edge clients", async () => {
  const capture = captureAthenaKeyHeaders();
  capture.install();
  try {
    const client = createClient({
      db: { d1: createMockD1({}) },
      env: { ATHENA_API_KEY: "from-env-key" },
      url: "https://remote.athena.test",
    });
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(capture.headersSeen.length >= 1);
    assert.ok(
      capture.headersSeen.some((h) => h.includes("from-env-key")),
      `expected env API key in request headers, got ${JSON.stringify(capture.headersSeen)}`
    );
    assert.ok(
      !capture.headersSeen.some((h) => h.includes(CLOUDFLARE_EDGE_API_KEY))
    );
  } finally {
    capture.restore();
  }
});

test("P2: Preserve env API keys in the Cloudflare facade", async () => {
  const capture = captureAthenaKeyHeaders();
  capture.install();
  try {
    const client = createCloudflareClient({
      d1: createMockD1({}),
      env: { ATHENA_API_KEY: "facade-env-key" },
      url: "https://remote.athena.test",
    });
    assert.equal(client.capabilities.auth.remote, true);
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(capture.headersSeen.some((h) => h.includes("facade-env-key")));
    assert.ok(
      !capture.headersSeen.some((h) => h.includes(CLOUDFLARE_EDGE_API_KEY))
    );
  } finally {
    capture.restore();
  }
});

test("P2: Resolve remote services before assigning the sentinel key", async () => {
  const capture = captureAthenaKeyHeaders();
  capture.install();
  try {
    const client = createClient({
      db: { d1: createMockD1({}) },
      env: { ATHENA_API_KEY: "late-resolved-key" },
      url: "https://remote.athena.test",
    });
    assert.equal(client.capabilities.auth.remote, true);
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(capture.headersSeen.some((h) => h.includes("late-resolved-key")));
    assert.ok(
      !capture.headersSeen.some((h) => h.includes(CLOUDFLARE_EDGE_API_KEY))
    );
  } finally {
    capture.restore();
  }
});

test("P2: Treat configured DB gateways as remote before injecting the key", async () => {
  const capture = captureAthenaKeyHeaders();
  capture.install();
  try {
    const client = createClient({
      db: { url: "https://gateway.athena.test" },
      env: { ATHENA_API_KEY: "gateway-env-key" },
    });
    assert.equal(client.capabilities.mode, "gateway");
    assert.equal(client.capabilities.db.local, false);
    // Root URL still unset â€” storage objects may be off; key must still resolve from env.
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(
      capture.headersSeen.some((h) => h.includes("gateway-env-key")),
      `expected gateway env key, got ${JSON.stringify(capture.headersSeen)}`
    );
    assert.ok(
      !capture.headersSeen.some((h) => h.includes(CLOUDFLARE_EDGE_API_KEY))
    );
  } finally {
    capture.restore();
  }
});

test("P2: Preserve environment DB gateways when adding the D1 sentinel", async () => {
  // Hybrid: local D1 + env ATHENA_DB_URL must not plant the edge sentinel as explicit
  // db.url (that would shadow env in resolveCore for billing/remote services).
  const capture = captureAthenaKeyHeaders();
  capture.install();
  try {
    const client = createClient({
      db: { d1: createMockD1({}) },
      env: {
        ATHENA_API_KEY: "env-db-key",
        ATHENA_DB_URL: "https://db-via-env.example.com",
      },
    });
    assert.equal(client.capabilities.db.local, true);
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(
      capture.urlsSeen.some((u) => u.includes("db-via-env.example.com")),
      `expected billing against env DB gateway, got ${JSON.stringify(capture.urlsSeen)}`
    );
    assert.ok(
      !capture.urlsSeen.some(
        (u) =>
          u.includes(CLOUDFLARE_EDGE_BASE_URL) || u.includes("athena.local")
      ),
      `sentinel must not shadow env DB URL: ${JSON.stringify(capture.urlsSeen)}`
    );
    assert.ok(capture.headersSeen.some((h) => h.includes("env-db-key")));
  } finally {
    capture.restore();
  }
});

test("P2: Include DB URL env keys in gateway mode resolution", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      env: { ATHENA_DB_URL: "https://db-via-env.example.com" },
      mode: "gateway",
    }),
    "gateway"
  );
  assert.equal(
    resolveAthenaExecutionMode({
      env: { ATHENA_DB_URL: "https://db-via-env.example.com" },
    }),
    "gateway"
  );
  assert.equal(
    resolveAthenaExecutionMode({
      d1: createMockD1({}),
      env: { ATHENA_GATEWAY_URL: "https://gateway-via-env.example.com" },
      prefer: "gateway",
    }),
    "gateway"
  );
});

// ===========================================================================
// P2 â€” R2 logical keys
// ===========================================================================

test("P2: Return reusable logical R2 keys", async () => {
  const r2 = createMockR2();
  const storage = createCloudflareR2StorageModule({ prefix: "tenant/", r2 });
  const put = await storage.putObject({ body: "hi", key: "docs/a.txt" });
  assert.equal(put.key, "docs/a.txt");
  const got = await storage.getObject({ key: put.key });
  assert.ok(got);
  assert.equal(got.key, "docs/a.txt");
  assert.ok(r2.objects.has("tenant/docs/a.txt"));
});

test("P2: Treat every public R2 key as logical", async () => {
  const r2 = createMockR2();
  const storage = createCloudflareR2StorageModule({ prefix: "tenant/", r2 });
  // A key that starts with the prefix is still logical â€” always join prefix.
  await storage.putObject({ body: "x", key: "tenant/a.txt" });
  assert.ok(r2.objects.has("tenant/tenant/a.txt"));
  assert.equal(r2.objects.has("tenant/a.txt"), false);

  await storage.putObject({ body: "y", key: "a.txt" });
  assert.ok(r2.objects.has("tenant/a.txt"));
  // Distinct physical objects for a.txt vs tenant/a.txt under prefix tenant/
  assert.equal(r2.objects.size, 2);
});

// ===========================================================================
// P2 â€” package typesVersions
// ===========================================================================

test("P2: Map the Cloudflare subpath in typesVersions", () => {
  const pkgPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json"
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    typesVersions?: Record<string, Record<string, string[]>>;
    exports?: Record<string, unknown>;
  };
  assert.ok(pkg.typesVersions?.["*"]?.cloudflare);
  assert.ok(
    pkg.typesVersions?.["*"]?.cloudflare?.some((p) =>
      p.includes("cloudflare.d.ts")
    )
  );
  assert.ok(pkg.exports?.["./cloudflare"]);
});

// ===========================================================================
// P2 â€” Worker env facade smoke (related hybrid env keys)
// ===========================================================================

test("P2: createAthenaFromWorkerEnv maps bindings without sentinel hybrid key", () => {
  const { client, capabilities } = createAthenaFromWorkerEnv({
    ATHENA_API_KEY: "worker-env-key",
    ATHENA_URL: "https://remote.athena.test",
    DB: createMockD1({}),
  });
  assert.equal(capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.auth.remote, true);
});

test("P2: createAthenaRuntimeClient respects prefer gateway", () => {
  const client = createAthenaRuntimeClient({
    d1: createMockD1({}),
    key: "k",
    prefer: "gateway",
    url: "https://gateway.example.com",
  });
  assert.equal(client.capabilities.mode, "gateway");
});

// ===========================================================================
// P1 â€” D1 bind param types (booleans rejected by real D1 prepare().bind())
// ===========================================================================

/**
 * D1 prepared statements reject JS booleans at bind time. The runner must map
 * trueâ†’1 / falseâ†’0 before .bind() for both single-statement and batch paths.
 * Original found case: .eq('pending', true) / insert body true.
 */
test("P1: Normalize booleans before binding D1 parameters", async () => {
  const boundSingle: unknown[][] = [];
  const boundBatch: unknown[][] = [];

  const rejectBooleans = (values: unknown[]) => {
    for (const v of values) {
      if (typeof v === "boolean") {
        throw new TypeError(
          `D1_TYPE_ERROR: Type 'boolean' not supported for value '${v}'`
        );
      }
    }
  };

  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      return Promise.all(
        statements.map((s: D1PreparedStatementLike) => s.run())
      );
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          boundSingle.push([...bound]);
          return {
            meta: { duration: 1 },
            results: [] as T[],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          rejectBooleans(values);
          bound = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          boundSingle.push([...bound]);
          return {
            meta: { changes: 1, duration: 1 },
            results: [] as T[],
            success: true,
          };
        },
      };
      // Capture batch binds via run after prepare+bind
      const origRun = statement.run;
      statement.run = async <T = Record<string, unknown>>() => {
        boundBatch.push([...bound]);
        return origRun.call(statement) as Promise<D1ResultLike<T>>;
      };
      void query;
      return statement;
    },
  };

  // Original case: filter/eq pending=true and insert body with boolean.
  const selectResult = await executeD1Query(db, {
    params: [true],
    query: "SELECT * FROM jobs WHERE pending = ?",
  });
  assert.equal(selectResult.ok, true, "SELECT with boolean param must succeed");

  const insertResult = await executeD1Query(db, {
    params: [true, false],
    query: "INSERT INTO jobs (pending, done) VALUES (?, ?)",
  });
  assert.equal(
    insertResult.ok,
    true,
    "INSERT with boolean params must succeed"
  );

  // Single-statement binds: trueâ†’1, falseâ†’0 (no raw booleans).
  assert.deepEqual(boundSingle[0], [1]);
  assert.deepEqual(boundSingle[1], [1, 0]);

  boundBatch.length = 0;
  const batchResult = await executeD1Batch(db, {
    statements: [
      {
        params: [false, "id-1"],
        query: "UPDATE jobs SET pending = ? WHERE id = ?",
      },
      { params: [true], query: "INSERT INTO jobs (pending) VALUES (?)" },
    ],
  });
  assert.equal(batchResult.ok, true, "batch with boolean params must succeed");
  assert.deepEqual(boundBatch[0], [0, "id-1"]);
  assert.deepEqual(boundBatch[1], [1]);
});
