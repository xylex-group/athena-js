import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { rewritePostgresSqlForSqlite } from "../src/cloudflare/d1/sql-rewrite.ts";
import {
  createCloudflareClient,
  createCloudflareD1GatewayTransport,
} from "../src/cloudflare/index.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/cloudflare/types.ts";

test("rewritePostgresSqlForSqlite strips ::text and ::uuid casts", () => {
  const input = `SELECT "id", "email" FROM "users" WHERE "id"::text = '550e8400-e29b-41d4-a716-446655440000'::text;`;
  const out = rewritePostgresSqlForSqlite(input);
  assert.equal(
    out,
    `SELECT "id", "email" FROM "users" WHERE "id" = '550e8400-e29b-41d4-a716-446655440000';`
  );
  assert.ok(!out.includes("::"));
});

test("rewritePostgresSqlForSqlite injects LIMIT -1 before bare OFFSET", () => {
  const out = rewritePostgresSqlForSqlite('SELECT * FROM "users" OFFSET 10;');
  assert.equal(out, 'SELECT * FROM "users" LIMIT -1 OFFSET 10;');
});

test("rewritePostgresSqlForSqlite keeps existing LIMIT when comment separates OFFSET", () => {
  const out = rewritePostgresSqlForSqlite(
    "SELECT * FROM t LIMIT 1 /* page */ OFFSET 2"
  );
  assert.equal(out, "SELECT * FROM t LIMIT 1 /* page */ OFFSET 2");
  assert.equal((out.match(/\bLIMIT\b/gi) ?? []).length, 1);
});

test("rewritePostgresSqlForSqlite injects LIMIT -1 for outer OFFSET despite nested LIMIT", () => {
  const out = rewritePostgresSqlForSqlite(
    "SELECT * FROM (SELECT a FROM t LIMIT 1) AS x OFFSET 5"
  );
  assert.equal(
    out,
    "SELECT * FROM (SELECT a FROM t LIMIT 1) AS x LIMIT -1 OFFSET 5"
  );
});

test("rewritePostgresSqlForSqlite does not reuse LIMIT across statement boundaries", () => {
  const out = rewritePostgresSqlForSqlite(
    "SELECT 1 LIMIT 1; SELECT 2 OFFSET 1"
  );
  assert.equal(out, "SELECT 1 LIMIT 1; SELECT 2 LIMIT -1 OFFSET 1");
});

test("rewritePostgresSqlForSqlite maps ILIKE to LIKE", () => {
  const out = rewritePostgresSqlForSqlite(
    `SELECT * FROM t WHERE name ILIKE '%a%'`
  );
  assert.equal(out, `SELECT * FROM t WHERE name LIKE '%a%'`);
});

test("rewritePostgresSqlForSqlite preserves casts and keywords inside string literals", () => {
  const out = rewritePostgresSqlForSqlite(
    `SELECT 'value::text' AS value, "id"::text AS id WHERE note ILIKE '%OFFSET 1%'`
  );
  assert.equal(
    out,
    `SELECT 'value::text' AS value, "id" AS id WHERE note LIKE '%OFFSET 1%'`
  );
  assert.ok(out.includes("'value::text'"));
  assert.ok(out.includes("'%OFFSET 1%'"));
});

function createRecordingD1() {
  const log: string[] = [];
  const db: D1DatabaseLike = {
    async batch(statements) {
      // Prefer all() so SELECT/COUNT rows surface the same way real D1 batch does.
      return Promise.all(statements.map((s) => s.all()));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          log.push(query);
          if (/COUNT\(\*\)/i.test(query)) {
            return {
              meta: {},
              results: [{ __athena_count: 100 } as T],
              success: true,
            };
          }
          return {
            meta: {},
            results: [{ id: "1" }, { id: "2" }] as T[],
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
          log.push(query);
          void bound;
          return { meta: { changes: 1 }, results: [] as T[], success: true };
        },
      };
      return statement;
    },
  };
  return { db, log };
}

test("queryGateway rewrites Postgres UUID casts before D1", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.queryGateway({
    query: `SELECT * FROM "users" WHERE "id"::text = '550e8400-e29b-41d4-a716-446655440000'::text`,
  });
  assert.equal(response.ok, true);
  assert.equal(log.length, 1);
  assert.ok(!log[0]?.includes("::"));
  assert.match(log[0]!, /"id" = '550e8400-e29b-41d4-a716-446655440000'/);
});

test("fetch with count exact runs separate total COUNT", async () => {
  const { db, log } = createRecordingD1();
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.fetchGateway({
    conditions: [{ column: "active", operator: "eq", value: true }],
    count: "exact",
    limit: 2,
    table_name: "users",
  });
  assert.equal(response.ok, true);
  assert.equal(Array.isArray(response.data) ? response.data.length : 0, 2);
  assert.equal(response.count, 100);
  assert.ok(log.some((sql) => /COUNT\(\*\)/.test(sql)));
  assert.ok(log.some((sql) => /LIMIT 2/.test(sql) && !/COUNT/.test(sql)));
});

test("fluent eq uuid uses rewritten SQL on edge client", async () => {
  const { db, log } = createRecordingD1();
  const client = createCloudflareClient({ d1: db });
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const result = await client.from("users").eq("id", uuid).select("id");
  assert.equal(result.error, null);
  // Typed planner may go through queryGateway with ::text; ensure no cast reached D1.
  assert.ok(log.length >= 1);
  for (const sql of log) {
    assert.ok(!sql.includes("::"), `expected no PG cast in: ${sql}`);
  }
});
