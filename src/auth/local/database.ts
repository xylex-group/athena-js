import {
  createPostgresPool,
  type AthenaPostgresPool,
} from "../../postgres/driver.ts";
import { assertNodePostgresRuntime } from "../../postgres/runtime.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";

export interface AthenaAuthQueryResult<T = Record<string, unknown>> {
  rowCount: number;
  rows: T[];
}

export interface AthenaAuthDatabase {
  close?(): Promise<void>;
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<AthenaAuthQueryResult<T>>;
  transaction<T>(fn: (db: AthenaAuthDatabase) => Promise<T>): Promise<T>;
}

/**
 * Normalize any driver-shaped query result into the Auth database contract.
 * Never let callers hit `undefined.rows` / `undefined.length`.
 */
export function assertQueryResult<T = Record<string, unknown>>(
  value: unknown,
  context: string
): AthenaAuthQueryResult<T> {
  if (value === null || value === undefined || typeof value !== "object") {
    throw new AthenaAuthRuntimeError(
      500,
      [
        "ATHENA_AUTH_DATABASE_RESULT_INVALID",
        "",
        "Embedded Auth database adapter returned an unexpected query result.",
        "",
        `Context: ${context}`,
        "",
        "Run with:",
        "  ATHENA_JS_DEBUG=1 athena-js migrate",
      ].join("\n"),
      { code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" }
    );
  }

  const record = value as Record<string, unknown>;
  const rows = record.rows;
  if (!Array.isArray(rows)) {
    throw new AthenaAuthRuntimeError(
      500,
      [
        "ATHENA_AUTH_DATABASE_RESULT_INVALID",
        "",
        "Embedded Auth database adapter returned an invalid result while",
        `${context}: expected result.rows to be an array.`,
        "",
        "Run with:",
        "  ATHENA_JS_DEBUG=1 athena-js migrate",
      ].join("\n"),
      { code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" }
    );
  }

  const rawCount = record.rowCount;
  const rowCount =
    typeof rawCount === "number" && Number.isFinite(rawCount)
      ? rawCount
      : rows.length;

  return {
    rowCount,
    rows: rows as T[],
  };
}

function normalizeDriverResult<T>(
  result: unknown,
  context: string
): AthenaAuthQueryResult<T> {
  return assertQueryResult<T>(result, context);
}

class PoolDatabase implements AthenaAuthDatabase {
  constructor(
    private readonly pool: AthenaPostgresPool,
    private readonly ownership: "owned" | "borrowed" = "owned"
  ) {}

  async close(): Promise<void> {
    if (this.ownership === "borrowed") {
      return;
    }
    await this.pool.end();
  }

  async query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<AthenaAuthQueryResult<T>> {
    const result = await this.pool.query<T & Record<string, unknown>>(
      text,
      values
    );
    return normalizeDriverResult<T>(result, "pool.query");
  }

  async transaction<T>(
    fn: (db: AthenaAuthDatabase) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scoped: AthenaAuthDatabase = {
        query: async <TRow = Record<string, unknown>>(
          text: string,
          values?: unknown[]
        ) => {
          const result = await client.query(text, values);
          return normalizeDriverResult<TRow>(result, "transaction.query");
        },
        transaction: (inner) => inner(scoped),
      };
      const value = await fn(scoped);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function createPostgresAuthDatabase(
  connectionString: string
): Promise<AthenaAuthDatabase> {
  assertNodePostgresRuntime();
  const pool = await createPostgresPool(connectionString);
  return new PoolDatabase(pool);
}

export function createAuthDatabaseFromPool(
  pool: AthenaPostgresPool
): AthenaAuthDatabase {
  return new PoolDatabase(pool, "borrowed");
}

export const createPostgresAuthDatabaseFromPool = createAuthDatabaseFromPool;

export function createAuthDatabaseFromRuntime(runtime: {
  getPool(): Promise<AthenaPostgresPool>;
}): AthenaAuthDatabase {
  const resolve = async (): Promise<AthenaAuthDatabase> =>
    createAuthDatabaseFromPool(await runtime.getPool());

  const adapter: AthenaAuthDatabase = {
    async close() {},
    async query(text, values) {
      const result = await (await resolve()).query(text, values);
      return assertQueryResult(result, "runtime.query");
    },
    async transaction(fn) {
      return (await resolve()).transaction(fn);
    },
  };
  return adapter;
}
