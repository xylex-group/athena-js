import { AthenaConfigurationError } from "../config/errors.ts";
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

  return {
    async close() {
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
}
