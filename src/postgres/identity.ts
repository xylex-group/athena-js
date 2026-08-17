/**
 * Resolve a proven single-column unique identity for bounded UPDATE/DELETE.
 * Prefer single-column PRIMARY KEY (NOT NULL); else single-column UNIQUE NOT NULL
 * non-partial index. Never invent `id`.
 */

import type { AthenaPostgresQueryable } from "./driver.ts";
import { PostgresSqlCompileError } from "./sql.ts";

export interface ParsedTableName {
  /**
   * Schema when qualified (`public.users`).
   * `null` for bare names — resolve via the connection `search_path`.
   */
  schema: string | null;
  table: string;
  /** Cache / display key before search_path resolve: bare table or schema.table */
  key: string;
  /** True when the caller passed an unqualified relation name. */
  bare: boolean;
}

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Split `public.users` or bare `users` (schema resolved via search_path later).
 */
export function parsePostgresTableName(tableName: string): ParsedTableName {
  const trimmed = tableName.trim();
  if (!trimmed) {
    throw new PostgresSqlCompileError(
      "missing_table",
      "table_name is required for bounded mutation identity resolve"
    );
  }
  const parts = trimmed.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    const table = parts[0]!;
    if (!SAFE_IDENT.test(table)) {
      throw new PostgresSqlCompileError(
        "invalid_identifier",
        `Invalid table name for identity resolve: ${trimmed}`
      );
    }
    return { bare: true, key: table, schema: null, table };
  }
  if (parts.length === 2) {
    const [schema, table] = parts as [string, string];
    if (!SAFE_IDENT.test(schema) || !SAFE_IDENT.test(table)) {
      throw new PostgresSqlCompileError(
        "invalid_identifier",
        `Invalid schema-qualified name for identity resolve: ${trimmed}`
      );
    }
    return { bare: false, key: `${schema}.${table}`, schema, table };
  }
  throw new PostgresSqlCompileError(
    "invalid_identifier",
    `Identity resolve supports schema.table only: ${trimmed}`
  );
}

/** Single-column PRIMARY KEY that is NOT NULL. */
const PK_IDENTITY_SQL = `
SELECT a.attname AS column_name
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
WHERE con.contype = 'p'
  AND n.nspname = $1
  AND c.relname = $2
  AND cardinality(con.conkey) = 1
  AND a.attnotnull
  AND NOT a.attisdropped
LIMIT 1
`.trim();

/**
 * Single-column UNIQUE index, non-partial, column NOT NULL, and valid.
 * Excludes primary keys (handled above). Expression indexes excluded via attnum > 0.
 * `indisvalid` rejects failed CREATE UNIQUE INDEX CONCURRENTLY leftovers.
 */
const UNIQUE_IDENTITY_SQL = `
SELECT a.attname AS column_name
FROM pg_index i
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a
  ON a.attrelid = t.oid
 AND a.attnum = i.indkey[0]
 AND a.attnum > 0
WHERE i.indisunique
  AND i.indisvalid
  AND NOT i.indisprimary
  AND i.indnkeyatts = 1
  AND i.indpred IS NULL
  AND a.attnotnull
  AND NOT a.attisdropped
  AND n.nspname = $1
  AND t.relname = $2
ORDER BY a.attname
LIMIT 1
`.trim();

/**
 * Resolve a bare relation name the same way the executor would (`search_path`).
 * `to_regclass` returns NULL when no visible relation matches.
 * Callers must pass a double-quoted identifier string so mixed-case names are
 * not folded (matches compiler `"Ident"` quoting).
 */
const RESOLVE_BARE_RELATION_SQL = `
SELECT n.nspname AS schema_name, c.relname AS table_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass($1)
LIMIT 1
`.trim();

/**
 * Format a validated bare identifier for `to_regclass`.
 * Unquoted input would be folded to lowercase by PostgreSQL, which diverges
 * from the mutation compiler's always-quoted identifiers.
 */
export function quotePostgresRegclassName(identifier: string): string {
  if (!SAFE_IDENT.test(identifier)) {
    throw new PostgresSqlCompileError(
      "invalid_identifier",
      `Invalid table name for regclass resolve: ${identifier}`
    );
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export interface PostgresIdentityCache {
  /** Successful identity column by schema.table */
  get(key: string): string | undefined;
  /** Negative cache: resolved and none found */
  getMissing(key: string): boolean;
  set(key: string, column: string): void;
  setMissing(key: string): void;
}

export function createPostgresIdentityCache(): PostgresIdentityCache {
  const hits = new Map<string, string>();
  const misses = new Set<string>();
  return {
    get(key) {
      return hits.get(key);
    },
    getMissing(key) {
      return misses.has(key);
    },
    set(key, column) {
      misses.delete(key);
      hits.set(key, column);
    },
    setMissing(key) {
      hits.delete(key);
      misses.add(key);
    },
  };
}

function columnFromRows(rows: unknown[]): string | undefined {
  const first = rows[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return undefined;
  }
  const name = (first as { column_name?: unknown }).column_name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

interface ResolvedRelation {
  /** Cache key for this relation (schema.table). */
  key: string;
  schema: string;
  table: string;
}

async function resolveRelationTarget(
  pool: AthenaPostgresQueryable,
  parsed: ParsedTableName
): Promise<ResolvedRelation> {
  if (!parsed.bare && parsed.schema) {
    return {
      key: `${parsed.schema}.${parsed.table}`,
      schema: parsed.schema,
      table: parsed.table,
    };
  }

  const result = await pool.query<{
    schema_name: string;
    table_name: string;
    }>(RESOLVE_BARE_RELATION_SQL, [quotePostgresRegclassName(parsed.table)]);
  const first = result.rows[0];
  if (
    !first ||
    typeof first !== "object" ||
    typeof first.schema_name !== "string" ||
    typeof first.table_name !== "string" ||
    !first.schema_name.trim() ||
    !first.table_name.trim()
  ) {
    throw new PostgresSqlCompileError(
      "relation_not_found",
      `Cannot resolve bare table "${parsed.table}" on the connection search_path for bounded mutation identity`
    );
  }
  const schema = first.schema_name.trim();
  const table = first.table_name.trim();
  return { key: `${schema}.${table}`, schema, table };
}

/**
 * Resolve identity for bounded mutations against a live pool.
 * Throws PostgresSqlCompileError when no safe single-column identity exists.
 *
 * Cache keys are always schema-qualified. Bare names re-run `to_regclass` on
 * every call so a changed connection `search_path` cannot reuse a stale target.
 */
export async function resolvePostgresBoundedIdentityColumn(
  pool: AthenaPostgresQueryable,
  tableName: string,
  cache?: PostgresIdentityCache
): Promise<string> {
  const parsed = parsePostgresTableName(tableName);

  // Qualified names can consult the cache before any catalog round-trip.
  if (!parsed.bare && cache) {
    const cached = cache.get(parsed.key);
    if (cached) {
      return cached;
    }
    if (cache.getMissing(parsed.key)) {
      throw noIdentityError(parsed.key);
    }
  }

  // Bare names always resolve the live search_path target first.
  const target = await resolveRelationTarget(pool, parsed);

  if (cache) {
    const cachedQualified = cache.get(target.key);
    if (cachedQualified) {
      return cachedQualified;
    }
    if (cache.getMissing(target.key)) {
      throw noIdentityError(target.key);
    }
  }

  const pk = await pool.query<{ column_name: string }>(PK_IDENTITY_SQL, [
    target.schema,
    target.table,
  ]);
  const pkCol = columnFromRows(pk.rows as unknown[]);
  if (pkCol) {
    cache?.set(target.key, pkCol);
    return pkCol;
  }

  const uniq = await pool.query<{ column_name: string }>(UNIQUE_IDENTITY_SQL, [
    target.schema,
    target.table,
  ]);
  const uniqCol = columnFromRows(uniq.rows as unknown[]);
  if (uniqCol) {
    cache?.set(target.key, uniqCol);
    return uniqCol;
  }

  cache?.setMissing(target.key);
  throw noIdentityError(target.key);
}

function noIdentityError(tableKey: string): PostgresSqlCompileError {
  return new PostgresSqlCompileError(
    "bounded_mutation_no_unique_identity",
    `Bounded update/delete on "${tableKey}" requires a proven single-column PRIMARY KEY or UNIQUE NOT NULL index`
  );
}

/**
 * True when payload needs identity resolution for bounded mutations.
 */
export function needsBoundedIdentity(payload: {
  limit?: number;
  offset?: number;
  current_page?: number;
  page_size?: number;
  sort_by?: unknown;
}): boolean {
  return (
    payload.limit !== undefined ||
    payload.offset !== undefined ||
    payload.page_size !== undefined ||
    payload.current_page !== undefined ||
    Boolean(payload.sort_by)
  );
}
