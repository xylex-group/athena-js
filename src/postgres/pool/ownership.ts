/**
 * Production PostgreSQL pool construction owners.
 * Subsystems consume a manager or AthenaPostgresRuntime; they do not construct pools.
 */
export const ALLOWED_POSTGRES_POOL_OWNERS = [
  "src/postgres/driver.ts",
  "src/postgres/pool/manager.ts",
] as const;

export const ALLOWED_POSTGRES_POOL_CONNECT = [
  "src/postgres/pool/manager.ts",
] as const;

export const ALLOWED_POSTGRES_POOL_MANAGER_FACTORIES = [
  "src/local/readiness.ts",
  "src/postgres/owned-runtime.ts",
  "src/postgres/pool/manager.ts",
] as const;
