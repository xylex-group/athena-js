import type { AthenaGatewayClient } from "../gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
import { isAthenaSelectQueryAst } from "../query/engine/ast.ts";
import { AthenaTransactionError } from "../db/transaction/errors.ts";
import type {
  AthenaInteractiveTransactionTransport,
  AthenaResolvedTransactionOptions,
  AthenaTransactionCapabilities,
  AthenaTransactionOperation,
  AthenaTransactionTransport,
} from "../db/transaction/types.ts";
import { SQLITE_LOCAL_TRANSACTION_CAPABILITIES } from "../db/transaction/types.ts";
import type {
  AthenaSqliteBindValue,
  AthenaSqliteExecutor,
  AthenaSqliteExecutionOptions,
  AthenaSqliteExecutionResult,
  AthenaSqliteStorageValue,
  AthenaSqliteTransaction,
} from "./contracts.ts";
import { athenaErrorResult } from "../runtime/error/index.ts";
import {
  normalizeSqliteBindValue,
  normalizeSqliteExecutionResult,
} from "./binds.ts";
import {
  assertCompiledQueryV1,
  compiledQueryParamToBind,
  type AthenaCanonicalQueryCompiler,
  type AthenaCompiledQuery,
} from "./compiler.ts";
import { projectSqliteOperationToQueryV1 } from "./compatibility.ts";
import { normalizeSqliteError, SqliteLocalError } from "./errors.ts";

export function sqliteLocalTransactionCapabilities(
  executor: AthenaSqliteExecutor,
  compiler?: AthenaCanonicalQueryCompiler,
): AthenaTransactionCapabilities {
  const structured = Boolean(compiler);
  const mode = executor.capabilities.transactions;
  if (structured && mode === "interactive") {
    return SQLITE_LOCAL_TRANSACTION_CAPABILITIES;
  }
  return {
    atomic: structured && mode !== "none",
    backend: "sqlite-local",
    deferrable: false,
    interactive: false,
    isolationLevels: [],
    readOnly: false,
    savepoints: false,
  };
}

function rejectUnsupportedTransactionOptions(
  options?: AthenaResolvedTransactionOptions,
): void {
  if (options?.isolationLevel) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      "SQLite Local does not advertise PostgreSQL isolation levels.",
    );
  }
  if (options?.deferrable) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      "SQLite Local does not support deferrable transactions.",
    );
  }
  if (options?.readOnly) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      "SQLite Local does not expose a read-only transaction API.",
    );
  }
}

const SQLITE_LOCAL_BASE_URL = "sqlite://local";
const COMPILER_REQUIRED_MESSAGE =
  "SQLite Local structured CRUD requires an injected AthenaCanonicalQueryCompiler backed by athena-query.";

type Sql = { sql: string; parameters: AthenaSqliteBindValue[] };

function rowsAsObjects(result: AthenaSqliteExecutionResult): Record<string, AthenaSqliteStorageValue>[] {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null])),
  );
}

function responseData(
  result: AthenaSqliteExecutionResult,
): Record<string, AthenaSqliteStorageValue>[] | Record<string, AthenaSqliteStorageValue> {
  return rowsAsObjects(result);
}

function success<T>(result: AthenaSqliteExecutionResult, data: T): AthenaGatewayResponse<T> {
  const rows = rowsAsObjects(result);
  return {
    affectedRows: result.changes,
    count: rows.length || result.changes || 0,
    data,
    errorDetails: null,
    ok: true,
    raw: { columns: result.columns, rows: result.rows, changes: result.changes },
    status: 200,
    statusText: "OK",
  };
}

function failure<T>(
  input?: unknown,
  fallbackMessage?: string,
): AthenaGatewayResponse<T> {
  const normalized = normalizeSqliteError(
    input ?? new Error(fallbackMessage ?? "SQLite Local operation failed"),
  );
  const canonical = normalized.canonical
    ? athenaErrorResult(normalized)
    : undefined;
  const details = {
    ...normalized.toDetails(),
    ...(fallbackMessage ? { message: fallbackMessage } : {}),
  };
  return {
    data: null,
    error: canonical?.error.message ?? details.message,
    errorDetails: details as unknown as AthenaGatewayResponse<T>["errorDetails"],
    ok: false,
    raw: canonical
      ? {
          error: {
            ...canonical.error,
            kind: normalized.error.kind,
            retry: normalized.error.retry,
          },
        }
      : null,
    status: canonical?.status ?? normalized.status,
    statusText:
      normalized.status === 503
        ? "Service Unavailable"
        : normalized.status === 499
          ? "Client Closed Request"
          : "Internal Server Error",
  };
}

function executionOptions(options?: AthenaGatewayCallOptions): AthenaSqliteExecutionOptions | undefined {
  if (!options?.signal && !("deadlineMs" in (options ?? {}))) {
    return undefined;
  }
  return {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(typeof (options as { deadlineMs?: unknown } | undefined)?.deadlineMs === "number"
      ? { deadlineMs: (options as { deadlineMs: number }).deadlineMs }
      : {}),
  };
}

function assertCancellationSupported(
  executor: AthenaSqliteExecutor,
  options?: AthenaSqliteExecutionOptions,
): void {
  if ((options?.signal || options?.deadlineMs !== undefined) && !executor.capabilities.interrupt) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
      "SQLite Local cannot honor cancellation or deadlines with this executor.",
    );
  }
}

async function run(
  executor: AthenaSqliteExecutor,
  sql: Sql,
  options?: AthenaGatewayCallOptions,
  transaction?: AthenaSqliteTransaction,
): Promise<AthenaSqliteExecutionResult> {
  const resolved = executionOptions(options);
  assertCancellationSupported(executor, resolved);
  const execute = transaction?.execute ?? executor.execute.bind(executor);
  return normalizeSqliteExecutionResult(
    await execute(sql.sql, sql.parameters, resolved),
  );
}

function compiledToSql(compiled: AthenaCompiledQuery): Sql {
  return {
    sql: compiled.sql,
    parameters: compiled.params.map(compiledQueryParamToBind).map(normalizeSqliteBindValue),
  };
}

async function compileStructured(
  compiler: AthenaCanonicalQueryCompiler | undefined,
  returning: boolean,
  operation:
    | { kind: "fetch"; payload: AthenaFetchPayload }
    | { kind: "insert"; payload: AthenaInsertPayload }
    | { kind: "update"; payload: AthenaUpdatePayload }
    | { kind: "delete"; payload: AthenaDeletePayload },
): Promise<AthenaCompiledQuery | AthenaGatewayResponse<never>> {
  if (!compiler) {
    return failure(
      new SqliteLocalError("unsupported", undefined, false),
      COMPILER_REQUIRED_MESSAGE,
    );
  }
  try {
    const request = projectSqliteOperationToQueryV1(operation, {
      returning,
    });
    const compiled = assertCompiledQueryV1(
      await compiler.compile(request, "sqlite-local"),
    );
    if (compiled.backend_profile !== "sqlite_local") {
      return failure(
        new SqliteLocalError("unsupported", undefined, false),
        "compiled query backend_profile must be sqlite_local",
      );
    }
    return compiled;
  } catch (error) {
    return failure(error);
  }
}

export function createSqliteLocalTransport(
  executor: AthenaSqliteExecutor,
  compiler?: AthenaCanonicalQueryCompiler,
): AthenaGatewayClient {
  const capabilities = sqliteLocalTransactionCapabilities(executor, compiler);

  const runCompiled = async <T>(
    operation:
      | { kind: "fetch"; payload: AthenaFetchPayload }
      | { kind: "insert"; payload: AthenaInsertPayload }
      | { kind: "update"; payload: AthenaUpdatePayload }
      | { kind: "delete"; payload: AthenaDeletePayload },
    options?: AthenaGatewayCallOptions,
    transaction?: AthenaSqliteTransaction,
  ): Promise<AthenaGatewayResponse<T>> => {
    const compiled = await compileStructured(
      compiler,
      executor.capabilities.returning,
      operation,
    );
    if ("ok" in compiled) {
      return compiled as AthenaGatewayResponse<T>;
    }
    try {
      const result = await run(executor, compiledToSql(compiled), options, transaction);
      return success(result, responseData(result) as T);
    } catch (error) {
      if (error instanceof AthenaTransactionError) {
        throw error;
      }
      return failure(error);
    }
  };

  const callOptionsFromResolved = (
    options?: AthenaResolvedTransactionOptions,
  ): AthenaGatewayCallOptions | undefined =>
    options?.callOptions ??
    (options?.signal || options?.timeoutMs !== undefined
      ? {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.timeoutMs !== undefined
            ? { deadlineMs: Date.now() + options.timeoutMs }
            : {}),
        }
      : undefined);

  const executeOnTransaction = async (
    operation: AthenaTransactionOperation,
    sqliteTransaction: AthenaSqliteTransaction,
    options?: AthenaResolvedTransactionOptions,
  ): Promise<AthenaGatewayResponse<unknown>> =>
    runCompiled(
      operation as
        | { kind: "fetch"; payload: AthenaFetchPayload }
        | { kind: "insert"; payload: AthenaInsertPayload }
        | { kind: "update"; payload: AthenaUpdatePayload }
        | { kind: "delete"; payload: AthenaDeletePayload },
      callOptionsFromResolved(options),
      sqliteTransaction,
    );

  const transactionTransport: AthenaTransactionTransport = {
    capabilities,
    async executeAtomic(operations, options) {
      if (!capabilities.atomic) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_ATOMIC_UNSUPPORTED",
          "SQLite Local structured transactions require an injected compiler and a transactional host executor.",
        );
      }
      rejectUnsupportedTransactionOptions(options);
      return executor.transaction(async (sqliteTransaction) => {
        const results: AthenaGatewayResponse<unknown>[] = [];
        for (const operation of operations) {
          const result = await executeOnTransaction(
            operation,
            sqliteTransaction,
            options,
          );
          if (!result.ok) {
            throw new AthenaTransactionError(
              "ATHENA_TRANSACTION_FAILED",
              result.error ?? "SQLite Local atomic operation failed",
            );
          }
          results.push(result);
        }
        return { committed: true, results };
      });
    },
    async beginInteractive(options) {
      if (!capabilities.interactive) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_INTERACTIVE_UNSUPPORTED",
          "SQLite Local interactive transactions require an injected compiler and an interactive host executor.",
        );
      }
      rejectUnsupportedTransactionOptions(options);
      let settle: (error?: unknown) => void = () => undefined;
      const hold = new Promise<void>((resolve, reject) => {
        settle = (error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        };
      });
      let sqliteTransaction: AthenaSqliteTransaction | undefined;
      let readyResolve: (tx: AthenaSqliteTransaction) => void = () => undefined;
      const ready = new Promise<AthenaSqliteTransaction>((resolve) => {
        readyResolve = resolve;
      });
      const session = executor.transaction(async (tx) => {
        sqliteTransaction = tx;
        readyResolve(tx);
        await hold;
      });
      await ready;
      const interactive: AthenaInteractiveTransactionTransport = {
        async commit() {
          settle();
          await session;
        },
        async execute(operation) {
          const current = sqliteTransaction;
          if (!current) {
            throw new AthenaTransactionError(
              "ATHENA_TRANSACTION_ABORTED",
              "SQLite Local interactive transaction is no longer active.",
            );
          }
          return executeOnTransaction(operation, current, options);
        },
        async rollback() {
          settle(new AthenaTransactionError(
            "ATHENA_TRANSACTION_ABORTED",
            "SQLite Local interactive transaction rolled back.",
          ));
          await session.catch(() => undefined);
        },
      };
      return interactive;
    },
  };

  return {
    baseUrl: SQLITE_LOCAL_BASE_URL,
    buildHeaders: () => ({}),
    deleteGateway: async (payload, options) =>
      runCompiled({ kind: "delete", payload }, options),
    fetchGateway: async (payload, options) => {
      if (isAthenaSelectQueryAst(payload)) {
        return failure(
          new SqliteLocalError("unsupported", undefined, false),
          "SQLite Local AST fetch is unavailable.",
        );
      }
      return runCompiled(
        { kind: "fetch", payload: payload as AthenaFetchPayload },
        options,
      );
    },
    insertGateway: async (payload, options) =>
      runCompiled({ kind: "insert", payload }, options),
    queryGateway: async <T>(
      payload: AthenaQueryPayload,
      options?: AthenaGatewayCallOptions,
    ) => {
      try {
        const result = await run(executor, {
          parameters: (payload.params ?? []).map(normalizeSqliteBindValue),
          sql: payload.query,
        }, options);
        return success(result, responseData(result) as T);
      } catch (error) {
        if (error instanceof AthenaTransactionError) {
          throw error;
        }
        return failure(error);
      }
    },
    resolveCallOptions: async (options) => options,
    rpcGateway: async () =>
      failure(undefined, "SQLite Local RPC is unavailable."),
    transactions: transactionTransport,
    updateGateway: async (payload, options) =>
      runCompiled({ kind: "update", payload }, options),
    verifyConnection: async (): Promise<AthenaGatewayConnectionResult> => {
      try {
        const result = await run(executor, { parameters: [], sql: "SELECT 1" });
        return {
          baseUrl: SQLITE_LOCAL_BASE_URL,
          error: undefined,
          errorDetails: null,
          ok: true,
          raw: {
            columns: result.columns,
            rows: result.rows,
            changes: result.changes,
          },
          reachable: true,
          status: 200,
          statusText: "OK",
          url: SQLITE_LOCAL_BASE_URL,
        };
      } catch (error) {
        const normalized = normalizeSqliteError(error);
        const details = normalized.toDetails();
        const canonical = normalized.canonical
          ? athenaErrorResult(normalized)
          : undefined;
        return {
          baseUrl: SQLITE_LOCAL_BASE_URL,
          error: canonical?.error.message ?? details.message,
          errorDetails: details as unknown as AthenaGatewayConnectionResult["errorDetails"],
          ok: false,
          raw: canonical
            ? {
                error: {
                  ...canonical.error,
                  kind: normalized.error.kind,
                  retry: normalized.error.retry,
                },
              }
            : null,
          reachable: false,
          status: canonical?.status ?? normalized.status,
          statusText:
            normalized.status === 503
              ? "Service Unavailable"
              : canonical?.status === 499
                ? "Client Closed Request"
                : "Internal Server Error",
          url: SQLITE_LOCAL_BASE_URL,
        };
      }
    },
  };
}
