/**
 * Local sentinels for direct PostgreSQL materialization (not real HTTP endpoints).
 * Mirror Cloudflare edge sentinels so resolveCore accepts DB-only clients.
 */
export const ATHENA_PG_DIRECT_BASE_URL =
  "https://athena.local/postgres-direct" as const;

export const ATHENA_PG_DIRECT_API_KEY = "postgres-direct-local" as const;
