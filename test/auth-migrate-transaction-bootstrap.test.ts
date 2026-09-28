import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAuthDatabaseFromRuntime,
  createSqliteAuthDatabase,
} from "../src/auth/local/index.ts";
import { inspectAthenaAuthSchema } from "../src/auth/local/schema.ts";
import { inspectAthenaAuthMigrationExpectations } from "../src/auth/local/schema-inspect.ts";
import type { AthenaPostgresRuntime } from "../src/postgres/owned-runtime.ts";
import { PostgresAuthorizationStore } from "../src/runtime/authorization/postgres.ts";
import type { AthenaSqliteExecutor } from "../src/sqlite-local/contracts.ts";

const here = dirname(fileURLToPath(import.meta.url));

function emptyResult() {
  return { rowCount: 0, rows: [] as Record<string, unknown>[] };
}

function createQueryRuntime(onQuery: (text: string) => unknown) {
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return { idleCount: 1, totalCount: 1, waitingCount: 0 };
    },
    async query(text) {
      const override = onQuery(text);
      if (override !== undefined) {
        return override as never;
      }
      return emptyResult() as never;
    },
    async transaction(fn) {
      return fn(runtime as AthenaPostgresRuntime);
    },
  };
  return runtime;
}

test("regression: schema inspect does not detect transactions via 25P01", () => {
  const source = readFileSync(
    join(here, "../src/auth/local/schema-inspect.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /25P01/);
  assert.doesNotMatch(source, /postgresSqlState/);
  assert.match(source, /db\.inTransaction !== true/);
});

test("regression: Auth inspect runs catalog SQL without SAVEPOINT outside a transaction", async () => {
  const queries: string[] = [];
  const database = createAuthDatabaseFromRuntime(
    createQueryRuntime((text) => {
      queries.push(text);
      return undefined;
    })
  );
  assert.equal(database.inTransaction, false);
  await inspectAthenaAuthMigrationExpectations(database, [
    { expectations: [], version: 1 },
  ]);
  assert.ok(queries.some((sql) => /pg_namespace|information_schema/i.test(sql)));
  assert.equal(
    queries.some((sql) => /SAVEPOINT athena_auth_schema_inspect/i.test(sql)),
    false
  );
});

test("regression: Standalone Auth schema inspection executes zero SAVEPOINT statements", async () => {
  const queries: string[] = [];
  const database = createAuthDatabaseFromRuntime(
    createQueryRuntime((text) => {
      queries.push(text);
      return appliedLedgerQuery(text);
    })
  );
  assert.equal(database.inTransaction, false);
  await inspectAthenaAuthSchema(database);
  assert.ok(queries.some((sql) => /pg_namespace|information_schema/i.test(sql)));
  assert.equal(
    queries.filter((sql) => /\bSAVEPOINT\b/i.test(sql)).length,
    0
  );
});

function appliedLedgerQuery(text: string) {
  if (/\bto_regclass\b/.test(text)) {
    return { rowCount: 1, rows: [{ oid: "auth_schema_migrations" }] };
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
  return undefined;
}

test("regression: Schema inspection inside db.transaction() does use a savepoint", async () => {
  const queries: string[] = [];
  const database = createAuthDatabaseFromRuntime(
    createQueryRuntime((text) => {
      queries.push(text);
      return appliedLedgerQuery(text);
    })
  );
  await database.transaction(async (tx) => {
    assert.equal(tx.inTransaction, true);
    await inspectAthenaAuthSchema(tx);
  });
  assert.ok(
    queries.some((sql) => /SAVEPOINT athena_auth_schema_inspect/i.test(sql))
  );
  assert.ok(
    queries.some((sql) =>
      /RELEASE SAVEPOINT athena_auth_schema_inspect/i.test(sql)
    )
  );
});

test("regression: Auth inspect issues SAVEPOINT only on the transaction-scoped adapter", async () => {
  const queries: string[] = [];
  const database = createAuthDatabaseFromRuntime(
    createQueryRuntime((text) => {
      queries.push(text);
      return undefined;
    })
  );
  await database.transaction(async (tx) => {
    assert.equal(tx.inTransaction, true);
    await inspectAthenaAuthMigrationExpectations(tx, [
      { expectations: [], version: 1 },
    ]);
  });
  assert.ok(
    queries.some((sql) => /SAVEPOINT athena_auth_schema_inspect/i.test(sql))
  );
  assert.ok(
    queries.some((sql) =>
      /RELEASE SAVEPOINT athena_auth_schema_inspect/i.test(sql)
    )
  );
});

test("regression: failed Auth inspect rolls back and releases the inspect savepoint", async () => {
  let aborted = false;
  const queries: string[] = [];
  const database = createAuthDatabaseFromRuntime(
    createQueryRuntime((text) => {
      queries.push(text);
      if (/ROLLBACK TO SAVEPOINT athena_auth_schema_inspect/i.test(text)) {
        aborted = false;
        return emptyResult();
      }
      if (
        /SAVEPOINT athena_auth_schema_inspect|RELEASE SAVEPOINT athena_auth_schema_inspect/i.test(
          text
        )
      ) {
        return emptyResult();
      }
      if (aborted) {
        throw Object.assign(
          new Error(
            "current transaction is aborted, commands ignored until end of transaction block"
          ),
          { code: "25P02" }
        );
      }
      if (/pg_get_constraintdef/.test(text)) {
        aborted = true;
        throw Object.assign(
          new Error('syntax error at or near "constraint"'),
          { code: "42601" }
        );
      }
      return undefined;
    })
  );
  await database.transaction(async (tx) => {
    await assert.rejects(() =>
      inspectAthenaAuthMigrationExpectations(tx, [
        { expectations: [], version: 1 },
      ])
    );
    const ops = queries
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
    assert.deepEqual(ops, ["savepoint", "rollback", "release"]);
    await tx.query("SELECT 1");
  });
});

test("regression: SQLite Auth root is not in a transaction; scoped adapter is", async () => {
  const host: AthenaSqliteExecutor = {
    capabilities: {
      interrupt: true,
      returning: true,
      savepoints: true,
      transactions: "interactive",
    },
    async execute() {
      return { columns: [], rows: [], changes: 0 };
    },
    async transaction(callback) {
      return callback({
        execute: async () => ({ columns: [], rows: [], changes: 0 }),
      });
    },
  };
  const db = createSqliteAuthDatabase({ executor: host });
  assert.equal(db.inTransaction, false);
  await db.transaction(async (tx) => {
    assert.equal(tx.inTransaction, true);
    assert.notEqual(tx, db);
  });
});

test("regression: authorization catalog ensureCatalog probes to_regclass before SELECT", async () => {
  const queries: string[] = [];
  let tableExists = false;
  const runtime = createQueryRuntime((text) => {
    queries.push(text);
    if (/\bto_regclass\b/.test(text)) {
      return {
        rowCount: 1,
        rows: [{ oid: tableExists ? "authorization_catalog_state" : null }],
      };
    }
    if (/CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(text)) {
      tableExists = true;
      return emptyResult();
    }
    if (
      /FROM athena\.authorization_catalog_state/.test(text) &&
      /SELECT catalog_version/.test(text) &&
      !tableExists
    ) {
      throw Object.assign(
        new Error('relation "athena.authorization_catalog_state" does not exist'),
        { code: "42P01" }
      );
    }
    if (/pg_advisory_xact_lock/.test(text)) {
      return { rowCount: 1, rows: [{}] };
    }
    if (/INSERT INTO athena\.authorization_roles/.test(text)) {
      return { rowCount: 1, rows: [{}] };
    }
    return undefined;
  });
  const database = createAuthDatabaseFromRuntime(runtime);
  await new PostgresAuthorizationStore(database).ensureCatalog();
  const firstToRegclass = queries.findIndex((sql) => /\bto_regclass\b/.test(sql));
  const firstSelect = queries.findIndex(
    (sql) =>
      /FROM athena\.authorization_catalog_state/.test(sql) &&
      /SELECT catalog_version/.test(sql)
  );
  const firstCreate = queries.findIndex((sql) =>
    /CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(sql)
  );
  assert.ok(firstToRegclass >= 0);
  assert.ok(firstCreate > firstToRegclass);
  assert.ok(firstSelect === -1 || firstSelect > firstCreate);
});

test("regression: Fresh DB + authorization ensureCatalog() produces no 42P01", async () => {
  const sqlStates: string[] = [];
  let catalogStateExists = false;
  const runtime = createQueryRuntime((text) => {
    const touchesCatalogState =
      /athena\.authorization_catalog_state/.test(text) &&
      !/\bto_regclass\b/.test(text) &&
      !/CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(
        text
      );
    if (touchesCatalogState && !catalogStateExists) {
      const error = Object.assign(
        new Error('relation "athena.authorization_catalog_state" does not exist'),
        { code: "42P01" }
      );
      sqlStates.push("42P01");
      throw error;
    }
    if (/\bto_regclass\b/.test(text)) {
      return {
        rowCount: 1,
        rows: [
          { oid: catalogStateExists ? "authorization_catalog_state" : null },
        ],
      };
    }
    if (/CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(text)) {
      catalogStateExists = true;
      return emptyResult();
    }
    if (/pg_advisory_xact_lock/.test(text)) {
      return { rowCount: 1, rows: [{}] };
    }
    if (/INSERT INTO athena\.authorization_roles/.test(text)) {
      return { rowCount: 1, rows: [{}] };
    }
    return undefined;
  });
  await new PostgresAuthorizationStore(
    createAuthDatabaseFromRuntime(runtime)
  ).ensureCatalog();
  assert.equal(sqlStates.includes("42P01"), false);
  assert.equal(catalogStateExists, true);
});

test("regression: authorization catalog writes stay on the materialize transaction", async () => {
  const events: string[] = [];
  let tableExists = false;
  const runtime = createQueryRuntime((text) => {
    events.push(text);
    if (/\bto_regclass\b/.test(text)) {
      return {
        rowCount: 1,
        rows: [{ oid: tableExists ? "authorization_catalog_state" : null }],
      };
    }
    if (/CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(text)) {
      tableExists = true;
      return emptyResult();
    }
    if (/pg_advisory_xact_lock/.test(text)) {
      return { rowCount: 1, rows: [{}] };
    }
    if (/INSERT INTO athena\.authorization_roles/.test(text)) {
      return { rowCount: 1, rows: [{}] };
    }
    return undefined;
  });
  const database = createAuthDatabaseFromRuntime(runtime);
  await new PostgresAuthorizationStore(database).ensureCatalog();
  const writes = events.filter((sql) =>
    /INSERT INTO athena\.authorization_(rights|roles|role_rights|catalog_state)/.test(
      sql
    )
  );
  assert.ok(writes.length > 0);
  assert.match(events[0] ?? "", /to_regclass/);
});
