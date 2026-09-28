import { AthenaConfigurationError } from "../config/errors.ts";
import { nextInternalSavepointName } from "../db/transaction/begin-sql.ts";
import { recordPostgresPoolCreated } from "../runtime/ownership.ts";
import {
  ATHENA_POSTGRES_POOL_DEFAULTS,
  type AthenaPostgresPool,
  type AthenaPostgresPoolDiagnostics,
  postgresPoolDiagnostics,
  type QueryResult,
  type QueryResultRow,
} from "./driver.ts";
import {
  PostgresDeadline,
  type PostgresTimeoutPhase,
} from "./pool/deadline.ts";
import type { PostgresWorkload } from "./pool/lease.ts";
import {
  connectPostgresPoolWithDeadline,
  createPostgresPoolManager,
  queryPostgresClientWithDeadline,
  type PostgresAcquireRequest,
  type PostgresPoolManager,
  PostgresDeadlineExceededError,
} from "./pool/manager.ts";
import { classifyPostgresClientPoison } from "./pool/poison.ts";
import { assertNodePostgresRuntime } from "./runtime.ts";

function isPostgresDebugEnabled(): boolean {
  const value = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.ATHENA_JS_DEBUG;
  return value === "1" || value === "true";
}

function logPoolSaturation(
  stats: AthenaPostgresPoolDiagnostics,
  durationMs: number
): void {
  if (!isPostgresDebugEnabled()) {
    return;
  }
  if (stats.waitingCount <= 0 && !(stats.idleCount === 0 && durationMs >= 50)) {
    return;
  }
  console.warn(
    `[athena-postgres] pool total=${stats.totalCount} idle=${stats.idleCount} waiting=${stats.waitingCount} queryMs=${Math.round(durationMs)}`
  );
}

export type AthenaResourceOwnership = "owned" | "borrowed";

export interface AthenaOwnedResource<T> {
  readonly ownership: AthenaResourceOwnership;
  readonly resource: T;
}

export type AthenaPostgresTransactionOptions = {
  deadlineMs?: number;
  workload?: PostgresWorkload;
};

export type AthenaPostgresQueryOptions = {
  deadlineMs?: number;
  workload?: PostgresWorkload;
};

export interface AthenaPostgresRuntime {
  close(): Promise<void>;
  getPool(): Promise<AthenaPostgresPool>;
  getPoolManager(): Promise<PostgresPoolManager>;
  inspectPool(): Promise<AthenaPostgresPoolDiagnostics>;
  readonly ownership: AthenaResourceOwnership;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
    options?: AthenaPostgresQueryOptions
  ): Promise<QueryResult<T>>;
  transaction<T>(
    fn: (runtime: AthenaPostgresRuntime) => Promise<T>,
    options?: AthenaPostgresTransactionOptions
  ): Promise<T>;
}

export { connectPostgresPoolWithDeadline };

export interface CreateAthenaPostgresRuntimeOptions {
  connectionString?: string;
  ownership?: AthenaResourceOwnership;
  pool?: AthenaPostgresPool;
}

const runtimeByTransport = new WeakMap<object, AthenaPostgresRuntime>();

const OWNED_RUNTIME_CACHE = Symbol.for(
  "@xylex-group/athena.ownedPostgresRuntimes"
);

type OwnedRuntimeCacheEntry = {
  refs: number;
  runtime: AthenaPostgresRuntime;
};

type OwnedRuntimeCache = Map<string, OwnedRuntimeCacheEntry>;

function ownedRuntimeCache(): OwnedRuntimeCache {
  const holder = globalThis as typeof globalThis & {
    [OWNED_RUNTIME_CACHE]?: OwnedRuntimeCache;
  };
  holder[OWNED_RUNTIME_CACHE] ??= new Map();
  return holder[OWNED_RUNTIME_CACHE];
}

export function bindPostgresRuntime(
  transport: object,
  runtime: AthenaPostgresRuntime
): void {
  runtimeByTransport.set(transport, runtime);
}

export function getBoundPostgresRuntime(
  transport: object | undefined
): AthenaPostgresRuntime | undefined {
  return transport ? runtimeByTransport.get(transport) : undefined;
}

export function createAthenaPostgresRuntime(
  options: CreateAthenaPostgresRuntimeOptions
): AthenaPostgresRuntime {
  const connectionString = options.connectionString?.trim();
  if (!(options.pool || connectionString)) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "AthenaPostgresRuntime requires a connection string or an existing pool.",
      "db"
    );
  }

  assertNodePostgresRuntime();

  const ownership: AthenaResourceOwnership = options.pool
    ? (options.ownership ?? "borrowed")
    : "owned";

  if (ownership === "owned" && connectionString && !options.pool) {
    const cached = ownedRuntimeCache().get(connectionString);
    if (cached) {
      cached.refs += 1;
      return cached.runtime;
    }
  }

  const poolManager = createPostgresPoolManager(
    options.pool
      ? { ownership, pool: options.pool }
      : {
          connectionString: connectionString as string,
          ownership,
        }
  );
  let closed = false;

  const assertOpen = (): void => {
    if (closed) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_DISPOSED",
        "Athena PostgreSQL runtime was disposed.",
        "db"
      );
    }
  };

  const getPool = async (): Promise<AthenaPostgresPool> => {
    assertOpen();
    return poolManager.getPool();
  };

  const inspectPool = async (): Promise<AthenaPostgresPoolDiagnostics> =>
    postgresPoolDiagnostics(await getPool());
  const getPoolManager = async (): Promise<PostgresPoolManager> => {
    assertOpen();
    return poolManager;
  };

  const runtime: AthenaPostgresRuntime = {
    async close() {
      if (connectionString && ownership === "owned") {
        const entry = ownedRuntimeCache().get(connectionString);
        if (entry && entry.runtime === runtime) {
          entry.refs -= 1;
          if (entry.refs > 0) {
            return;
          }
          ownedRuntimeCache().delete(connectionString);
        }
      }
      if (closed) {
        return;
      }
      closed = true;
      await poolManager.close();
    },
    getPool,
    getPoolManager,
    inspectPool,
    ownership,
    async query(text, values, queryOptions) {
      const pool = await getPool();
      const stats = postgresPoolDiagnostics(pool);
      const started = performance.now();
      try {
        return await poolManager.query(
          {
            deadline: PostgresDeadline.after(
              queryOptions?.deadlineMs ??
                ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
            ),
            target: "pooled",
            workload: queryOptions?.workload ?? "query",
          },
          text,
          values
        );
      } finally {
        logPoolSaturation(stats, performance.now() - started);
      }
    },
    async transaction(fn, options) {
      const deadlineMs =
        options?.deadlineMs ??
        ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis;
      const deadline = PostgresDeadline.after(deadlineMs);
      const request: PostgresAcquireRequest = {
        deadline,
        target: "pooled",
        workload: options?.workload ?? "transaction",
      };
      const lease = await poolManager.acquire(request);
      const client = lease.client;
      let savepointIndex = 0;
      let active = true;
      let leaseSettled = false;
      const settleLease = (mode: "release" | "destroy", reason?: unknown) => {
        if (leaseSettled) {
          return;
        }
        leaseSettled = true;
        if (mode === "destroy") {
          lease.destroy(reason);
          return;
        }
        lease.release();
      };
      const destroyOnTimeout = (
        error: PostgresDeadlineExceededError
      ): void => {
        active = false;
        settleLease("destroy", error);
      };
      const deadlineTimer = setTimeout(() => {
        destroyOnTimeout(
          new PostgresDeadlineExceededError(
            "transaction",
            deadline.elapsedMs(),
            deadline.durationMs,
            request.target,
            request.workload
          )
        );
      }, Math.max(1, Math.ceil(deadline.remainingMs())));
      const runClientQuery = async <T extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
        phase: PostgresTimeoutPhase = "statement"
      ): Promise<QueryResult<T>> =>
        queryPostgresClientWithDeadline(
          client,
          request,
          text,
          values,
          destroyOnTimeout,
          phase
        );
      const assertActive = (): void => {
        if (!active || deadline.expired()) {
          if (active) {
            destroyOnTimeout(
              new PostgresDeadlineExceededError(
                "transaction",
                deadline.elapsedMs(),
                deadline.durationMs,
                request.target,
                request.workload
              )
            );
          }
          throw new Error("PostgreSQL transaction deadline exceeded");
        }
      };
      const runTransactionQuery = async <
        T extends QueryResultRow = QueryResultRow,
      >(
        text: string,
        values?: unknown[],
        phase: PostgresTimeoutPhase = "statement"
      ): Promise<QueryResult<T>> => {
        assertActive();
        if (request.workload === "auth") {
          const timeoutMs = Math.max(
            1,
            Math.trunc(deadline.remainingMs())
          );
          await runClientQuery(
            `SET LOCAL statement_timeout = '${timeoutMs}ms'`,
            undefined,
            phase
          );
          assertActive();
        }
        return runClientQuery(text, values, phase);
      };
      const txRuntime: AthenaPostgresRuntime = {
        close: async () => {},
        getPool,
        getPoolManager,
        inspectPool,
        ownership: "borrowed",
        query: async (text, values) => {
          return runTransactionQuery(text, values);
        },
        transaction: async (inner) => {
          const savepoint = nextInternalSavepointName(++savepointIndex);
          await runTransactionQuery(`SAVEPOINT "${savepoint}"`);
          try {
            const value = await inner(txRuntime);
            await runTransactionQuery(`RELEASE SAVEPOINT "${savepoint}"`);
            return value;
          } catch (error) {
            try {
              if (active && !deadline.expired()) {
                await runClientQuery(
                  `ROLLBACK TO SAVEPOINT "${savepoint}"`,
                  undefined,
                  "rollback"
                );
                await runClientQuery(
                  `RELEASE SAVEPOINT "${savepoint}"`,
                  undefined,
                  "rollback"
                );
              } else {
                settleLease("destroy", error);
              }
            } catch (cleanupError) {
              settleLease("destroy", cleanupError);
            }
            throw error;
          }
        },
      };
      try {
        await runClientQuery("BEGIN", undefined, "begin");
        assertActive();
        const value = await fn(txRuntime);
        assertActive();
        await runTransactionQuery("COMMIT", undefined, "commit");
        return value;
      } catch (error) {
        try {
          if (active && !deadline.expired()) {
            await runClientQuery("ROLLBACK", undefined, "rollback");
          } else {
            settleLease("destroy", error);
          }
        } catch (rollbackError) {
          settleLease("destroy", rollbackError);
          throw error;
        }
        if (classifyPostgresClientPoison(error) === "destroy") {
          settleLease("destroy", error);
        }
        throw error;
      } finally {
        active = false;
        clearTimeout(deadlineTimer);
        settleLease("release");
      }
    },
  };

  if (ownership === "owned" && connectionString && !options.pool) {
    ownedRuntimeCache().set(connectionString, { refs: 1, runtime });
    recordPostgresPoolCreated();
  }

  return runtime;
}

export function getAthenaOwnedRuntimeCacheSize(): number {
  return ownedRuntimeCache().size;
}
