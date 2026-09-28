import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_MIGRATION_ADVISORY_LOCK } from "../src/auth/contract/index.ts";
import {
  type AthenaAuthDatabase,
  authDatabaseTimeoutError,
  postgresLocalTimeoutStatements,
} from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import {
  getAthenaAuthExpectedLedger,
  withAthenaAuthMigrationLock,
} from "../src/auth/local/schema.ts";
import { createObservingAuthDatabase } from "./auth-schema-observer.ts";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sessionAdvisoryLock(sql: string): boolean {
  return (
    /pg_advisory_lock\s*\(/.test(sql) && !/pg_advisory_xact_lock\s*\(/.test(sql)
  );
}

test("Auth schema source does not acquire pooled session advisory locks", () => {
  const schema = readFileSync(
    join(srcRoot, "auth", "local", "schema.ts"),
    "utf8"
  );
  assert.doesNotMatch(schema, /SELECT pg_advisory_unlock/);
  assert.doesNotMatch(schema, /SELECT pg_advisory_lock\(\$1\)/);
  assert.match(schema, /SELECT pg_advisory_xact_lock\(\$1\)/);
  assert.match(schema, /ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS/);
});

test("migration lock and follow-on SQL share the transaction client, not pool.query", async () => {
  const events: string[] = [];
  let poolQueries = 0;
  let txQueries = 0;
  let sessionLockHeld = false;
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query(text) {
      poolQueries += 1;
      events.push(`pool:${text}`);
      if (sessionAdvisoryLock(text)) {
        sessionLockHeld = true;
      }
      return { rowCount: 1, rows: [{}] };
    },
    async transaction(fn) {
      const tx: AthenaAuthDatabase = {
        inTransaction: true,
        async query(text, values) {
          txQueries += 1;
          events.push(`tx:${text}`);
          if (sessionAdvisoryLock(text)) {
            sessionLockHeld = true;
          }
          if (
            /pg_advisory_xact_lock/.test(text) &&
            sessionLockHeld &&
            values?.[0] === ATHENA_AUTH_MIGRATION_ADVISORY_LOCK
          ) {
            throw new Error(
              "xact lock waited on a pooled session lock from another client"
            );
          }
          return { rowCount: 1, rows: [{}] };
        },
        async transaction(inner) {
          return inner(tx);
        },
      };
      return fn(tx);
    },
  };

  await withAthenaAuthMigrationLock(database, async (tx) => {
    await tx.query("SELECT 'same-client'");
    return "ok";
  });

  assert.equal(poolQueries, 0);
  assert.ok(txQueries >= 2);
  assert.ok(
    events.some(
      (event) => event.startsWith("tx:") && /pg_advisory_xact_lock/.test(event)
    )
  );
  assert.ok(events.some((event) => event.includes("same-client")));
  assert.equal(
    events.some((event) => sessionAdvisoryLock(event)),
    false
  );
});

test("concurrent ensureReady shares one initialization and does not deadlock", async () => {
  let ledgerReads = 0;
  const database = createObservingAuthDatabase({
    ledger: getAthenaAuthExpectedLedger(),
    physical: true,
  });
  const originalQuery = database.query.bind(database);
  database.query = async (text, values) => {
    if (/SELECT version,\s*name/i.test(text)) {
      ledgerReads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return originalQuery(text, values);
  };
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    database,
    secret: "test-secret",
  });
  const [a, b] = await Promise.all([runtime.getStores(), runtime.getStores()]);
  assert.equal(a, b);
  assert.equal(ledgerReads, 1);
  await runtime.close();
});

test("ensureReady retries after ATHENA_AUTH_DATABASE_TIMEOUT and stays failed on schema incompatibility", async () => {
  let ledgerReads = 0;
  let timedOut = false;
  const timeoutThenOk = createObservingAuthDatabase({
    ledger: getAthenaAuthExpectedLedger(),
    physical: true,
  });
  const originalTimeoutQuery = timeoutThenOk.query.bind(timeoutThenOk);
  timeoutThenOk.query = async (text, values) => {
    if (!timedOut && /auth_schema_migrations/i.test(text)) {
      timedOut = true;
      ledgerReads += 1;
      throw authDatabaseTimeoutError();
    }
    if (/auth_schema_migrations/i.test(text)) {
      ledgerReads += 1;
    }
    return originalTimeoutQuery(text, values);
  };
  const retryRuntime = createAthenaAuthRuntime({
    database: timeoutThenOk,
    secret: "test-secret",
  });
  await assert.rejects(
    () => retryRuntime.getStores(),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      (error.code === "ATHENA_AUTH_DATABASE_TIMEOUT" ||
        error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE")
  );
  await retryRuntime.getStores();
  assert.equal(ledgerReads >= 2, true);
  await retryRuntime.close();

  const missing = createObservingAuthDatabase({ missing: true });
  const permanent = createAthenaAuthRuntime({
    database: missing,
    secret: "test-secret",
  });
  await assert.rejects(
    () => permanent.getStores(),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_MISSING"
  );
  await assert.rejects(
    () => permanent.getStores(),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_MISSING"
  );
  await permanent.close();
});

test("ensureReady retries after a physical Auth schema inspection timeout", async () => {
  let timedOut = false;
  const database = createObservingAuthDatabase({
    ledger: getAthenaAuthExpectedLedger(),
    physical: true,
  });
  const originalQuery = database.query.bind(database);
  database.query = async (text, values) => {
    if (!timedOut && /pg_catalog\.pg_namespace/i.test(text)) {
      timedOut = true;
      throw authDatabaseTimeoutError();
    }
    return originalQuery(text, values);
  };
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    database,
    secret: "test-secret",
  });

  await assert.rejects(
    () => runtime.getStores(),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_TIMEOUT"
  );
  await runtime.getStores();
  assert.equal(timedOut, true);
  await runtime.close();
});

test("Auth queries can run while a migration transaction holds the xact lock", async () => {
  let releaseLock: (() => void) | undefined;
  const lockHeld = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let concurrentQueryDuringLock = false;
  const database: AthenaAuthDatabase = {
    async close() { },
    inTransaction: false,
    async query() {
      concurrentQueryDuringLock = true;
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      const tx: AthenaAuthDatabase = {
        inTransaction: true,
        async query(text) {
          if (/pg_advisory_xact_lock/.test(text)) {
            void database.query("SELECT 1 FROM athena.users LIMIT 1");
            await lockHeld;
          }
          return { rowCount: 1, rows: [{}] };
        },
        async transaction(inner) {
          return inner(tx);
        },
      };
      return fn(tx);
    },
  };

  const migrating = withAthenaAuthMigrationLock(
    database,
    async () => "migrated"
  );
  await Promise.resolve();
  assert.equal(concurrentQueryDuringLock, true);
  releaseLock?.();
  assert.equal(await migrating, "migrated");
});

test("postgresLocalTimeoutStatements emit SET LOCAL lock and statement timeouts", () => {
  const sql = postgresLocalTimeoutStatements(15_000);
  assert.match(sql.lockTimeout, /SET LOCAL lock_timeout = '15000ms'/);
  assert.match(sql.statementTimeout, /SET LOCAL statement_timeout = '15000ms'/);
});
