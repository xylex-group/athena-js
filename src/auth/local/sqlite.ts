import type { AthenaAuthDatabase, AthenaAuthQueryResult } from "./database.ts";
import type { AthenaAuthStores } from "./store-contract.ts";
import { SqliteAuthStores } from "./sqlite-stores.ts";
import { createAthenaAuthRuntime } from "./runtime.ts";
import type { CreateAthenaAuthRuntimeOptions } from "./runtime-types.ts";
import type {
  AthenaSqliteBindValue,
  AthenaSqliteExecutor,
  AthenaSqliteTransaction,
} from "../../sqlite-local/contracts.ts";
import {
  normalizeSqliteBindValue,
  normalizeSqliteExecutionResult,
} from "../../sqlite-local/binds.ts";

function toRows(
  result: Awaited<ReturnType<AthenaSqliteExecutor["execute"]>>,
): Record<string, unknown>[] {
  const normalized = normalizeSqliteExecutionResult(result);
  return normalized.rows.map((row) =>
    Object.fromEntries(normalized.columns.map((column, index) => [column, row[index] ?? null])),
  );
}

function createTransactionScopedSqliteAuthDatabase(
  tx: AthenaSqliteTransaction,
): AthenaAuthDatabase {
  return databaseFrom(tx.execute.bind(tx), undefined, true);
}

function databaseFrom(
  execute: AthenaSqliteExecutor["execute"],
  transaction?: (callback: (tx: AthenaSqliteTransaction) => Promise<unknown>) => Promise<unknown>,
  inTransaction = false,
): AthenaAuthDatabase {
  return {
    inTransaction,
    async query<T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
    ): Promise<AthenaAuthQueryResult<T>> {
      const result = await execute(
        text,
        values.map(normalizeSqliteBindValue) as AthenaSqliteBindValue[],
      );
      const rows = toRows(result) as T[];
      return { rowCount: rows.length, rows };
    },
    async transaction<T>(callback: (db: AthenaAuthDatabase) => Promise<T>): Promise<T> {
      if (!transaction) {
        throw new Error("SQLite Auth transactions are unavailable.");
      }
      return transaction(async (tx) =>
        callback(createTransactionScopedSqliteAuthDatabase(tx)),
      ) as Promise<T>;
    },
  };
}

/**
 * Explicit opt-in Auth persistence adapter. It is a port adapter only: local
 * data never enables Auth and Auth SQL/schema ownership remains in this module.
 */
export function createSqliteAuthDatabase(input: {
  executor: AthenaSqliteExecutor;
}): AthenaAuthDatabase {
  return databaseFrom(
    input.executor.execute,
    async (callback) =>
      input.executor.transaction(async (tx) => callback(tx)),
    false,
  );
}

export { applyAthenaAuthSqliteSchema, SqliteAuthStores } from "./sqlite-stores.ts";
export { ATHENA_AUTH_SQLITE_SCHEMA } from "./sqlite-schema.ts";

/**
 * Opt-in Auth runtime on a SQLite executor. Schema is SQLite-authored and
 * PostgreSQL Auth SQL is never applied.
 */
export async function createSqliteAuthRuntime(
  input: CreateAthenaAuthRuntimeOptions & {
    executor: AthenaSqliteExecutor;
  },
): Promise<ReturnType<typeof createAthenaAuthRuntime>> {
  const database =
    input.database != null && typeof input.database !== "string"
      ? input.database
      : createSqliteAuthDatabase({ executor: input.executor });
  const stores: AthenaAuthStores =
    input.stores ?? (await SqliteAuthStores.connect(database));
  return createAthenaAuthRuntime({
    ...input,
    database,
    stores,
  });
}
