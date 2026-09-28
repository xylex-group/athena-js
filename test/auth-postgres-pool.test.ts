import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ATHENA_AUTH_DATABASE_OPERATION_TIMEOUT_MS,
  ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS,
  createAuthDatabaseFromPool,
  createAuthDatabaseFromRuntime,
} from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import {
  AuthRequestTiming,
  currentAuthRequestTiming,
  runWithAuthRequestTiming,
} from "../src/auth/local/request-timing.ts";
import { withAthenaAuthMigrationLock } from "../src/auth/local/schema.ts";
import type { AthenaPostgresPool } from "../src/postgres/driver.ts";
import {
  type AthenaPostgresRuntime,
  connectPostgresPoolWithDeadline,
  createAthenaPostgresRuntime,
} from "../src/postgres/owned-runtime.ts";

function emptyResult() {
  return { rowCount: 0, rows: [] as Record<string, unknown>[] };
}

function createCountingPool(): AthenaPostgresPool & {
  connectCalls: number;
  clientQueryCalls: number;
  queryCalls: number;
} {
  const pool = {
    async connect() {
      pool.connectCalls += 1;
      return {
        async query() {
          pool.clientQueryCalls += 1;
          return emptyResult() as never;
        },
        release() { },
      };
    },
    connectCalls: 0,
    clientQueryCalls: 0,
    async end() { },
    idleCount: 1,
    async query() {
      pool.queryCalls += 1;
      return emptyResult() as never;
    },
    queryCalls: 0,
    totalCount: 1,
    waitingCount: 0,
  };
  return pool;
}

test("createAuthDatabaseFromPool uses leased clients for non-transactional reads", async () => {
  const pool = createCountingPool();
  const database = createAuthDatabaseFromPool(pool);
  assert.equal(database.inTransaction, false);
  await database.query("select 1");
  await database.query("select 2");
  assert.equal(pool.queryCalls, 0);
  assert.equal(pool.connectCalls, 2);
  assert.equal(pool.clientQueryCalls, 6);
});

test("createAuthDatabaseFromRuntime reuses runtime.query without pool.connect", async () => {
  const pool = createCountingPool();
  let queryCalls = 0;
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return {
        idleCount: pool.idleCount ?? 0,
        totalCount: pool.totalCount ?? 0,
        waitingCount: pool.waitingCount ?? 0,
      };
    },
    async query(text, values) {
      queryCalls += 1;
      return pool.query(text, values);
    },
    async transaction(fn) {
      return fn(runtime as AthenaPostgresRuntime);
    },
  };
  const database = createAuthDatabaseFromRuntime(runtime);
  await database.query("select session");
  await database.query("select user");
  assert.equal(queryCalls, 2);
  assert.equal(pool.queryCalls, 2);
  assert.equal(pool.connectCalls, 0);
  assert.equal(database.inTransaction, false);
});

test("createAuthDatabaseFromRuntime marks scoped adapters as inTransaction", async () => {
  const pool = createCountingPool();
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return {
        idleCount: pool.idleCount ?? 0,
        totalCount: pool.totalCount ?? 0,
        waitingCount: pool.waitingCount ?? 0,
      };
    },
    async query(text, values) {
      return pool.query(text, values);
    },
    async transaction(fn) {
      return fn(runtime as AthenaPostgresRuntime);
    },
  };
  const database = createAuthDatabaseFromRuntime(runtime);
  assert.equal(database.inTransaction, false);
  await database.transaction(async (tx) => {
    assert.equal(tx.inTransaction, true);
    assert.notEqual(tx, database);
  });
});

test("transaction-scoped Auth adapter construction hard-codes inTransaction true", () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/auth/local/database.ts"
    ),
    "utf8"
  );
  assert.match(
    source,
    /function createTransactionScopedAuthDatabase\([\s\S]*inTransaction:\s*true/
  );
});

test("idle pool time is recorded as sql_exec not sql_acquire", async () => {
  const pool = createCountingPool();
  const database = createAuthDatabaseFromPool(pool);
  await runWithAuthRequestTiming(async () => {
    await database.query("select 1");
    const snap = currentAuthRequestTiming()?.copy();
    assert.ok(snap);
    assert.equal(snap?.sqlCount, 1);
    assert.ok((snap?.sqlExecMs ?? 0) >= 0);
    assert.equal(snap?.sqlAcquireMs, 0);
    assert.equal(snap?.sqlPoolIdle, 1);
  });
});

test("Auth database operations time out instead of hanging", async () => {
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return { idleCount: 0, totalCount: 0, waitingCount: 0 };
    },
    query() {
      return new Promise(() => { });
    },
    async transaction() {
      throw new Error("unused");
    },
  };
  const database = createAuthDatabaseFromRuntime(runtime, {
    operationTimeoutMs: 25,
  });
  await assert.rejects(
    () => database.query("select 1"),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_TIMEOUT" &&
      error.status === 504,
  );
  assert.equal(ATHENA_AUTH_DATABASE_OPERATION_TIMEOUT_MS, 15_000);
  assert.equal(ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS, 120_000);
});

test("Auth database classifies typed PostgreSQL deadline failures", async () => {
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return { idleCount: 1, totalCount: 1, waitingCount: 0 };
    },
    async query() {
      throw {
        code: "ATHENA_POSTGRES_DEADLINE_EXCEEDED",
        phase: "statement",
      };
    },
    async transaction() {
      throw new Error("unused");
    },
  };
  const database = createAuthDatabaseFromRuntime(runtime);

  await assert.rejects(
    () => database.query("select 1"),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_TIMEOUT" &&
      error.status === 504 &&
      error.cause !== undefined
  );

  const lockError = { code: "55P03" };
  const lockTimeoutDatabase = createAuthDatabaseFromRuntime({
    async inspectPool() {
      return { idleCount: 1, totalCount: 1, waitingCount: 0 };
    },
    async query() {
      throw lockError;
    },
    async transaction() {
      throw new Error("unused");
    },
  });
  await assert.rejects(
    () => lockTimeoutDatabase.query("select 1"),
    (error: unknown) => error === lockError
  );
});

test("Auth schema migrate transaction uses the schema-migrate budget", async () => {
  const deadlines: number[] = [];
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return { idleCount: 1, totalCount: 1, waitingCount: 0 };
    },
    async query() {
      return emptyResult();
    },
    async transaction(fn, options) {
      deadlines.push(options?.deadlineMs ?? -1);
      return fn(runtime);
    },
  };
  const database = createAuthDatabaseFromRuntime(runtime, {
    operationTimeoutMs: 25,
  });
  await withAthenaAuthMigrationLock(database, async () => undefined);
  assert.equal(deadlines[0], ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS);
});

test("Server-Timing includes sql_pool saturation counters", () => {
  const timing = new AuthRequestTiming();
  timing.setSqlPool({ idleCount: 0, totalCount: 20, waitingCount: 3 });
  const header = timing.toServerTimingHeader(12);
  assert.match(header, /sql_pool;desc="total=20 idle=0 waiting=3"/);
});

test("ATHENA_AUTH_DATABASE_TIMEOUT logs acquire diagnostics when ATHENA_JS_DEBUG is on", async () => {
  const previous = process.env.ATHENA_JS_DEBUG;
  process.env.ATHENA_JS_DEBUG = "1";
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  const runtime: Pick<
    AthenaPostgresRuntime,
    "inspectPool" | "query" | "transaction"
  > = {
    async inspectPool() {
      return { idleCount: 0, totalCount: 20, waitingCount: 2 };
    },
    query() {
      return new Promise(() => { });
    },
    async transaction() {
      throw new Error("unused");
    },
  };
  const database = createAuthDatabaseFromRuntime(runtime, {
    operationTimeoutMs: 25,
  });
  try {
    await runWithAuthRequestTiming(async () => {
      currentAuthRequestTiming()?.setTraceId("tr_timeout_diag");
      currentAuthRequestTiming()?.setSqlPool({
        idleCount: 0,
        totalCount: 20,
        waitingCount: 2,
      });
      await assert.rejects(
        () => database.query("select 1"),
        (error: unknown) =>
          error instanceof AthenaAuthRuntimeError &&
          error.code === "ATHENA_AUTH_DATABASE_TIMEOUT",
      );
    });
  } finally {
    console.warn = originalWarn;
    if (previous == null) {
      delete process.env.ATHENA_JS_DEBUG;
    } else {
      process.env.ATHENA_JS_DEBUG = previous;
    }
  }
  const payload = warnings.find(
    (entry) => entry[0] === "[athena-auth] ATHENA_AUTH_DATABASE_TIMEOUT",
  );
  assert.ok(payload);
  const details = payload[1] as {
    phase: string;
    pool: { idle: number; total: number; waiting: number };
    sqlAcquireMs: number;
    sqlExecMs: number;
    traceId: string | null;
  };
  assert.equal(details.phase, "sql_acquire");
  assert.deepEqual(details.pool, { idle: 0, total: 20, waiting: 2 });
  assert.equal(typeof details.sqlAcquireMs, "number");
  assert.equal(typeof details.sqlExecMs, "number");
  assert.equal(details.traceId, "tr_timeout_diag");
});

test("pool.connect after transaction deadline is released", async () => {
  let released = 0;
  const pool: AthenaPostgresPool = {
    async connect() {
      await new Promise((resolve) => {
        setTimeout(resolve, 80);
      });
      return {
        async query() {
          return { rowCount: 0, rows: [] } as never;
        },
        release() {
          released += 1;
        },
      };
    },
    async end() { },
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
  };
  await assert.rejects(
    () => connectPostgresPoolWithDeadline(pool, 15),
    /connection timeout exceeded/,
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 120);
  });
  assert.equal(released, 1);

  const runtime = createAthenaPostgresRuntime({
    ownership: "borrowed",
    pool,
  });
  await assert.rejects(
    () =>
      runtime.transaction(async () => undefined, {
        deadlineMs: 15,
      }),
    /connection timeout exceeded/,
  );
});
