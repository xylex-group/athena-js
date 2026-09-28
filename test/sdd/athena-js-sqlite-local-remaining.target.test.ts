import { strict as assert } from "node:assert";
import { test } from "node:test";
import { projectSqliteOperationToQueryV1 } from "../../src/sqlite-local/compatibility.ts";
import {
  normalizeSqliteBindValue,
  normalizeSqliteExecutionResult,
} from "../../src/sqlite-local/binds.ts";
import {
  normalizeSqliteError,
  SqliteLocalError,
} from "../../src/sqlite-local/errors.ts";
import {
  SqliteLocalMigrationBackend,
  createSqliteMigrationBackend,
  runSqliteMigrations,
} from "../../src/migrations/sqlite.ts";
import type { MigrationFile } from "../../src/migrations/types.ts";
import type {
  AthenaSqliteExecutor,
  AthenaSqliteStorageValue,
} from "../../src/sqlite-local/contracts.ts";
import { createClient } from "../../src/v3-client.ts";
import { createSqliteAuthDatabase } from "../../src/auth/local/sqlite.ts";
import { createReactNativeSqliteLocalExecutor } from "../../src/react-native/sqlite-local.ts";

function executor(): AthenaSqliteExecutor {
  return {
    capabilities: {
      interrupt: true,
      returning: true,
      savepoints: true,
      transactions: "interactive",
    },
    async execute(sql, parameters) {
      if (sql.includes("schema_migrations")) {
        return { columns: [], rows: [], changes: 0 };
      }
      return {
        columns: ["id", "value"],
        rows: [["row-1", parameters?.[0] ?? null]],
        changes: 1,
      };
    },
    async transaction(callback) {
      return callback({
        execute: this.execute,
      });
    },
  };
}

test("SQLite legacy CRUD projects to Query V1 without emitting SQL", () => {
  const projected = projectSqliteOperationToQueryV1({
    kind: "fetch",
    payload: {
      table_name: "users",
      columns: ["id", "name"],
      conditions: [{ column: "id", operator: "eq", value: "u-1" }],
    },
  });
  assert.equal("sql" in projected, false);
  assert.deepEqual(projected.operation, {
    for_update: false,
    from: { name: "users", schema: null },
    kind: "select",
    order_by: [],
    pagination: { limit: null, offset: null },
    predicate: {
      column: "id",
      kind: "comparison",
      operator: "eq",
      right: { value: { text: "u-1" } },
    },
    selection: { columns: ["id", "name"] },
  });
  assert.equal(normalizeSqliteBindValue(undefined), null);
  assert.equal(normalizeSqliteBindValue(["tag-a", ["tag-b"]]), '["tag-a",["tag-b"]]');
  assert.deepEqual(
    normalizeSqliteExecutionResult({
      columns: ["id"],
      rows: [[undefined as unknown as AthenaSqliteStorageValue]],
      changes: 1,
    }),
    { columns: ["id"], rows: [[null]], changes: 1 },
  );
});

test("SQLite projection preserves mutation intent without compiling SQL", () => {
  const projected = projectSqliteOperationToQueryV1({
    kind: "delete",
    payload: {
      resource_id: "u-1",
      table_name: "users",
    },
  });

  assert.deepEqual(projected.operation, {
    kind: "delete",
    predicate: {
      column: "id",
      kind: "comparison",
      operator: "eq",
      right: { value: { text: "u-1" } },
    },
    returning: "none",
    safety: "require_filter",
    table: { name: "users", schema: null },
  });

  const explicitlyScoped = projectSqliteOperationToQueryV1({
    kind: "delete",
    payload: {
      conditions: [{ column: "resource_id", operator: "eq", value: "r-1" }],
      resource_id: "u-1",
      table_name: "users",
    },
  });
  const explicitlyScopedOperation = explicitlyScoped.operation;
  assert.equal(explicitlyScopedOperation.kind, "delete");
  if (explicitlyScopedOperation.kind !== "delete") {
    throw new Error("Expected a delete projection.");
  }
  assert.deepEqual(explicitlyScopedOperation.predicate, {
    column: "resource_id",
    kind: "comparison",
    operator: "eq",
    right: { value: { text: "r-1" } },
  });
});

test("SQLite Error IR fail-closes and redacts hostile native messages", () => {
  const error = normalizeSqliteError(
    new Error(
      "SQLITE_CONSTRAINT: insert into users(secret) values ('token') at C:\\db\\private.sqlite SQLSTATE=23505",
    ),
  );
  assert.ok(error instanceof SqliteLocalError);
  assert.equal(error.code, "constraint");
  assert.doesNotMatch(error.message, /users|token|private|23505|SQLITE_CONSTRAINT/i);
  assert.doesNotMatch(JSON.stringify(error.toDetails()), /users|token|private|23505|SQLITE_CONSTRAINT/i);
  assert.equal(normalizeSqliteError(new Error("database is locked")).code, "busy");
  assert.equal(normalizeSqliteError(new Error("abort requested")).code, "cancelled");
  assert.equal(normalizeSqliteError(new Error("statement syntax error")).code, "syntax");
  assert.equal(normalizeSqliteError(new Error("executor has been closed")).code, "closed");
  assert.equal(normalizeSqliteError(new Error("feature not implemented")).code, "unsupported");
  assert.equal(normalizeSqliteError({ provider: "strange", message: "driver secret" }).code, "unknown-provider");
});

test("SQLite structured execution remains gated until canonical compilation exists", async () => {
  const calls: string[] = [];
  const base = executor();
  const client = createClient({
    auth: false,
    db: {
      sqlite: {
        executor: {
          ...base,
          async execute(sql, parameters, options) {
            calls.push(sql);
            return base.execute(sql, parameters, options);
          },
        },
      },
    },
  });
  const result = await client.from("users").select();
  assert.match(
    result.error?.message ?? String(result.error ?? ""),
    /AthenaCanonicalQueryCompiler/,
  );
  assert.deepEqual(calls, []);
  await client.close();
});

test("SQLite migration backend uses only the injected executor and an explicit ledger", async () => {
  const calls: string[] = [];
  const base = executor();
  const injected: AthenaSqliteExecutor = {
    ...base,
    async execute(sql, parameters, options) {
      calls.push(sql);
      return base.execute(sql, parameters, options);
    },
  };
  const backend = createSqliteMigrationBackend({ executor: injected });
  assert.ok(backend instanceof SqliteLocalMigrationBackend);
  await backend.ensureLedger();
  const migration: MigrationFile = {
    checksum: "checksum",
    filename: "001-create.sql",
    name: "create",
    path: "migrations/001-create.sql",
    sql: "CREATE TABLE users (id TEXT PRIMARY KEY)",
    version: 1,
  };
  await backend.applyMigration(migration);
  assert.ok(calls.some((sql) => sql.includes("athena_schema_migrations")));
  assert.ok(calls.some((sql) => sql.includes("CREATE TABLE users")));
  await backend.close();
});

test("SQLite migration runner requires an explicit executor and never selects PostgreSQL", async () => {
  const summary = await runSqliteMigrations({
    executor: executor(),
    migrations: [],
    dryRun: true,
  });
  assert.equal(summary.providerLabel, "sqlite-local");
  assert.equal(summary.databaseLabel, "sqlite-local");
});

test("SQLite migration runner stops before SQL when the ledger has a blocking conflict", async () => {
  const calls: string[] = [];
  const migrationOne: MigrationFile = {
    checksum: "local-checksum",
    filename: "0001_initial.sql",
    name: "initial",
    path: "migrations/0001_initial.sql",
    sql: "CREATE TABLE initial (id TEXT PRIMARY KEY)",
    version: 1,
  };
  const migrationTwo: MigrationFile = {
    checksum: "next-checksum",
    filename: "0002_next.sql",
    name: "next",
    path: "migrations/0002_next.sql",
    sql: "CREATE TABLE next (id TEXT PRIMARY KEY)",
    version: 2,
  };
  const base = executor();
  const injected: AthenaSqliteExecutor = {
    ...base,
    async execute(sql, parameters, options) {
      calls.push(sql);
      if (sql.includes("SELECT version, name")) {
        return {
          columns: [
            "version",
            "name",
            "checksum",
            "applied_at",
            "execution_ms",
            "execution_checksum",
          ],
          rows: [[1, "initial", "stored-checksum", "2026-01-01", 1, null]],
          changes: 0,
        };
      }
      return base.execute(sql, parameters, options);
    },
  };

  await assert.rejects(
    () =>
      runSqliteMigrations({
        executor: injected,
        migrations: [migrationOne, migrationTwo],
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "HISTORY");
      return true;
    },
  );
  assert.equal(calls.some((sql) => sql.includes("CREATE TABLE next")), false);
  assert.equal(calls.some((sql) => sql === "BEGIN IMMEDIATE"), true);
});

test("SQLite migration runner locks before reading the ledger", async () => {
  const events: string[] = [];
  let lockHeld = false;
  let ledgerReads = 0;
  let releaseFirstLedgerRead: (() => void) | undefined;
  let startFirstLedgerRead: (() => void) | undefined;
  const firstLedgerReadStarted = new Promise<void>((resolve) => {
    startFirstLedgerRead = resolve;
  });
  const firstLedgerReadRelease = new Promise<void>((resolve) => {
    releaseFirstLedgerRead = resolve;
  });
  const base = executor();
  const shared: AthenaSqliteExecutor = {
    ...base,
    async execute(sql, parameters, options) {
      if (sql === "BEGIN IMMEDIATE") {
        events.push("lock");
        if (lockHeld) throw new Error("database is locked");
        lockHeld = true;
        return { columns: [], rows: [], changes: 0 };
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS")) {
        events.push("ledger-create");
      }
      if (sql.includes("SELECT version, name")) {
        ledgerReads += 1;
        events.push("ledger-read");
        if (ledgerReads === 1) {
          startFirstLedgerRead?.();
          await firstLedgerReadRelease;
        }
      }
      if (sql === "COMMIT") {
        lockHeld = false;
      }
      return base.execute(sql, parameters, options);
    },
  };
  const migration: MigrationFile = {
    checksum: "pending-checksum",
    filename: "0001_pending.sql",
    name: "pending",
    path: "migrations/0001_pending.sql",
    sql: "CREATE TABLE pending (id TEXT PRIMARY KEY)",
    version: 1,
  };

  const first = runSqliteMigrations({
    executor: shared,
    migrations: [migration],
  });
  await firstLedgerReadStarted;

  const secondOutcome = await runSqliteMigrations({
    executor: shared,
    migrations: [migration],
  }).then(
    () => "resolved" as const,
    () => "rejected" as const,
  );

  try {
    assert.deepEqual(events.slice(0, 3), [
      "lock",
      "ledger-create",
      "ledger-read",
    ]);
    assert.equal(ledgerReads, 1);
    assert.equal(secondOutcome, "rejected");
  } finally {
    releaseFirstLedgerRead?.();
    await first;
  }
});

test("SQLite migration dry-run reads a missing ledger without creating it", async () => {
  const calls: string[] = [];
  const base = executor();
  const injected: AthenaSqliteExecutor = {
    ...base,
    async execute(sql, parameters, options) {
      calls.push(sql);
      if (sql.includes("SELECT version, name")) {
        throw new Error("no such table: athena_schema_migrations");
      }
      return base.execute(sql, parameters, options);
    },
  };

  const summary = await runSqliteMigrations({
    executor: injected,
    migrations: [{
      checksum: "pending-checksum",
      filename: "0001_pending.sql",
      name: "pending",
      path: "migrations/0001_pending.sql",
      sql: "CREATE TABLE pending (id TEXT PRIMARY KEY)",
      version: 1,
    }],
    dryRun: true,
  });

  assert.equal(summary.pendingCount, 1);
  assert.equal(calls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS")), false);
  assert.equal(calls.some((sql) => sql === "BEGIN IMMEDIATE"), false);
});

test("SQLite Auth is an explicit adapter over a structural executor", async () => {
  const db = createSqliteAuthDatabase({ executor: executor() });
  const result = await db.query("select ?", ["auth-value"]);
  assert.deepEqual(result.rows[0], { id: "row-1", value: "auth-value" });
  assert.equal(result.rowCount, 1);
});

test("React Native local data adapter is host-injected and does not enable Auth", async () => {
  const host = executor();
  const adapted = createReactNativeSqliteLocalExecutor({ executor: host });
  assert.equal(adapted.capabilities.transactions, "interactive");
  assert.deepEqual((await adapted.execute("select 1")).rows, [[
    "row-1",
    null,
  ]]);
});
