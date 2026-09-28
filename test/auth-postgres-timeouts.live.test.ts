/**
 * Optional live PostgreSQL regressions for Auth query deadlines.
 * Runs only when ATHENA_PG_DIRECT_URI, ATHENA_LOCAL_RUNTIME_PG_URI, or
 * DATABASE_URL is set.
 */
import { strict as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createAuthDatabaseFromRuntime,
  type AthenaAuthDatabase,
} from "../src/auth/local/database.ts";
import {
  createPostgresPool,
  type AthenaPostgresPool,
} from "../src/postgres/driver.ts";
import { createAthenaPostgresRuntime } from "../src/postgres/owned-runtime.ts";

const LIVE_URI = (
  process.env.ATHENA_PG_DIRECT_URI ??
  process.env.ATHENA_LOCAL_RUNTIME_PG_URI ??
  process.env.DATABASE_URL ??
  ""
).trim();
const live = { skip: !LIVE_URI };
const TABLE = "public.athena_auth_timeout_795";

function isAuthTimeout(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "ATHENA_AUTH_DATABASE_TIMEOUT"
  );
}

async function withAuthDatabase(
  operation: (database: AthenaAuthDatabase, pool: AthenaPostgresPool) => Promise<void>
): Promise<void> {
  const pool = await createPostgresPool(LIVE_URI, {
    max: 1,
    min: 0,
    connectionTimeoutMillis: 1_000,
  });
  const runtime = createAthenaPostgresRuntime({
    ownership: "borrowed",
    pool,
  });
  const database = createAuthDatabaseFromRuntime(runtime, {
    operationTimeoutMs: 150,
  });
  try {
    await operation(database, pool);
  } finally {
    await runtime.close();
    await pool.end();
  }
}

test("live PG Auth: statement timeout cancels pg_sleep and recovers a one-connection pool", live, async () => {
  await withAuthDatabase(async (database) => {
    const startedAt = Date.now();
    await assert.rejects(
      () => database.query("SELECT pg_sleep(5)"),
      isAuthTimeout
    );
    assert.ok(Date.now() - startedAt < 2_000);

    const result = await database.query<{ ok: number }>("SELECT 1 AS ok");
    assert.deepEqual(result.rows, [{ ok: 1 }]);
  });
});

test("live PG Auth: timed-out transaction cannot commit a delayed mutation", live, async () => {
  await withAuthDatabase(async (database, pool) => {
    const id = randomUUID();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id uuid PRIMARY KEY,
        marker text NOT NULL
      )
    `);
    try {
      await assert.rejects(
        () =>
          database.transaction(async (transaction) => {
            await transaction.query(
              `INSERT INTO ${TABLE} (id, marker) VALUES ($1, 'before-timeout')`,
              [id]
            );
            await transaction.query("SELECT pg_sleep(5)");
          }),
        isAuthTimeout
      );

      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${TABLE} WHERE id = $1`,
        [id]
      );
      assert.deepEqual(result.rows, [{ count: "0" }]);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    }
  });
});
