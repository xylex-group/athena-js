import { ATHENA_MIGRATE_COMMAND } from "../../migrations/commands.ts";
import type { AthenaPostgresPool } from "../../postgres/driver.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "../../postgres/owned-runtime.ts";
import { assertNodePostgresRuntime } from "../../postgres/runtime.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import { currentAuthRequestTiming } from "./request-timing.ts";

export type AuthDatabaseTimeoutPhase =
  | "sql_acquire"
  | "sql_exec"
  | "transaction";

function isAuthJsDebugEnabled(): boolean {
  const value = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.ATHENA_JS_DEBUG;
  return value === "1" || value === "true";
}

function logAuthDatabaseTimeout(phase: AuthDatabaseTimeoutPhase): void {
  if (!isAuthJsDebugEnabled()) {
    return;
  }
  const timing = currentAuthRequestTiming();
  const snap = timing?.copy();
  console.warn("[athena-auth] ATHENA_AUTH_DATABASE_TIMEOUT", {
    phase,
    pool: {
      idle: snap?.sqlPoolIdle ?? 0,
      total: snap?.sqlPoolTotal ?? 0,
      waiting: snap?.sqlPoolWaiting ?? 0,
    },
    sqlAcquireMs: snap?.sqlAcquireMs ?? 0,
    sqlExecMs: snap?.sqlExecMs ?? 0,
    traceId: timing?.traceId() ?? null,
  });
}

export const ATHENA_AUTH_DATABASE_OPERATION_TIMEOUT_MS = 15_000;

/** Wall-clock budget for Embedded Auth schema migrate/repair (one locked transaction). */
export const ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS = 120_000;

export type AthenaAuthTransactionOptions = {
  operationTimeoutMs?: number;
};

export function postgresLocalTimeoutStatements(timeoutMs: number): {
  lockTimeout: string;
  statementTimeout: string;
} {
  const value = `${Math.max(1, Math.trunc(timeoutMs))}ms`;
  return {
    lockTimeout: `SET LOCAL lock_timeout = '${value}'`,
    statementTimeout: `SET LOCAL statement_timeout = '${value}'`,
  };
}

export interface AthenaAuthQueryResult<T = Record<string, unknown>> {
  rowCount: number;
  rows: T[];
}

export interface AthenaAuthDatabase {
  close?(): Promise<void>;
  /** True while this adapter is bound to an open SQL transaction. */
  readonly inTransaction: boolean;
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<AthenaAuthQueryResult<T>>;
  transaction<T>(
    fn: (db: AthenaAuthDatabase) => Promise<T>,
    options?: AthenaAuthTransactionOptions,
  ): Promise<T>;
}

export function authDatabaseInTransaction(db: AthenaAuthDatabase): boolean {
  return db.inTransaction === true;
}

/**
 * Normalize any driver-shaped query result into the Auth database contract.
 * Never let callers hit `undefined.rows` / `undefined.length`.
 */
export function assertQueryResult<T = Record<string, unknown>>(
  value: unknown,
  context: string,
): AthenaAuthQueryResult<T> {
  if (Array.isArray(value)) {
    return {
      rowCount: value.length,
      rows: value as T[],
    };
  }

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
        `  ATHENA_JS_DEBUG=1 ${ATHENA_MIGRATE_COMMAND}`,
      ].join("\n"),
      { code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" },
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
        `  ATHENA_JS_DEBUG=1 ${ATHENA_MIGRATE_COMMAND}`,
      ].join("\n"),
      { code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" },
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

function isDatabaseTimeoutError(
  error: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    error instanceof AthenaAuthRuntimeError &&
    error.code === "ATHENA_AUTH_DATABASE_TIMEOUT"
  ) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  if (seen.has(error)) {
    return false;
  }
  seen.add(error);
  const record = error as {
    cause?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  if (
    record.code === "ATHENA_AUTH_DATABASE_TIMEOUT" ||
    record.code === "ATHENA_POSTGRES_DEADLINE_EXCEEDED" ||
    record.code === "ETIMEDOUT" ||
    record.code === "57014"
  ) {
    return true;
  }
  if (record.name === "PostgresDeadlineExceededError") {
    return true;
  }
  if (
    record.cause !== undefined &&
    isDatabaseTimeoutError(record.cause, seen)
  ) {
    return true;
  }
  return (
    typeof record.message === "string" &&
    /timeout exceeded|query_timeout|statement timeout|connection timeout/i.test(
      record.message,
    )
  );
}

export function authDatabaseTimeoutError(
  cause?: unknown,
): AthenaAuthRuntimeError {
  return new AthenaAuthRuntimeError(
    504,
    [
      "ATHENA_AUTH_DATABASE_TIMEOUT",
      "",
      "Embedded Auth could not complete a database operation before the timeout.",
    ].join("\n"),
    { cause, code: "ATHENA_AUTH_DATABASE_TIMEOUT" },
  );
}

async function withAuthDatabaseTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  phase: AuthDatabaseTimeoutPhase,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation().then(
        (value) => value,
        (error: unknown) => {
          if (isDatabaseTimeoutError(error)) {
            logAuthDatabaseTimeout(phase);
            throw authDatabaseTimeoutError(error);
          }
          throw error;
        },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          logAuthDatabaseTimeout(phase);
          reject(authDatabaseTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function recordSqlTiming(idleCount: number, elapsedMs: number): void {
  const timing = currentAuthRequestTiming();
  if (!timing) {
    return;
  }
  if (idleCount <= 0) {
    timing.addSqlAcquire(elapsedMs);
  } else {
    timing.addSqlExec(elapsedMs);
  }
  timing.addSqlCount(1);
}

export async function createAthenaAuthDatabase(input: {
  connectionString?: string;
  postgresRuntime?: AthenaPostgresRuntime;
}): Promise<AthenaAuthDatabase> {
  if (input.postgresRuntime) {
    return createAuthDatabaseFromRuntime(input.postgresRuntime);
  }
  const connectionString = input.connectionString?.trim();
  if (!connectionString) {
    throw new AthenaAuthRuntimeError(
      500,
      "createAthenaAuthDatabase requires postgresRuntime or connectionString.",
      { code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" },
    );
  }
  assertNodePostgresRuntime();
  const runtime = createAthenaPostgresRuntime({
    connectionString,
  });
  const adapter = createAuthDatabaseFromRuntime(runtime);
  return {
    async close() {
      await runtime.close();
    },
    inTransaction: false,
    query: adapter.query,
    transaction: adapter.transaction,
  };
}

export async function createPostgresAuthDatabase(
  connectionString: string,
): Promise<AthenaAuthDatabase> {
  return createAthenaAuthDatabase({ connectionString });
}

export function createAuthDatabaseFromPool(
  pool: AthenaPostgresPool,
): AthenaAuthDatabase {
  return createAuthDatabaseFromRuntime(
    createAthenaPostgresRuntime({
      ownership: "borrowed",
      pool,
    }),
  );
}

export const createPostgresAuthDatabaseFromPool = createAuthDatabaseFromPool;

export function createAuthDatabaseFromRuntime(
  runtime: Pick<AthenaPostgresRuntime, "inspectPool" | "query" | "transaction">,
  options?: { operationTimeoutMs?: number },
): AthenaAuthDatabase {
  return createAuthDatabaseAdapter(runtime, {
    inTransaction: false,
    operationTimeoutMs: options?.operationTimeoutMs,
  });
}

function createAuthDatabaseAdapter(
  runtime: Pick<AthenaPostgresRuntime, "inspectPool" | "query" | "transaction">,
  options: { inTransaction: boolean; operationTimeoutMs?: number },
): AthenaAuthDatabase {
  const timeoutMs =
    options.operationTimeoutMs ?? ATHENA_AUTH_DATABASE_OPERATION_TIMEOUT_MS;

  const adapter: AthenaAuthDatabase = {
    async close() { },
    inTransaction: options.inTransaction,
    async query(text, values) {
      const stats = await runtime.inspectPool();
      currentAuthRequestTiming()?.setSqlPool(stats);
      return withAuthDatabaseTimeout(
        async () => {
          const started = performance.now();
          const result = await runtime.query(text, values, {
            deadlineMs: timeoutMs,
            workload: "auth",
          });
          recordSqlTiming(stats.idleCount, performance.now() - started);
          return assertQueryResult(result, "runtime.query");
        },
        timeoutMs,
        stats.idleCount <= 0 ? "sql_acquire" : "sql_exec",
      );
    },
    async transaction(fn, transactionOptions) {
      const transactionTimeoutMs =
        transactionOptions?.operationTimeoutMs ?? timeoutMs;
      return withAuthDatabaseTimeout(
        () =>
          runtime.transaction(
            async (tx) => {
              const scoped = createTransactionScopedAuthDatabase(
                tx,
                transactionTimeoutMs,
              );
              const timeouts =
                postgresLocalTimeoutStatements(transactionTimeoutMs);
              await scoped.query(timeouts.lockTimeout);
              await scoped.query(timeouts.statementTimeout);
              return fn(scoped);
            },
            { deadlineMs: transactionTimeoutMs, workload: "auth" },
          ),
        transactionTimeoutMs,
        "transaction",
      );
    },
  };
  return adapter;
}

function createTransactionScopedAuthDatabase(
  runtime: Pick<AthenaPostgresRuntime, "inspectPool" | "query" | "transaction">,
  operationTimeoutMs: number,
): AthenaAuthDatabase {
  return createAuthDatabaseAdapter(runtime, {
    inTransaction: true,
    operationTimeoutMs,
  });
}
