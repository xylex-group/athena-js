import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

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
    pgPoolConstructorPromise = import("pg").then((module) => {
      const poolConstructor =
        (module as { Pool?: PgPoolConstructor }).Pool ??
        (module as { default?: { Pool?: PgPoolConstructor } }).default?.Pool;

      if (!poolConstructor) {
        throw new Error(
          '@xylex-group/athena: Unable to load the PostgreSQL driver. Ensure "pg" is installed and this API runs in a Node.js server runtime.'
        );
      }

      return poolConstructor;
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
