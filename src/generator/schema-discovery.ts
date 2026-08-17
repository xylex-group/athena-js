import { createClient } from "../v3-client.ts";
import type {
  GeneratorProviderConfig,
  PostgresDirectProviderConfig,
  PostgresGatewayProviderConfig,
} from "./types.ts";

/**
 * SQL that lists non-system PostgreSQL schemas that contain base tables.
 * Used by both direct (`pg`) and gateway (`/gateway/query`) discovery paths.
 */
export const DISCOVER_POSTGRES_SCHEMAS_SQL = `
  SELECT DISTINCT n.nspname AS schema_name
  FROM pg_namespace n
  JOIN pg_class c ON c.relnamespace = n.oid
  WHERE c.relkind IN ('r', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND n.nspname NOT LIKE 'pg_toast_temp_%'
  ORDER BY n.nspname;
`.trim();

const SYSTEM_SCHEMA_PREFIXES = ["pg_"] as const;
const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema"]);

interface SchemaNameRow {
  nspname?: unknown;
  schema_name?: unknown;
  schemaName?: unknown;
}

/**
 * Filters and normalizes a raw list of schema names into a stable, unique array.
 * Drops empty strings and PostgreSQL system/catalog namespaces.
 */
export function normalizeDiscoveredSchemas(input: readonly string[]): string[] {
  const schemas: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const schema = value.trim();
    if (!schema || seen.has(schema)) {
      continue;
    }
    if (SYSTEM_SCHEMAS.has(schema)) {
      continue;
    }
    if (SYSTEM_SCHEMA_PREFIXES.some((prefix) => schema.startsWith(prefix))) {
      continue;
    }
    seen.add(schema);
    schemas.push(schema);
  }

  return schemas;
}

/**
 * Merges configured schemas with discovered ones without dropping user intent.
 * - preserves configured order first
 * - appends newly discovered schemas
 * - never removes a configured schema that discovery did not return
 */
export function mergeSchemaSelections(
  configured: readonly string[] | undefined,
  discovered: readonly string[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of configured ?? []) {
    const schema = value.trim();
    if (!schema || seen.has(schema)) {
      continue;
    }
    seen.add(schema);
    result.push(schema);
  }

  for (const value of discovered) {
    const schema = value.trim();
    if (!schema || seen.has(schema)) {
      continue;
    }
    seen.add(schema);
    result.push(schema);
  }

  return result.length > 0 ? result : ["public"];
}

/**
 * True when two schema lists select the same set (order-insensitive).
 */
export function schemasEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  const a = normalizeDiscoveredSchemas(left ?? []);
  const b = normalizeDiscoveredSchemas(right ?? []);
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((schema) => set.has(schema));
}

function coerceSchemaName(row: SchemaNameRow): string | undefined {
  const raw = row.schema_name ?? row.schemaName ?? row.nspname;
  if (typeof raw !== "string") {
    return;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function loadPgPoolConstructor(): Promise<
  new (config: {
    connectionString: string;
  }) => {
    query: <T extends Record<string, unknown>>(
      sql: string
    ) => Promise<{ rows: T[] }>;
    end: () => Promise<void>;
  }
> {
  const module = await import("pg");
  const poolConstructor =
    (
      module as {
        Pool?: new (config: {
          connectionString: string;
        }) => {
          query: <T extends Record<string, unknown>>(
            sql: string
          ) => Promise<{ rows: T[] }>;
          end: () => Promise<void>;
        };
      }
    ).Pool ??
    (
      module as {
        default?: {
          Pool?: new (config: {
            connectionString: string;
          }) => {
            query: <T extends Record<string, unknown>>(
              sql: string
            ) => Promise<{ rows: T[] }>;
            end: () => Promise<void>;
          };
        };
      }
    ).default?.Pool;

  if (!poolConstructor) {
    throw new Error(
      '@xylex-group/athena: Unable to load the PostgreSQL driver for schema discovery. Ensure "pg" is installed and this API runs in a Node.js server runtime.'
    );
  }

  return poolConstructor;
}

async function discoverDirectSchemas(
  config: PostgresDirectProviderConfig
): Promise<string[]> {
  const PoolConstructor = await loadPgPoolConstructor();
  const pool = new PoolConstructor({
    connectionString: config.connectionString,
  });
  try {
    const result = await pool.query(DISCOVER_POSTGRES_SCHEMAS_SQL);
    const names = (result.rows as SchemaNameRow[])
      .map(coerceSchemaName)
      .filter((value): value is string => Boolean(value));
    return normalizeDiscoveredSchemas(names);
  } finally {
    await pool.end();
  }
}

async function discoverGatewaySchemas(
  config: PostgresGatewayProviderConfig
): Promise<string[]> {
  // Avoid ReturnType<typeof createClient> — it overflows TS instantiation depth.
  interface GatewayQueryClient {
    query: <T>(sql: string) => Promise<{
      data?: T[] | null;
      error?: { message?: string } | null;
      status: number;
    }>;
  }
  const client = (
    createClient as unknown as (c: unknown) => GatewayQueryClient
  )({
    backend: {
      type: config.backend ?? "postgresql",
    },
    client: config.client,
    db: { url: config.gatewayUrl },
    env: typeof process === "undefined" ? undefined : process.env,
    key: config.apiKey,
  });

  const result = await client.query<SchemaNameRow>(
    DISCOVER_POSTGRES_SCHEMAS_SQL
  );
  if (result.error || result.status < 200 || result.status >= 300) {
    throw new Error(
      result.error?.message ??
        `Gateway schema discovery failed with status ${result.status}`
    );
  }

  const names = (result.data ?? [])
    .map(coerceSchemaName)
    .filter((value): value is string => Boolean(value));
  return normalizeDiscoveredSchemas(names);
}

/**
 * Discovers application-owned PostgreSQL schemas for generator config auto-fill.
 * Supports both direct Postgres and Athena gateway providers.
 */
export async function discoverPostgresSchemas(
  provider: GeneratorProviderConfig
): Promise<string[]> {
  if (provider.kind === "postgres" && provider.mode === "direct") {
    return discoverDirectSchemas(provider);
  }

  if (provider.kind === "postgres" && provider.mode === "gateway") {
    return discoverGatewaySchemas(provider);
  }

  throw new Error(
    `Schema discovery is only implemented for postgres direct/gateway providers (received ${provider.kind}/${"mode" in provider ? provider.mode : "unknown"}).`
  );
}
