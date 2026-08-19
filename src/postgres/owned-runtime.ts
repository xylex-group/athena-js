import { AthenaConfigurationError } from "../config/errors.ts";
import { recordPostgresPoolCreated } from "../runtime/ownership.ts";
import {
  type AthenaPostgresPool,
  createPostgresPool,
  type QueryResult,
  type QueryResultRow,
} from "./driver.ts";
import { assertNodePostgresRuntime } from "./runtime.ts";

export type AthenaResourceOwnership = "owned" | "borrowed";

export interface AthenaOwnedResource<T> {
  readonly ownership: AthenaResourceOwnership;
  readonly resource: T;
}

export interface AthenaPostgresRuntime {
  close(): Promise<void>;
  getPool(): Promise<AthenaPostgresPool>;
  readonly ownership: AthenaResourceOwnership;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

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

  let poolPromise: Promise<AthenaPostgresPool> | undefined;
  let closed = false;

  const getPool = async (): Promise<AthenaPostgresPool> => {
    if (closed) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_DISPOSED",
        "Athena PostgreSQL runtime was disposed.",
        "db"
      );
    }
    if (options.pool) {
      return options.pool;
    }
    poolPromise ??= createPostgresPool(connectionString as string);
    return poolPromise;
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
      if (ownership !== "owned" || !poolPromise) {
        return;
      }
      const pool = await poolPromise.catch(() => undefined);
      poolPromise = undefined;
      if (pool) {
        await pool.end();
      }
    },
    getPool,
    ownership,
    async query(text, values) {
      const pool = await getPool();
      return pool.query(text, values);
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
