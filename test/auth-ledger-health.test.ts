import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_MIGRATION_ADVISORY_LOCK } from "../src/auth/contract/index.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { classifyAuthLedgerQueryError } from "../src/auth/local/ledger-health.ts";
import {
  inspectAthenaAuthSchema,
  planAthenaAuthSchema,
  withAthenaAuthMigrationLock,
} from "../src/auth/local/schema.ts";
import {
  ATHENA_MIGRATION_LOCK_KEY1,
  ATHENA_MIGRATION_LOCK_KEY2,
} from "../src/migrations/postgres.ts";

test("schema inspect does not alias pg_constraint as reserved CONSTRAINT", () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/auth/local/schema-inspect.ts"
    ),
    "utf8"
  );
  assert.doesNotMatch(source, /pg_constraint\s+AS\s+constraint\b/i);
  assert.doesNotMatch(source, /\bconstraint\.con(name|relid|oid)\b/);
  assert.match(source, /pg_get_constraintdef\(\s*pg_con\.oid\s*\)/);
  assert.match(
    source,
    /if \(db\.inTransaction !== true\) \{\s*return inspectCatalog\(\);/
  );
  assert.match(source, /return withInspectSavepoint\(db, inspectCatalog\)/);
  assert.match(
    source,
    /ROLLBACK TO SAVEPOINT \$\{INSPECT_SAVEPOINT\}[\s\S]*RELEASE SAVEPOINT \$\{INSPECT_SAVEPOINT\}/
  );
  assert.doesNotMatch(source, /withOptionalInspectSavepoint/);
  assert.doesNotMatch(source, /postgresSqlState/);
});

test("schema inspect skips SAVEPOINT when the adapter is not in a transaction", async () => {
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query(text) {
      queries.push(text);
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: "oid" }] };
      }
      if (/column_name/.test(text) && /checksum/.test(text)) {
        return { rowCount: 1, rows: [{ column_name: "checksum" }] };
      }
      if (/FROM athena\.auth_schema_migrations/.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              checksum: "abc",
              name: "001_create_core_tables",
              version: 1,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  await planAthenaAuthSchema(database, { inspectSchema: true });
  assert.equal(
    queries.some((sql) => /SAVEPOINT athena_auth_schema_inspect/i.test(sql)),
    false
  );
  assert.equal(
    queries.some((sql) => /RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT/i.test(sql)),
    false
  );
  assert.ok(
    queries.some((sql) => /pg_get_constraintdef|pg_namespace|information_schema/i.test(sql))
  );
});

test("Standalone Auth schema inspection executes zero SAVEPOINT statements", async () => {
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query(text) {
      queries.push(text);
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: "oid" }] };
      }
      if (/column_name/.test(text) && /checksum/.test(text)) {
        return { rowCount: 1, rows: [{ column_name: "checksum" }] };
      }
      if (/FROM athena\.auth_schema_migrations/.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              checksum: "abc",
              name: "001_create_core_tables",
              version: 1,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  await inspectAthenaAuthSchema(database);
  assert.equal(
    queries.filter((sql) => /\bSAVEPOINT\b/i.test(sql)).length,
    0
  );
});

test("Schema inspection inside db.transaction() does use a savepoint", async () => {
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query(text) {
      queries.push(`root:${text}`);
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: "oid" }] };
      }
      if (/column_name/.test(text) && /checksum/.test(text)) {
        return { rowCount: 1, rows: [{ column_name: "checksum" }] };
      }
      if (/FROM athena\.auth_schema_migrations/.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              checksum: "abc",
              name: "001_create_core_tables",
              version: 1,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      const tx: AthenaAuthDatabase = {
        inTransaction: true,
        async query(text) {
          queries.push(`tx:${text}`);
          return database.query(text);
        },
        async transaction(inner) {
          return inner(tx);
        },
      };
      return fn(tx);
    },
  };
  await database.transaction(async (tx) => {
    await inspectAthenaAuthSchema(tx);
  });
  assert.ok(
    queries.some((sql) =>
      /tx:SAVEPOINT athena_auth_schema_inspect/i.test(sql)
    )
  );
});

test("schema inspect wraps catalog probes in a SAVEPOINT when inTransaction is true", async () => {
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: true,
    async query(text) {
      queries.push(text);
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: "oid" }] };
      }
      if (/column_name/.test(text) && /checksum/.test(text)) {
        return { rowCount: 1, rows: [{ column_name: "checksum" }] };
      }
      if (/FROM athena\.auth_schema_migrations/.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              checksum: "abc",
              name: "001_create_core_tables",
              version: 1,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  await planAthenaAuthSchema(database, { inspectSchema: true });
  assert.ok(
    queries.some((sql) => /SAVEPOINT athena_auth_schema_inspect/i.test(sql))
  );
  assert.ok(
    queries.some((sql) =>
      /RELEASE SAVEPOINT athena_auth_schema_inspect/i.test(sql)
    )
  );
});

test("planAthenaAuthSchema does not inspect catalogs when the ledger is empty", async () => {
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query(text) {
      queries.push(text);
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: null }] };
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  const plan = await planAthenaAuthSchema(database, { inspectSchema: true });
  assert.ok(plan.pendingCount > 0);
  const inspectedCatalog = queries.some((sql) =>
    /pg_get_constraintdef|pg_namespace|information_schema/i.test(sql)
  );
  assert.equal(inspectedCatalog, false);
});

test("planAthenaAuthSchema inspect failures do not abort later ledger probes", async () => {
  let aborted = false;
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: true,
    async query(text) {
      queries.push(text);
      if (/ROLLBACK TO SAVEPOINT athena_auth_schema_inspect/i.test(text)) {
        aborted = false;
        return { rowCount: 0, rows: [] };
      }
      if (/SAVEPOINT athena_auth_schema_inspect|RELEASE SAVEPOINT athena_auth_schema_inspect/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      if (aborted) {
        throw Object.assign(
          new Error(
            "current transaction is aborted, commands ignored until end of transaction block"
          ),
          { code: "25P02" }
        );
      }
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: "oid" }] };
      }
      if (/column_name/.test(text) && /checksum/.test(text)) {
        return { rowCount: 1, rows: [{ column_name: "checksum" }] };
      }
      if (/FROM athena\.auth_schema_migrations/.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              checksum: "abc",
              name: "001_create_core_tables",
              version: 1,
            },
          ],
        };
      }
      if (/pg_get_constraintdef/.test(text)) {
        aborted = true;
        throw Object.assign(
          new Error('syntax error at or near "constraint"'),
          { code: "42601" }
        );
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  const plan = await planAthenaAuthSchema(database, { inspectSchema: true });
  assert.ok(plan.pendingCount > 0);
  const savepointOps = queries
    .map((sql) => {
      if (/ROLLBACK TO SAVEPOINT athena_auth_schema_inspect/i.test(sql)) {
        return "rollback";
      }
      if (/RELEASE SAVEPOINT athena_auth_schema_inspect/i.test(sql)) {
        return "release";
      }
      if (/SAVEPOINT athena_auth_schema_inspect/i.test(sql)) {
        return "savepoint";
      }
      return undefined;
    })
    .filter((op): op is string => op !== undefined);
  assert.deepEqual(savepointOps, ["savepoint", "rollback", "release"]);
  await database.query("SELECT 1");
});

test("missing auth ledger table is UNINITIALIZED, not unreachable", () => {
  assert.equal(
    classifyAuthLedgerQueryError(
      new Error('relation "athena.auth_schema_migrations" does not exist')
    ),
    "UNINITIALIZED"
  );
  assert.equal(
    classifyAuthLedgerQueryError({ code: "42P01", message: "undefined_table" }),
    "UNINITIALIZED"
  );
});

test("connection and privilege failures are not UNINITIALIZED", () => {
  const refused = Object.assign(
    new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    {
      code: "ECONNREFUSED",
    }
  );
  assert.equal(classifyAuthLedgerQueryError(refused), "UNREACHABLE");
  assert.equal(
    classifyAuthLedgerQueryError({
      code: "42501",
      message: "permission denied",
    }),
    "PERMISSION_DENIED"
  );
  assert.equal(
    classifyAuthLedgerQueryError(
      new AthenaAuthRuntimeError(500, "bad adapter", {
        code: "ATHENA_AUTH_DATABASE_RESULT_INVALID",
      })
    ),
    "INVALID_LEDGER"
  );
});

test("planAthenaAuthSchema fails closed on unreachable ledger reads", async () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query() {
      throw refused;
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  await assert.rejects(
    () => planAthenaAuthSchema(database),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE"
  );
});

test("planAthenaAuthSchema treats a missing ledger table as uninitialized pending history", async () => {
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query() {
      throw new Error(
        'relation "athena.auth_schema_migrations" does not exist'
      );
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  const plan = await planAthenaAuthSchema(database, { inspectSchema: false });
  assert.equal(plan.health, "UNINITIALIZED");
  assert.ok(plan.pendingCount > 0);
  assert.equal(plan.conflictCount, 0);
});

test("planAthenaAuthSchema probes a missing ledger with to_regclass so the transaction stays open", async () => {
  let aborted = false;
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query(text) {
      queries.push(text);
      if (aborted) {
        throw Object.assign(
          new Error(
            "current transaction is aborted, commands ignored until end of transaction block"
          ),
          { code: "25P02" }
        );
      }
      if (/\bto_regclass\b/.test(text)) {
        return { rowCount: 1, rows: [{ oid: null }] };
      }
      if (/CREATE SCHEMA/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      aborted = true;
      throw Object.assign(
        new Error('relation "athena.auth_schema_migrations" does not exist'),
        { code: "42P01" }
      );
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  const plan = await planAthenaAuthSchema(database, { inspectSchema: false });
  assert.equal(plan.health, "UNINITIALIZED");
  assert.ok(queries.some((sql) => /\bto_regclass\b/.test(sql)));
  aborted = false;
  await database.query("CREATE SCHEMA IF NOT EXISTS athena");
});

test("Embedded Auth migration lock is independent of application ATHA/MIGS", async () => {
  assert.notEqual(
    ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
    ATHENA_MIGRATION_LOCK_KEY1
  );
  assert.notEqual(
    ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
    ATHENA_MIGRATION_LOCK_KEY2
  );

  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rowCount: 1, rows: [{ acquired: true }] as T[] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  const result = await withAthenaAuthMigrationLock(
    database,
    async () => "locked"
  );
  assert.equal(result, "locked");
  assert.ok(
    queries.some(
      (item) =>
        /pg_advisory_xact_lock\(/.test(item.text) &&
        item.values?.[0] === ATHENA_AUTH_MIGRATION_ADVISORY_LOCK
    )
  );
  assert.equal(
    queries.some((item) => /pg_advisory_unlock\(/.test(item.text)),
    false
  );
  assert.equal(
    queries.some(
      (item) =>
        /pg_advisory_lock\(/.test(item.text) &&
        !/pg_advisory_xact_lock\(/.test(item.text)
    ),
    false
  );
});
