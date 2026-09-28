import { AthenaConfigurationError } from "../config/errors.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import { AthenaGatewayError } from "../gateway/errors.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
import {
  AthenaQueryError,
  type AthenaSelectQueryAst,
  type AthenaRelationCatalog,
} from "../query/engine/index.ts";
import { resolveMutationAffectedRows } from "../result/mutation-meta.ts";
import {
  keepNullKeysFromFindManySelect,
  maybeStripNullRows,
} from "../result/strip-null-properties.ts";
import {
  compilePostgresStructuredCount,
  compilePostgresStructuredFetch,
  needsPostgresAstPipeline,
} from "./compile-fetch.ts";
import { ATHENA_PG_DIRECT_BASE_URL } from "./constants.ts";
import {
  ATHENA_POSTGRES_POOL_DEFAULTS,
  type AthenaPostgresPool,
  type QueryResult,
  type QueryResultRow,
} from "./driver.ts";
import { mapPostgresDriverError, sanitizePostgresMessage } from "./errors.ts";
import {
  createPostgresIdentityCache,
  needsBoundedIdentity,
  resolvePostgresBoundedIdentityColumn,
} from "./identity.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "./owned-runtime.ts";
import { PostgresDeadline } from "./pool/deadline.ts";
import type { PostgresPoolManager } from "./pool/manager.ts";
import { assertNodePostgresRuntime } from "./runtime.ts";
import {
  compilePostgresCount,
  compilePostgresDelete,
  compilePostgresFetch,
  compilePostgresInsert,
  compilePostgresRpc,
  compilePostgresUpdate,
  extractAthenaCount,
  type PostgresCompiledQuery,
  type PostgresCompileOptions,
  PostgresSqlCompileError,
} from "./sql.ts";
import { createPostgresTransactionTransport } from "./transaction.ts";

/** Mirrors gateway client accept shape for findMany AST payloads. */
interface AthenaFindManyAstPayload {
  limit?: number;
  orderBy?: Record<string, unknown>;
  select: Record<string, unknown>;
  table_name: string;
  where?: Record<string, unknown>;
}

export interface PostgresDirectTransportOptions {
  connectionString?: string;
  /**
   * Optional default unique identity column for bounded mutations.
   * Prefer schema-resolved PK; never invent `id` at the compiler.
   */
  defaultIdentityColumn?: string;
  /** When false, dispose never ends the supplied pool. Default: true for URI-created pools. */
  ownsPool?: boolean;
  pool?: AthenaPostgresPool;
  /** Priority-1 relation metadata from AthenaModels. */
  relationCatalog?: AthenaRelationCatalog;
  runtime?: AthenaPostgresRuntime;
}

function resolveStripNulls(
  payloadStrip: boolean | undefined,
  callOptions: AthenaGatewayCallOptions | undefined,
  defaultValue: boolean
): boolean {
  if (typeof payloadStrip === "boolean") {
    return payloadStrip;
  }
  if (typeof callOptions?.stripNulls === "boolean") {
    return callOptions.stripNulls;
  }
  return defaultValue;
}

function successResponse<T>(
  data: T,
  count: number | null | undefined,
  raw: unknown,
  endpoint?: string
): AthenaGatewayResponse<T> {
  const affectedRows = resolveMutationAffectedRows({
    count,
    endpoint,
    raw,
  });
  return {
    ...(affectedRows === undefined ? {} : { affectedRows }),
    count: count ?? null,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw,
    status: 200,
    statusText: "OK",
  };
}

function errorResponse<T>(
  status: number,
  code:
    | "HTTP_ERROR"
    | "UNKNOWN_ERROR"
    | "INVALID_JSON"
    | "NETWORK_ERROR"
    | "INVALID_URL",
  message: string,
  endpoint: string,
  method: string,
  hint?: string
): AthenaGatewayResponse<T> {
  const error = new AthenaGatewayError({
    code,
    endpoint: endpoint as never,
    hint,
    message,
    method: method as never,
    status,
  });
  return {
    data: null,
    error: error.message,
    errorDetails: error.toDetails(),
    ok: false,
    raw: { code, error: message },
    status,
    statusText: null,
  };
}

function compileErrorResponse<T>(
  error: unknown,
  endpoint: string,
  method: string
): AthenaGatewayResponse<T> {
  if (error instanceof PostgresSqlCompileError) {
    return errorResponse(
      400,
      "HTTP_ERROR",
      error.message,
      endpoint,
      method,
      `PostgreSQL SQL compile failed (${error.code})`
    );
  }
  if (error instanceof AthenaQueryError) {
    return errorResponse(
      400,
      "HTTP_ERROR",
      error.message,
      endpoint,
      method,
      `Athena query compile failed (${error.code})`
    );
  }
  return mapDriverError(error, endpoint, method);
}

function mapDriverError<T>(
  error: unknown,
  endpoint: string,
  method: string
): AthenaGatewayResponse<T> {
  const mapped = mapPostgresDriverError(error);
  return errorResponse(
    mapped.status,
    mapped.code,
    mapped.message,
    endpoint,
    method,
    mapped.hint
  );
}

/**
 * Gateway-shaped transport that executes against a long-lived Node `pg.Pool`.
 */
export function createPostgresDirectTransport(
  options: PostgresDirectTransportOptions
): AthenaGatewayClient {
  const connectionString = options.connectionString?.trim();
  if (!(options.runtime || options.pool || connectionString)) {
    throw new Error(
      "@xylex-group/athena: db.pgUri must be a non-empty PostgreSQL connection string."
    );
  }

  assertNodePostgresRuntime();

  const ownsPool =
    options.ownsPool ??
    Boolean(connectionString && !options.runtime && !options.pool);

  const ownsRuntime = !options.runtime;
  const runtime =
    options.runtime ??
    createAthenaPostgresRuntime(
      options.pool
        ? {
            ownership: ownsPool ? "owned" : "borrowed",
            pool: options.pool,
          }
        : { connectionString: connectionString as string }
    );
  let disposed = false;

  const attachPoolErrorHandler = (
    pool: AthenaPostgresPool
  ): AthenaPostgresPool => {
    const maybeOn = pool as AthenaPostgresPool & {
      on?: (event: string, listener: (err: Error) => void) => void;
    };
    if (typeof maybeOn.on === "function") {
      maybeOn.on("error", () => {
        // Surface on next query via pool state; do not throw unbound.
      });
    }
    return pool;
  };

  let poolErrorHandlerAttached = false;
  const getPoolManager = (): Promise<PostgresPoolManager> => {
    if (disposed) {
      return Promise.reject(
        new AthenaConfigurationError(
          "ATHENA_RUNTIME_DISPOSED",
          "Athena PostgreSQL runtime was disposed.",
          "db"
        )
      );
    }
    assertNodePostgresRuntime();
    return runtime.getPoolManager().then(async (manager) => {
      if (!poolErrorHandlerAttached) {
        attachPoolErrorHandler(await manager.getPool());
        poolErrorHandlerAttached = true;
      }
      return manager;
    });
  };

  const managedQuery = <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
    workload: "query" | "introspection" = "query"
  ): Promise<QueryResult<T>> =>
    getPoolManager().then((manager) =>
      manager.query(
        {
          deadline: PostgresDeadline.after(
            ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
          ),
          target: "pooled",
          workload,
        },
        text,
        values
      )
    );

  const managedQueryable = {
    query: <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ) => managedQuery<T>(text, values, "introspection"),
  };

  const baseUrl = ATHENA_PG_DIRECT_BASE_URL;
  const defaultIdentity = options.defaultIdentityColumn?.trim();
  const identityCache = createPostgresIdentityCache();

  async function compileOptionsForBoundedMutation(payload: {
    table_name?: string;
    limit?: number;
    offset?: number;
    current_page?: number;
    page_size?: number;
    sort_by?: unknown;
  }): Promise<PostgresCompileOptions | undefined> {
    if (!needsBoundedIdentity(payload)) {
      return;
    }
    // Compiler still raises order_without_bounds when sort_by alone.
    const hasPage =
      payload.limit !== undefined ||
      payload.offset !== undefined ||
      payload.page_size !== undefined ||
      payload.current_page !== undefined;
    if (!hasPage) {
      return;
    }
    if (defaultIdentity) {
      return { identityColumn: defaultIdentity };
    }
    const identityColumn = await resolvePostgresBoundedIdentityColumn(
      managedQueryable,
      payload.table_name ?? "",
      identityCache
    );
    return { identityColumn };
  }

  async function runCompiled<T>(
    compiled: PostgresCompiledQuery,
    endpoint: string,
    method: string,
    mapResult?: (
      rows: unknown[],
      rowCount: number
    ) => { data: T; count: number | null },
    stripNulls = true,
    keepNullKeys?: ReadonlySet<string>
  ): Promise<AthenaGatewayResponse<T>> {
    try {
      const result = await managedQuery(compiled.text, compiled.values);
      const rows = maybeStripNullRows(
        result.rows as unknown[],
        stripNulls,
        keepNullKeys
      );
      const rowCount =
        typeof result.rowCount === "number" ? result.rowCount : rows.length;

      const mapped = mapResult?.(rows, rowCount) ?? {
        count: rowCount,
        data: rows as T,
      };
      return successResponse(mapped.data, mapped.count, result, endpoint);
    } catch (error) {
      if (error instanceof PostgresSqlCompileError) {
        return compileErrorResponse(error, endpoint, method);
      }
      return mapDriverError(error, endpoint, method);
    }
  }

  const transport: AthenaGatewayClient & {
    __athenaPgDispose?: () => Promise<void>;
  } = {
    async __athenaPgDispose() {
      disposed = true;
      if (!ownsRuntime) {
        return;
      }
      await runtime.close();
    },
    baseUrl,
    buildHeaders(callOptions) {
      return { ...(callOptions?.headers ?? {}) };
    },
    async deleteGateway<T>(
      payload: AthenaDeletePayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const compileOptions = await compileOptionsForBoundedMutation(payload);
        const compiled = compilePostgresDelete(payload, compileOptions);
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        return runCompiled(
          compiled,
          "/gateway/delete",
          "DELETE",
          undefined,
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/delete", "DELETE");
      }
    },
    async fetchGateway<T>(
      payload:
        | AthenaFetchPayload
        | AthenaFindManyAstPayload
        | AthenaSelectQueryAst,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        if (callOptions?.signal?.aborted) {
          throw new Error("The operation was aborted.");
        }
        const fetchPayload = payload as AthenaFetchPayload;
        const compiled = needsPostgresAstPipeline(payload)
          ? await compilePostgresStructuredFetch(payload, managedQueryable, {
              catalog: options.relationCatalog,
            })
          : compilePostgresFetch(fetchPayload);
        const stripNulls = resolveStripNulls(
          fetchPayload.strip_nulls,
          callOptions,
          true
        );
        const keepNullKeys = keepNullKeysFromFindManySelect(payload);

        if (fetchPayload.head === true) {
          return runCompiled(
            compiled,
            "/gateway/fetch",
            "POST",
            (rows) => ({ count: extractAthenaCount(rows), data: [] as T }),
            false
          );
        }

        const wantsTotalCount =
          fetchPayload.count === "exact" ||
          fetchPayload.count === "planned" ||
          fetchPayload.count === "estimated";

        if (wantsTotalCount) {
          const countCompiled = needsPostgresAstPipeline(payload)
            ? await compilePostgresStructuredCount(payload, managedQueryable, {
                catalog: options.relationCatalog,
              })
            : compilePostgresCount(fetchPayload);
          try {
            const [dataResult, countResult] = await Promise.all([
              managedQuery(compiled.text, compiled.values),
              managedQuery(countCompiled.text, countCompiled.values),
            ]);
            const rows = maybeStripNullRows(
              dataResult.rows as unknown[],
              stripNulls,
              keepNullKeys
            );
            const total = extractAthenaCount(countResult.rows as unknown[]);
            return successResponse(
              rows as T,
              total,
              {
                count: countResult,
                data: dataResult,
              },
              "/gateway/fetch"
            );
          } catch (error) {
            return mapDriverError(error, "/gateway/fetch", "POST");
          }
        }

        return runCompiled(
          compiled,
          "/gateway/fetch",
          "POST",
          (rows) => ({ count: rows.length, data: rows as T }),
          stripNulls,
          keepNullKeys
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/fetch", "POST");
      }
    },
    async insertGateway<T>(
      payload: AthenaInsertPayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const compiled = compilePostgresInsert(payload);
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        return runCompiled(
          compiled,
          "/gateway/insert",
          "PUT",
          (rows, rowCount) => {
            if (!Array.isArray(payload.insert_body) && rows.length === 1) {
              return { count: rowCount, data: rows[0] as T };
            }
            return { count: rowCount, data: rows as T };
          },
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/insert", "PUT");
      }
    },
    async queryGateway<T>(
      payload: AthenaQueryPayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const text = payload.query?.trim();
        if (!text) {
          return errorResponse(
            400,
            "HTTP_ERROR",
            "query is required",
            "/gateway/query",
            "POST"
          );
        }
        const values = Array.isArray(payload.params) ? payload.params : [];
        return runCompiled(
          { text, values },
          "/gateway/query",
          "POST",
          (rows, rowCount) => ({ count: rowCount, data: rows as T }),
          resolveStripNulls(undefined, callOptions, false)
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/query", "POST");
      }
    },
    async resolveCallOptions(callOptions) {
      return callOptions;
    },
    async rpcGateway<T>(
      payload: AthenaRpcPayload,
      callOptions?: AthenaRpcCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        if (callOptions?.signal?.aborted) {
          throw new Error("The operation was aborted.");
        }
        const compiled = compilePostgresRpc(payload);
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        if (payload.head === true) {
          return runCompiled(
            compiled,
            "/gateway/rpc",
            "POST",
            (rows) => ({ count: extractAthenaCount(rows), data: [] as T }),
            false
          );
        }
        const wantsCount =
          payload.count === "exact" ||
          payload.count === "planned" ||
          payload.count === "estimated";
        if (wantsCount) {
          const countCompiled = compilePostgresRpc({
            ...payload,
            head: true,
          });
          const [dataResult, countResult] = await Promise.all([
            managedQuery(compiled.text, compiled.values),
            managedQuery(countCompiled.text, countCompiled.values),
          ]);
          const rows = maybeStripNullRows(
            dataResult.rows as unknown[],
            stripNulls
          );
          const total = extractAthenaCount(countResult.rows as unknown[]);
          return successResponse(
            rows as T,
            total,
            {
              count: countResult,
              data: dataResult,
            },
            "/gateway/rpc"
          );
        }
        return runCompiled(
          compiled,
          "/gateway/rpc",
          "POST",
          (rows, rowCount) => ({ count: rowCount, data: rows as T }),
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/rpc", "POST");
      }
    },
    transactions: createPostgresTransactionTransport({
      defaultIdentityColumn: defaultIdentity,
      getPoolManager,
      identityCache,
    }),
    async updateGateway<T>(
      payload: AthenaUpdatePayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const compileOptions = await compileOptionsForBoundedMutation(payload);
        const compiled = compilePostgresUpdate(payload, compileOptions);
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        return runCompiled(
          compiled,
          "/gateway/update",
          "POST",
          (rows, rowCount) => {
            if (rows.length === 1) {
              return { count: rowCount, data: rows[0] as T };
            }
            return { count: rowCount, data: rows as T };
          },
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/update", "POST");
      }
    },
    async verifyConnection(
      _connectionOptions?: AthenaGatewayConnectionOptions
    ): Promise<AthenaGatewayConnectionResult> {
      void _connectionOptions;
      try {
        const result = await managedQuery("SELECT 1 AS ok");
        return {
          baseUrl,
          error: undefined,
          errorDetails: null,
          ok: true,
          raw: result,
          reachable: true,
          status: 200,
          statusText: "OK",
          url: `${baseUrl}/pg`,
        };
      } catch (error) {
        const message = sanitizePostgresMessage(
          error instanceof Error ? error.message : String(error)
        );
        return {
          baseUrl,
          error: message,
          errorDetails: null,
          ok: false,
          raw: null,
          reachable: false,
          status: 0,
          statusText: null,
          url: `${baseUrl}/pg`,
        };
      }
    },
  };

  return transport;
}

/**
 * Test/tooling helper: end the underlying pool if it was created.
 * Not part of public AthenaClient API (AD-06).
 */
export async function disposePostgresDirectTransport(
  transport: AthenaGatewayClient
): Promise<void> {
  const holder = transport as AthenaGatewayClient & {
    __athenaPgDispose?: () => Promise<void>;
  };
  if (typeof holder.__athenaPgDispose === "function") {
    await holder.__athenaPgDispose();
  }
}
