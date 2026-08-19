import { AthenaConfigurationError } from "../config/errors.ts";
import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

export const ATHENA_POSTGRES_DRIVER_MISSING_MESSAGE = [
  "Athena local PostgreSQL runtime requires `pg`.",
  "",
  "Install:",
  "  pnpm add pg",
  "  npm install pg",
  "  yarn add pg",
  "  bun add pg",
].join("\n");

export function postgresDriverMissingError(
  cause?: unknown
): AthenaConfigurationError {
  return new AthenaConfigurationError(
    "ATHENA_POSTGRES_DRIVER_MISSING",
    ATHENA_POSTGRES_DRIVER_MISSING_MESSAGE,
    "db",
    { cause }
  );
}

function isModuleNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /cannot find module ['"]pg['"]|can't resolve ['"]pg['"]/i.test(message)
  );
}

/**
 * Narrow pool surface used by Athena tooling (introspection + migrations).
 * Avoids leaking the full `pg` type graph into every consumer.
 */
export interface AthenaPostgresQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

export interface AthenaPostgresPool extends AthenaPostgresQueryable {
  connect(): Promise<AthenaPostgresClient>;
  end(): Promise<void>;
}

export interface AthenaPostgresClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
  release(err?: Error | boolean): void;
}

type PgPoolConstructor = new (config: PoolConfig) => Pool;

let pgPoolConstructorPromise: Promise<PgPoolConstructor> | undefined;

/**
 * Lazily loads the Node-only `pg` Pool constructor.
 * Safe to call only from server/CLI tooling entry points.
 */
export async function loadPgPoolConstructor(): Promise<PgPoolConstructor> {
  if (!pgPoolConstructorPromise) {
    pgPoolConstructorPromise = import("pg")
      .then((module) => {
        const poolConstructor =
          (module as { Pool?: PgPoolConstructor }).Pool ??
          (module as { default?: { Pool?: PgPoolConstructor } }).default?.Pool;

        if (!poolConstructor) {
          throw postgresDriverMissingError();
        }

        return poolConstructor;
      })
      .catch((error: unknown) => {
        pgPoolConstructorPromise = undefined;
        if (isModuleNotFound(error) || error instanceof AthenaConfigurationError) {
          throw error instanceof AthenaConfigurationError
            ? error
            : postgresDriverMissingError(error);
        }
        throw error;
      });
  }

  return pgPoolConstructorPromise;
}

/**
 * Creates a PostgreSQL connection pool for Node tooling.
 */
export async function createPostgresPool(
  connectionString: string,
  config: Omit<PoolConfig, "connectionString"> = {}
): Promise<AthenaPostgresPool> {
  const PoolConstructor = await loadPgPoolConstructor();
  const pool = new PoolConstructor({
    ...config,
    connectionString,
  });
  return pool as unknown as AthenaPostgresPool;
}

export type { Pool, PoolClient, QueryResult, QueryResultRow };
