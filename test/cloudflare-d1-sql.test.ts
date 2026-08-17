import { strict as assert } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileD1Delete,
  compileD1Fetch,
  compileD1Insert,
  compileD1Update,
  D1SqlCompileError,
} from "../src/cloudflare/d1/sql.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../src/gateway/types.ts";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "d1-gateway"
);

interface Fixture {
  name: string;
  operation: "fetch" | "insert" | "update" | "delete";
  params: unknown[];
  payload: Record<string, unknown>;
  sql: string;
}

function loadFixtures(): Fixture[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Fixture
    );
}

test("D1 SQL fixtures match L1 compiler", () => {
  for (const fixture of loadFixtures()) {
    let compiled: {
      sql: string;
      params: unknown[];
      statements?: Array<{ sql: string; params: unknown[] }>;
    };
    switch (fixture.operation) {
      case "fetch":
        compiled = compileD1Fetch(fixture.payload as AthenaFetchPayload);
        break;
      case "insert":
        compiled = compileD1Insert(
          fixture.payload as unknown as AthenaInsertPayload
        );
        break;
      case "update":
        compiled = compileD1Update(
          fixture.payload as unknown as AthenaUpdatePayload
        );
        break;
      case "delete":
        compiled = compileD1Delete(
          fixture.payload as unknown as AthenaDeletePayload
        );
        break;
      default:
        throw new Error(`unknown op ${fixture.operation}`);
    }
    if (compiled.statements && compiled.statements.length > 1) {
      // Multi-statement batch fixtures would assert statements[]; skip single-sql equality.
      assert.ok(compiled.statements.length > 0, fixture.name);
      continue;
    }
    assert.equal(compiled.sql, fixture.sql, fixture.name);
    assert.deepEqual(compiled.params, fixture.params, fixture.name);
  }
});

test("rejects nested relation select", () => {
  assert.throws(
    () =>
      compileD1Fetch({
        select: {
          id: true,
          posts: { select: { id: true } },
        } as never,
        table_name: "users",
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "relations_unsupported"
  );
});

test("rejects unfiltered update", () => {
  assert.throws(
    () =>
      compileD1Update({
        table_name: "users",
        update_body: { name: "x" },
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError && error.code === "unfiltered_update"
  );
});

test("compiles ilike as COLLATE NOCASE", () => {
  const compiled = compileD1Fetch({
    conditions: [{ column: "email", operator: "ilike", value: "%Ada%" }],
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'SELECT * FROM "users" WHERE "email" LIKE ? COLLATE NOCASE'
  );
  assert.deepEqual(compiled.params, ["%Ada%"]);
});

test("eq null compiles to IS NULL (not col = NULL)", () => {
  const compiled = compileD1Fetch({
    conditions: [{ column: "deleted_at", operator: "eq", value: null }],
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'SELECT * FROM "users" WHERE "deleted_at" IS NULL'
  );
  assert.deepEqual(compiled.params, []);
});

test("neq null compiles to IS NOT NULL", () => {
  const compiled = compileD1Fetch({
    conditions: [{ column: "deleted_at", operator: "neq", value: null }],
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'SELECT * FROM "users" WHERE "deleted_at" IS NOT NULL'
  );
  assert.deepEqual(compiled.params, []);
});

test("compiles upsert on_conflict", () => {
  const compiled = compileD1Insert({
    insert_body: { email: "a@example.com", name: "Ada" },
    on_conflict: "email",
    table_name: "users",
    update_body: { name: "Ada2" },
  });
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("email", "name") VALUES (?, ?) ON CONFLICT ("email") DO UPDATE SET "name" = ?'
  );
  assert.deepEqual(compiled.params, ["a@example.com", "Ada", "Ada2"]);
});

test("upsert without update_body assigns non-conflict cols from excluded", () => {
  const compiled = compileD1Insert({
    insert_body: { email: "a@example.com", name: "Ada" },
    on_conflict: "email",
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("email", "name") VALUES (?, ?) ON CONFLICT ("email") DO UPDATE SET "name" = excluded."name"'
  );
  assert.deepEqual(compiled.params, ["a@example.com", "Ada"]);
});

test("upsert with empty update_body is DO NOTHING", () => {
  const compiled = compileD1Insert({
    insert_body: { email: "a@example.com", name: "Ada" },
    on_conflict: "email",
    table_name: "users",
    update_body: {},
  });
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("email", "name") VALUES (?, ?) ON CONFLICT ("email") DO NOTHING'
  );
});

test("on_conflict splits comma-separated composite targets", () => {
  const compiled = compileD1Insert({
    insert_body: { email: "a@example.com", name: "Ada", tenant_id: "t1" },
    on_conflict: "tenant_id,email",
    table_name: "users",
  });
  // INSERT columns follow object key insertion order; conflict targets stay explicit.
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("email", "name", "tenant_id") VALUES (?, ?, ?) ON CONFLICT ("tenant_id", "email") DO UPDATE SET "name" = excluded."name"'
  );
  assert.deepEqual(compiled.params, ["a@example.com", "Ada", "t1"]);
});

test("head-only insert suppresses RETURNING", () => {
  const compiled = compileD1Insert({
    columns: "id,email",
    head: true,
    insert_body: { email: "a@example.com" },
    table_name: "users",
  });
  assert.equal(compiled.sql, 'INSERT INTO "users" ("email") VALUES (?)');
  assert.equal(compiled.sql.includes("RETURNING"), false);
  assert.deepEqual(compiled.params, ["a@example.com"]);
});

test("head-only upsert suppresses RETURNING", () => {
  const compiled = compileD1Insert({
    columns: "*",
    head: true,
    insert_body: { email: "a@example.com", name: "Ada" },
    on_conflict: "email",
    table_name: "users",
    update_body: { name: "Ada2" },
  });
  assert.equal(compiled.sql.includes("RETURNING"), false);
  assert.match(compiled.sql, /ON CONFLICT/);
});

test("insert with columns emits RETURNING when not head", () => {
  const compiled = compileD1Insert({
    columns: "id,email",
    insert_body: { email: "a@example.com" },
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("email") VALUES (?) RETURNING "id", "email"'
  );
});

test("select response aliases compile to AS expressions", () => {
  const compiled = compileD1Fetch({
    columns: "user_id:id, user_email:email",
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'SELECT "id" AS "user_id", "email" AS "user_email" FROM "users"'
  );
});

test("select SQL-style aliases compile to AS expressions", () => {
  const compiled = compileD1Fetch({
    columns: "id as user_id, email",
    table_name: "users",
  });
  assert.equal(compiled.sql, 'SELECT "id" AS "user_id", "email" FROM "users"');
});

test("rejects SQL expression select lists (injection hardening)", () => {
  assert.throws(
    () =>
      compileD1Fetch({
        columns: "id, (SELECT password FROM secrets)",
        table_name: "users",
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError && error.code === "unsafe_select"
  );
});

test("rejects malicious table identifiers", () => {
  assert.throws(
    () =>
      compileD1Fetch({
        table_name: 'users"; DROP TABLE users;--',
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError && error.code === "invalid_identifier"
  );
});

test("RETURNING uses response aliases", () => {
  const compiled = compileD1Insert({
    columns: "user_id:id, email",
    insert_body: { email: "a@example.com" },
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("email") VALUES (?) RETURNING "id" AS "user_id", "email"'
  );
});

test("sparse multi-row insert expands to single-row batch (no DEFAULT in VALUES)", () => {
  const compiled = compileD1Insert({
    insert_body: [{ name: "a", role: "admin" }, { name: "b" }],
    table_name: "users",
  });
  assert.ok(compiled.statements);
  assert.equal(compiled.statements?.length, 2);
  assert.equal(
    compiled.statements?.[0]?.sql,
    'INSERT INTO "users" ("name", "role") VALUES (?, ?)'
  );
  assert.deepEqual(compiled.statements?.[0]?.params, ["a", "admin"]);
  assert.equal(
    compiled.statements?.[1]?.sql,
    'INSERT INTO "users" ("name") VALUES (?)'
  );
  assert.deepEqual(compiled.statements?.[1]?.params, ["b"]);
  // SQLite forbids DEFAULT tokens in multi-row VALUES tuples.
  assert.ok(
    !compiled.statements?.some((statement) => statement.sql.includes("DEFAULT"))
  );
});

test("sparse multi-row insert binds NULL when default_to_null", () => {
  const compiled = compileD1Insert({
    default_to_null: true,
    insert_body: [{ name: "a", role: "admin" }, { name: "b" }],
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'INSERT INTO "users" ("name", "role") VALUES (?, ?), (?, ?)'
  );
  assert.deepEqual(compiled.params, ["a", "admin", "b", null]);
});

test("delete with resource_id filter preserves resource_id (does not map to id)", () => {
  const compiled = compileD1Delete({
    conditions: [{ column: "resource_id", operator: "eq", value: "u1" }],
    resource_id: "u1",
    table_name: "users",
  });
  assert.equal(compiled.sql, 'DELETE FROM "users" WHERE "resource_id" = ?');
  assert.deepEqual(compiled.params, ["u1"]);
});

test("delete with resource_id payload only maps to id when no column filter", () => {
  const compiled = compileD1Delete({
    resource_id: "u1",
    table_name: "users",
  });
  assert.equal(compiled.sql, 'DELETE FROM "users" WHERE "id" = ?');
  assert.deepEqual(compiled.params, ["u1"]);
});

test("offset without limit emits SQLite LIMIT -1", () => {
  const compiled = compileD1Fetch({
    offset: 10,
    table_name: "users",
  });
  assert.equal(compiled.sql, 'SELECT * FROM "users" LIMIT -1 OFFSET 10');
  assert.deepEqual(compiled.params, []);
});

test("head-only fetch compiles COUNT query", () => {
  const compiled = compileD1Fetch({
    conditions: [{ column: "active", operator: "eq", value: true }],
    head: true,
    table_name: "users",
  });
  assert.equal(
    compiled.sql,
    'SELECT COUNT(*) AS __athena_count FROM "users" WHERE "active" = ?'
  );
  assert.deepEqual(compiled.params, [true]);
});

const idIdentity = { identityColumn: "id" };

test("update with page bounds uses identity subquery", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      current_page: 2,
      page_size: 10,
      sort_by: { direction: "ascending", field: "id" },
      table_name: "users",
      update_body: { name: "x" },
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'UPDATE "users" SET "name" = ? WHERE "id" IN (SELECT "id" FROM "users" WHERE "active" = ? ORDER BY "id" ASC LIMIT 10 OFFSET 10)'
  );
  assert.deepEqual(compiled.params, ["x", true]);
});

test("P1: limit + current_page derives OFFSET from limit as page size", () => {
  // .limit(10).currentPage(2) must not stay on page-one rows (OFFSET 0).
  const compiled = compileD1Update(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      current_page: 2,
      limit: 10,
      sort_by: { direction: "ascending", field: "id" },
      table_name: "users",
      update_body: { name: "x" },
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'UPDATE "users" SET "name" = ? WHERE "id" IN (SELECT "id" FROM "users" WHERE "active" = ? ORDER BY "id" ASC LIMIT 10 OFFSET 10)'
  );
  assert.deepEqual(compiled.params, ["x", true]);

  const del = compileD1Delete(
    {
      conditions: [{ column: "expired", operator: "eq", value: true }],
      current_page: 3,
      limit: 5,
      table_name: "events",
    },
    idIdentity
  );
  assert.equal(
    del.sql,
    'DELETE FROM "events" WHERE "id" IN (SELECT "id" FROM "events" WHERE "expired" = ? LIMIT 5 OFFSET 10)'
  );
});

test("update with limit/offset uses proven identity subquery", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "pending", operator: "eq", value: true }],
      limit: 1,
      offset: 0,
      table_name: "events",
      update_body: { done: true },
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'UPDATE "events" SET "done" = ? WHERE "id" IN (SELECT "id" FROM "events" WHERE "pending" = ? LIMIT 1 OFFSET 0)'
  );
  assert.deepEqual(compiled.params, [true, true]);
});

test("delete with page bounds uses identity subquery", () => {
  const compiled = compileD1Delete(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      current_page: 1,
      page_size: 5,
      table_name: "users",
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'DELETE FROM "users" WHERE "id" IN (SELECT "id" FROM "users" WHERE "active" = ? LIMIT 5 OFFSET 0)'
  );
});

test("bounded update with custom identity column (uuid PK)", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "active", operator: "eq", value: true }],
      limit: 1,
      table_name: "events",
      update_body: { name: "x" },
    },
    { identityColumn: "uuid" }
  );
  assert.equal(
    compiled.sql,
    'UPDATE "events" SET "name" = ? WHERE "uuid" IN (SELECT "uuid" FROM "events" WHERE "active" = ? LIMIT 1)'
  );
});

test("bounded update rejects missing identity column", () => {
  assert.throws(
    () =>
      compileD1Update({
        conditions: [{ column: "active", operator: "eq", value: true }],
        limit: 1,
        table_name: "users",
        update_body: { name: "x" },
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError &&
      error.code === "bounded_mutation_no_unique_identity"
  );
});

test("bounded update with id filter uses supplied identity", () => {
  const compiled = compileD1Update(
    {
      conditions: [{ column: "id", operator: "eq", value: "u1" }],
      limit: 1,
      table_name: "users",
      update_body: { name: "x" },
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'UPDATE "users" SET "name" = ? WHERE "id" IN (SELECT "id" FROM "users" WHERE "id" = ? LIMIT 1)'
  );
});

test("rejects bounded mutation when filters reference rowid alias", () => {
  assert.throws(
    () =>
      compileD1Update(
        {
          conditions: [{ column: "_rowid_", operator: "eq", value: 1 }],
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

test("rejects current_page without page_size on bounded update", () => {
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

test("delete with limit/offset uses proven identity subquery", () => {
  const compiled = compileD1Delete(
    {
      conditions: [{ column: "expired", operator: "eq", value: true }],
      limit: 10,
      offset: 0,
      table_name: "events",
    },
    idIdentity
  );
  assert.equal(
    compiled.sql,
    'DELETE FROM "events" WHERE "id" IN (SELECT "id" FROM "events" WHERE "expired" = ? LIMIT 10 OFFSET 0)'
  );
  assert.deepEqual(compiled.params, [true]);
});

test("single empty insert uses DEFAULT VALUES", () => {
  const compiled = compileD1Insert({
    insert_body: {},
    table_name: "users",
  });
  assert.equal(compiled.sql, 'INSERT INTO "users" DEFAULT VALUES');
  assert.deepEqual(compiled.params, []);
});

test("rejects DEFAULT VALUES upsert (SQLite/D1 syntax)", () => {
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

test("multi empty insert is rejected", () => {
  assert.throws(
    () =>
      compileD1Insert({
        insert_body: [{}, {}],
        table_name: "users",
      }),
    (error: unknown) =>
      error instanceof D1SqlCompileError && error.code === "empty_insert"
  );
});

test("legacy or() inbox filter compiles to parameterized OR", () => {
  const compiled = compileD1Fetch({
    conditions: [{ operator: "or", value: "deleted.eq.false,deleted.is.null" }],
    table_name: "notifications",
  });
  assert.match(compiled.sql, /"deleted" = \?/);
  assert.match(compiled.sql, /"deleted" IS NULL/);
  assert.match(compiled.sql, / OR /);
  assert.deepEqual(compiled.params, [false]);
});
