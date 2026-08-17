/**
 * L1 D1/SQLite SQL compiler for flat gateway payloads.
 * Aligned with gateway D1 matrix: flat select/insert/update/delete + upsert.
 */

import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaSortBy,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";
import {
  compileLegacyBooleanNode,
  LegacyBooleanParseError,
  parseLegacyBooleanExpression,
} from "../../query/legacy-boolean.ts";
import { quoteQualifiedIdentifier } from "../../sql-identifiers.ts";

export interface D1CompiledStatement {
  params: unknown[];
  sql: string;
}

/**
 * One or more statements. Sparse multi-row inserts without NULL-coercion expand
 * into a batch of single-row inserts (SQLite rejects `DEFAULT` in VALUES tuples).
 */
export type D1CompiledSql = D1CompiledStatement & {
  statements?: D1CompiledStatement[];
};

function asSingle(sql: string, params: unknown[]): D1CompiledSql {
  return { params, sql };
}

function asBatch(statements: D1CompiledStatement[]): D1CompiledSql {
  if (statements.length === 0) {
    throw new D1SqlCompileError(
      "empty_insert",
      "batch requires at least one statement"
    );
  }
  return {
    params: statements[0]?.params,
    sql: statements[0]?.sql,
    statements,
  };
}

function hasPaginationBounds(payload: {
  limit?: number;
  offset?: number;
  current_page?: number;
  page_size?: number;
}): boolean {
  return (
    payload.limit !== undefined ||
    payload.offset !== undefined ||
    payload.page_size !== undefined ||
    payload.current_page !== undefined
  );
}

/**
 * Ensure mutation pagination actually produces a LIMIT/OFFSET clause.
 * `.currentPage(n)` alone would otherwise look "bounded" but emit no limit and
 * update/delete every matching row.
 */
function assertEffectiveMutationBounds(payload: {
  limit?: number;
  offset?: number;
  current_page?: number;
  page_size?: number;
}): void {
  if (
    payload.current_page !== undefined &&
    payload.page_size === undefined &&
    payload.limit === undefined
  ) {
    throw new D1SqlCompileError(
      "page_without_size",
      "current_page requires page_size (or limit) for bounded update/delete on D1 edge-local"
    );
  }
  const clause = limitOffsetClause(payload);
  if (!clause.trim()) {
    throw new D1SqlCompileError(
      "invalid_pagination_bounds",
      "Bounded update/delete requires limit, offset, and/or page_size on D1 edge-local"
    );
  }
}

/**
 * SQLite system row identity aliases. A user column with any of these names
 * shadows the system rowid — bounded mutations would then be unsafe.
 */
const SQLITE_ROWID_ALIASES = new Set(["rowid", "oid", "_rowid_"]);

/** Optional compile-time options for D1 SQL compilation. */
export interface D1CompileOptions {
  /**
   * Proven single-column unique identity for bounded UPDATE/DELETE (from
   * PRAGMA table_info / unique indexes, or an explicit caller override).
   * Required for limit/offset/page bounded mutations.
   */
  identityColumn?: string;
}

function referencedMutationColumns(payload: {
  conditions?: AthenaGatewayCondition[];
  sort_by?: AthenaSortBy;
}): string[] {
  const names: string[] = [];
  for (const condition of payload.conditions ?? []) {
    const column = (condition.column ?? condition.eq_column ?? "").trim();
    if (column) {
      names.push(column);
    }
  }
  if (payload.sort_by?.field?.trim()) {
    names.push(payload.sort_by.field.trim());
  }
  return names;
}

/**
 * Choose a safe identity expression for bounded update/delete, or throw.
 *
 * Pure L1 has no live schema: callers (transport) must supply a proven unique
 * `identityColumn` (single-column PK or unique index). Never assume `id`.
 * Reject filters/order that reference shadowable rowid aliases.
 */
function resolveBoundedIdentityColumn(
  payload: {
    conditions?: AthenaGatewayCondition[];
    sort_by?: AthenaSortBy;
  },
  options?: D1CompileOptions
): string {
  const refs = referencedMutationColumns(payload);
  const lower = refs.map((name) => name.toLowerCase());

  if (lower.some((name) => SQLITE_ROWID_ALIASES.has(name))) {
    throw new D1SqlCompileError(
      "bounded_mutation_unsafe_identity",
      "Bounded update/delete cannot use rowid/oid/_rowid_ in filters or order — " +
        "those names may be user columns that shadow SQLite row identity. " +
        "Resolve the table primary key (or a single-column unique index) instead."
    );
  }

  const identity = options?.identityColumn?.trim();
  if (!identity) {
    throw new D1SqlCompileError(
      "bounded_mutation_no_unique_identity",
      "Bounded update/delete requires a proven unique identity column from the table schema " +
        "(single-column PRIMARY KEY or UNIQUE index). Cannot assume a column named id."
    );
  }
  if (SQLITE_ROWID_ALIASES.has(identity.toLowerCase())) {
    throw new D1SqlCompileError(
      "bounded_mutation_unsafe_identity",
      `Bounded update/delete cannot use identity column "${identity}" — ` +
        "it may shadow SQLite row identity."
    );
  }
  return identity;
}

/**
 * SQLite-compatible bounded mutation via unique-identity subquery.
 * Uses `"pk" IN (SELECT "pk" … LIMIT …)` — not system `_rowid_`.
 */
function boundedRowidInClause(
  table: string,
  whereSql: string,
  whereParams: unknown[],
  payload: {
    limit?: number;
    offset?: number;
    current_page?: number;
    page_size?: number;
    sort_by?: AthenaSortBy;
    conditions?: AthenaGatewayCondition[];
  },
  options?: D1CompileOptions
): { sql: string; params: unknown[] } {
  assertEffectiveMutationBounds(payload);
  const identity = resolveBoundedIdentityColumn(payload, options);
  const identitySql = quoteIdent(identity);
  const innerWhere = whereSql.replace(/^WHERE\s+/i, "");
  const parts = [
    `SELECT ${identitySql} FROM ${quoteIdent(table)}`,
    innerWhere ? `WHERE ${innerWhere}` : "",
    orderClause(payload.sort_by),
    limitOffsetClause(payload),
  ].filter(Boolean);
  return {
    params: [...whereParams],
    sql: `${identitySql} IN (${parts.join(" ")})`,
  };
}

export class D1SqlCompileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "D1SqlCompileError";
    this.code = code;
  }
}

/** Simple SQL identifier: letter/underscore start, then alphanumerics/underscore. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Drop-in mapping for Postgres-oriented AthenaModels on D1/SQLite.
 *
 * D1 has no schemas. Gateway/model wire names like `public.users` (from
 * `table('users').schema('public')` or `meta.tableName: "public.users"`) are
 * reduced to the bare table segment so the same models work on edge without
 * rewriting registries.
 *
 * Multi-schema collisions (`public.users` vs `analytics.users` → both `users`)
 * must be disambiguated with an explicit physical name
 * (`.from('analytics_users')` / `meta.tableName: "analytics_users"`).
 */
export function normalizeD1TableName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new D1SqlCompileError("invalid_identifier", "Identifier is required");
  }
  if (!trimmed.includes(".")) {
    return trimmed;
  }
  const segments = trimmed
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) {
    throw new D1SqlCompileError(
      "invalid_identifier",
      `Invalid schema-qualified name for D1 edge-local: ${trimmed}`
    );
  }
  return segments.at(-1)!;
}

function quoteIdent(name: string): string {
  const bare = normalizeD1TableName(name);
  // Reject quotes, whitespace, and other characters that would only appear
  // if a caller tried to smuggle SQL past quoting.
  if (!SAFE_IDENTIFIER.test(bare)) {
    throw new D1SqlCompileError(
      "invalid_identifier",
      `Invalid SQL identifier for D1 edge-local: ${bare}`
    );
  }
  return quoteQualifiedIdentifier(bare);
}

/** Response alias form: `user_id:id` → `"id" AS "user_id"`. */
const RESPONSE_ALIAS_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/;
/** SQL alias form: `id as user_id` or `id user_id`. */
const SQL_ALIAS_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*)\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)$/i;

/**
 * Quote one SELECT/RETURNING token. Only simple identifiers and documented
 * aliases are accepted — raw expressions are rejected to prevent SQL injection
 * from user-controlled column lists (gateway may pass expressions through).
 */
function quoteSelectTokenStrict(token: string): string {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "*") {
    return trimmed || "*";
  }

  if (SAFE_IDENTIFIER.test(trimmed)) {
    return quoteQualifiedIdentifier(trimmed);
  }

  const responseAlias = RESPONSE_ALIAS_PATTERN.exec(trimmed);
  if (responseAlias) {
    const [, aliasIdentifier, baseIdentifier] = responseAlias;
    return `${quoteQualifiedIdentifier(baseIdentifier!)} AS ${quoteQualifiedIdentifier(aliasIdentifier!)}`;
  }

  const sqlAlias = SQL_ALIAS_PATTERN.exec(trimmed);
  if (sqlAlias) {
    const [, baseIdentifier, aliasIdentifier] = sqlAlias;
    return `${quoteQualifiedIdentifier(baseIdentifier!)} AS ${quoteQualifiedIdentifier(aliasIdentifier!)}`;
  }

  throw new D1SqlCompileError(
    "unsafe_select",
    `SELECT/RETURNING expressions are not supported on D1 edge-local; use column names or aliases only: ${token}`
  );
}

/**
 * SELECT / RETURNING list with documented response aliases (`alias:column`)
 * and SQL-style aliases (`column as alias`). Edge-local only allows identifiers.
 */
function selectClause(columns: string[] | string | undefined): string {
  if (columns === undefined || columns === "*" || columns === "") {
    return "*";
  }
  if (typeof columns === "string") {
    const trimmed = columns.trim();
    if (!trimmed || trimmed === "*") {
      return "*";
    }
    return trimmed
      .split(",")
      .map((part) => quoteSelectTokenStrict(part))
      .join(", ");
  }
  if (columns.length === 0) {
    return "*";
  }
  return columns.map((column) => quoteSelectTokenStrict(column)).join(", ");
}

/** RETURNING is omitted for head-only mutations (metadata / count without row body). */
function wantsReturning(payload: {
  columns?: string[] | string;
  head?: boolean;
}): boolean {
  return Boolean(payload.columns) && payload.head !== true;
}

interface WhereClause {
  params: unknown[];
  sql: string;
}

function conditionToWhere(condition: AthenaGatewayCondition): WhereClause {
  const operator = (condition.operator || "eq").toLowerCase();
  const value =
    condition.value === undefined ? condition.eq_value : condition.value;

  if (operator === "or" || operator === "not") {
    if (typeof value !== "string") {
      throw new D1SqlCompileError(
        "unsupported_operator",
        `Condition operator "${operator}" requires a legacy expression string`
      );
    }
    try {
      const tree = parseLegacyBooleanExpression(
        value,
        operator === "or" ? "or" : "and"
      );
      const params: unknown[] = [];
      const sql = compileLegacyBooleanNode(tree, (predicate) => {
        const clause = conditionToWhere(predicate);
        params.push(...clause.params);
        return clause.sql;
      });
      return {
        params,
        sql: operator === "not" ? `(NOT (${sql}))` : sql,
      };
    } catch (error) {
      if (error instanceof D1SqlCompileError) {
        throw error;
      }
      const message =
        error instanceof LegacyBooleanParseError
          ? error.message
          : `Condition operator "${operator}" is not supported on D1 edge-local L1`;
      throw new D1SqlCompileError("unsupported_operator", message);
    }
  }

  const column = condition.column?.trim() || condition.eq_column?.trim() || "";
  if (!column) {
    throw new D1SqlCompileError(
      "invalid_condition",
      "Condition requires a column"
    );
  }
  const col = quoteIdent(column);

  switch (operator) {
    case "eq": {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return { params: [], sql: "1 = 0" };
        }
        const placeholders = value.map(() => "?").join(", ");
        return { params: [...value], sql: `${col} IN (${placeholders})` };
      }
      // SQLite: `col = NULL` is unknown and matches nothing. Match gateway /
      // structured-fetch semantics: null equality → IS NULL.
      if (value === null) {
        return { params: [], sql: `${col} IS NULL` };
      }
      return { params: [value ?? null], sql: `${col} = ?` };
    }
    case "neq":
      // SQLite: `col != NULL` never matches. Match gateway: null neq → IS NOT NULL.
      if (value === null) {
        return { params: [], sql: `${col} IS NOT NULL` };
      }
      return { params: [value ?? null], sql: `${col} != ?` };
    case "gt":
      return { params: [value ?? null], sql: `${col} > ?` };
    case "gte":
      return { params: [value ?? null], sql: `${col} >= ?` };
    case "lt":
      return { params: [value ?? null], sql: `${col} < ?` };
    case "lte":
      return { params: [value ?? null], sql: `${col} <= ?` };
    case "like":
      return { params: [value ?? null], sql: `${col} LIKE ?` };
    case "ilike":
      return { params: [value ?? null], sql: `${col} LIKE ? COLLATE NOCASE` };
    case "in": {
      const items = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
      if (items.length === 0) {
        return { params: [], sql: "1 = 0" };
      }
      const placeholders = items.map(() => "?").join(", ");
      return { params: [...items], sql: `${col} IN (${placeholders})` };
    }
    case "is": {
      if (value === null || value === "null") {
        return { params: [], sql: `${col} IS NULL` };
      }
      if (value === true || value === "true") {
        return { params: [], sql: `${col} IS TRUE` };
      }
      if (value === false || value === "false") {
        return { params: [], sql: `${col} IS FALSE` };
      }
      return { params: [value], sql: `${col} IS ?` };
    }
    case "not":
    case "or":
    case "contains":
    case "containedby":
      throw new D1SqlCompileError(
        "unsupported_operator",
        `Condition operator "${operator}" is not supported on D1 edge-local L1`
      );
    default:
      throw new D1SqlCompileError(
        "unsupported_operator",
        `Unknown condition operator "${operator}"`
      );
  }
}

function buildWhere(
  conditions: AthenaGatewayCondition[] | undefined
): WhereClause {
  if (!conditions?.length) {
    return { params: [], sql: "" };
  }
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const condition of conditions) {
    // Legacy shape: only eq_column/eq_value without operator
    if (!condition.operator && condition.eq_column) {
      const clause = conditionToWhere({
        ...condition,
        column: condition.eq_column,
        operator: "eq",
        value: condition.eq_value,
      });
      parts.push(clause.sql);
      params.push(...clause.params);
      continue;
    }
    const clause = conditionToWhere(condition);
    parts.push(clause.sql);
    params.push(...clause.params);
  }
  return {
    params,
    sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
  };
}

function orderClause(order?: AthenaSortBy): string {
  if (!order?.field?.trim()) {
    return "";
  }
  const direction = order.direction === "descending" ? "DESC" : "ASC";
  return `ORDER BY ${quoteIdent(order.field)} ${direction}`;
}

function limitOffsetClause(payload: {
  limit?: number;
  offset?: number;
  current_page?: number;
  page_size?: number;
}): string {
  let limit = payload.limit;
  let offset = payload.offset;

  // Prefer explicit page_size as the page length when limit is absent.
  if (limit === undefined && payload.page_size !== undefined) {
    limit = payload.page_size;
  }

  // Apply current_page → OFFSET using page_size, or limit when page_size is
  // omitted (`.limit(10).currentPage(2)` must not stay at OFFSET 0).
  if (payload.current_page !== undefined && offset === undefined) {
    const pageSize = payload.page_size ?? payload.limit;
    if (pageSize !== undefined) {
      offset = Math.max(0, (payload.current_page - 1) * pageSize);
    }
  }

  const parts: string[] = [];
  // SQLite/D1 requires LIMIT when OFFSET is present; -1 means no upper bound.
  if (offset !== undefined && limit === undefined) {
    parts.push("LIMIT -1");
    parts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`);
  } else {
    if (limit !== undefined) {
      parts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`);
    }
    if (offset !== undefined) {
      parts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`);
    }
  }
  return parts.join(" ");
}

function rejectStructuredRelations(payload: AthenaFetchPayload): void {
  const select = payload.select;
  if (select && typeof select === "object" && !Array.isArray(select)) {
    for (const value of Object.values(select)) {
      if (value && typeof value === "object") {
        throw new D1SqlCompileError(
          "relations_unsupported",
          "Nested relation selects are unsupported on D1 edge-local"
        );
      }
    }
  }
  if (payload.view_name) {
    throw new D1SqlCompileError(
      "view_unsupported",
      "view_name is unsupported on D1 edge-local L1"
    );
  }
}

function jsonValue(value: AthenaJsonValue | undefined): unknown {
  if (value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Compile flat gateway fetch to SQLite SELECT.
 * When `head: true`, compiles a COUNT(*) query (no row body).
 */
export function compileD1Fetch(payload: AthenaFetchPayload): D1CompiledSql {
  rejectStructuredRelations(payload);
  const table = payload.table_name?.trim();
  if (!table) {
    throw new D1SqlCompileError(
      "missing_table",
      "table_name is required for fetch"
    );
  }

  // Structured findMany-style select object with only column:true flags
  let columns: string[] | string | undefined = payload.columns;
  if (
    payload.select &&
    typeof payload.select === "object" &&
    !Array.isArray(payload.select)
  ) {
    const keys = Object.entries(payload.select)
      .filter(([, enabled]) => enabled === true || enabled === 1)
      .map(([key]) => key);
    if (keys.length > 0) {
      columns = keys;
    }
  } else if (typeof payload.select === "string" && payload.select.trim()) {
    columns = payload.select;
  }

  let where = buildWhere(payload.conditions);
  // Also map simple where object if present (eq only)
  if (!where.sql && payload.where && typeof payload.where === "object") {
    const eqConditions: AthenaGatewayCondition[] = Object.entries(
      payload.where as AthenaJsonObject
    ).map(([column, value]) => ({
      column,
      operator: "eq" as const,
      value: value as AthenaGatewayCondition["value"],
    }));
    where = buildWhere(eqConditions);
  }

  if (payload.head === true) {
    // Head-only: return count metadata without row payloads.
    return compileD1CountFromWhere(table, where);
  }

  const parts = [
    `SELECT ${selectClause(columns)} FROM ${quoteIdent(table)}`,
    where.sql,
    orderClause(payload.sort_by),
    limitOffsetClause(payload),
  ].filter(Boolean);
  return asSingle(parts.join(" "), where.params);
}

/**
 * COUNT(*) for the same filters as a fetch (used for head and exact totals).
 */
export function compileD1Count(payload: AthenaFetchPayload): D1CompiledSql {
  rejectStructuredRelations(payload);
  const table = payload.table_name?.trim();
  if (!table) {
    throw new D1SqlCompileError(
      "missing_table",
      "table_name is required for count"
    );
  }
  let where = buildWhere(payload.conditions);
  if (!where.sql && payload.where && typeof payload.where === "object") {
    const eqConditions: AthenaGatewayCondition[] = Object.entries(
      payload.where as AthenaJsonObject
    ).map(([column, value]) => ({
      column,
      operator: "eq" as const,
      value: value as AthenaGatewayCondition["value"],
    }));
    where = buildWhere(eqConditions);
  }
  return compileD1CountFromWhere(table, where);
}

function compileD1CountFromWhere(
  table: string,
  where: { sql: string; params: unknown[] }
): D1CompiledSql {
  const parts = [
    `SELECT COUNT(*) AS __athena_count FROM ${quoteIdent(table)}`,
    where.sql,
  ].filter(Boolean);
  return asSingle(parts.join(" "), where.params);
}

function extractAthenaCount(rows: unknown[]): number {
  const first = rows[0];
  const rawCount =
    first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>).__athena_count
      : undefined;
  const count =
    typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "bigint"
        ? Number(rawCount)
        : Number(rawCount ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export { extractAthenaCount };

function compileSingleRowInsert(
  table: string,
  row: AthenaJsonObject,
  payload: AthenaInsertPayload
): D1CompiledStatement {
  const columns = Object.keys(row);
  if (columns.length === 0) {
    // SQLite allows default-only single-row inserts, but not
    // `DEFAULT VALUES … ON CONFLICT` (D1/SQLite syntax error).
    if (payload.on_conflict) {
      throw new D1SqlCompileError(
        "default_values_upsert_unsupported",
        "DEFAULT VALUES upsert is unsupported on D1 edge-local; provide insert columns or omit onConflict"
      );
    }
    const parts = [`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`];
    if (wantsReturning(payload)) {
      parts.push(`RETURNING ${selectClause(payload.columns)}`);
    }
    return { params: [], sql: parts.join(" ") };
  }
  const params = columns.map((column) => jsonValue(row[column]));
  const parts = [
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})`,
    `VALUES (${columns.map(() => "?").join(", ")})`,
  ];
  appendOnConflict(parts, params, payload, columns);
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }
  return { params, sql: parts.join(" ") };
}

/**
 * Normalize `on_conflict` like gateway `parse_on_conflict_columns`:
 * string or string[] , and comma-separated composite targets (`tenant_id,email`).
 */
function parseOnConflictColumns(onConflict: string | string[]): string[] {
  const raw = Array.isArray(onConflict) ? onConflict : [onConflict];
  const columns: string[] = [];
  for (const item of raw) {
    for (const part of String(item).split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        columns.push(trimmed);
      }
    }
  }
  if (columns.length === 0) {
    throw new D1SqlCompileError(
      "invalid_on_conflict",
      "on_conflict requires at least one column"
    );
  }
  return columns;
}

/**
 * Append ON CONFLICT clause.
 *
 * Parity with crates/athena-query SQLite insert compiler:
 * - explicit non-empty `update_body` → DO UPDATE SET col = ?
 * - explicit empty `update_body` → DO NOTHING
 * - omitted `update_body` (typical `.upsert({...}, { onConflict })`) →
 *   DO UPDATE SET non-conflict cols from `excluded.*`
 */
function appendOnConflict(
  parts: string[],
  params: unknown[],
  payload: AthenaInsertPayload,
  insertColumns: string[]
): void {
  if (!payload.on_conflict) {
    return;
  }
  const conflictCols = parseOnConflictColumns(payload.on_conflict);
  const conflictSql = conflictCols.map(quoteIdent).join(", ");

  if (payload.update_body !== undefined && payload.update_body !== null) {
    const entries = Object.entries(payload.update_body);
    if (entries.length === 0) {
      parts.push(`ON CONFLICT (${conflictSql}) DO NOTHING`);
      return;
    }
    const assignments = entries.map(([column, value]) => {
      params.push(jsonValue(value as AthenaJsonValue));
      return `${quoteIdent(column)} = ?`;
    });
    parts.push(
      `ON CONFLICT (${conflictSql}) DO UPDATE SET ${assignments.join(", ")}`
    );
    return;
  }

  const conflictSet = new Set(conflictCols);
  const assignments = insertColumns
    .filter((column) => !conflictSet.has(column))
    .map((column) => {
      const quoted = quoteIdent(column);
      return `${quoted} = excluded.${quoted}`;
    });
  if (assignments.length === 0) {
    parts.push(`ON CONFLICT (${conflictSql}) DO NOTHING`);
  } else {
    parts.push(
      `ON CONFLICT (${conflictSql}) DO UPDATE SET ${assignments.join(", ")}`
    );
  }
}

/**
 * Compile insert / upsert for D1.
 *
 * SQLite does not allow `DEFAULT` inside multi-row VALUES tuples. Sparse multi-row
 * inserts without `default_to_null` become a batch of single-row inserts so omitted
 * columns keep true DB defaults.
 */
export function compileD1Insert(payload: AthenaInsertPayload): D1CompiledSql {
  const table = payload.table_name?.trim();
  if (!table) {
    throw new D1SqlCompileError(
      "missing_table",
      "table_name is required for insert"
    );
  }

  const rows = Array.isArray(payload.insert_body)
    ? payload.insert_body
    : [payload.insert_body];
  if (rows.length === 0) {
    throw new D1SqlCompileError(
      "empty_insert",
      "insert_body must not be empty"
    );
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      columns.push(key);
    }
  }

  // Single empty object → DEFAULT VALUES (all columns use table defaults).
  if (columns.length === 0) {
    if (rows.length === 1) {
      const compiled = compileSingleRowInsert(table, {}, payload);
      return asSingle(compiled.sql, compiled.params);
    }
    throw new D1SqlCompileError(
      "empty_insert",
      "Multi-row insert_body cannot be empty objects; use a single {} for DEFAULT VALUES"
    );
  }

  const forceNullForMissing = payload.default_to_null === true;
  const isSparse = rows.some((row) =>
    columns.some((column) => !Object.hasOwn(row, column))
  );

  // Sparse multi-row without NULL coercion: one INSERT per row with only present columns.
  if (isSparse && !forceNullForMissing && rows.length > 1) {
    return asBatch(
      rows.map((row) =>
        compileSingleRowInsert(table, row as AthenaJsonObject, payload)
      )
    );
  }

  // Single-row sparse without default_to_null: only insert present columns.
  if (isSparse && !forceNullForMissing && rows.length === 1) {
    const compiled = compileSingleRowInsert(
      table,
      rows[0] as AthenaJsonObject,
      payload
    );
    return asSingle(compiled.sql, compiled.params);
  }

  const params: unknown[] = [];
  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      const has = Object.hasOwn(row, column);
      if (!has) {
        // Only when default_to_null: bind explicit NULL (valid in VALUES).
        params.push(null);
        return "?";
      }
      params.push(jsonValue((row as AthenaJsonObject)[column]));
      return "?";
    });
    return `(${placeholders.join(", ")})`;
  });

  const parts = [
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})`,
    `VALUES ${valueGroups.join(", ")}`,
  ];
  appendOnConflict(parts, params, payload, columns);
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }

  return asSingle(parts.join(" "), params);
}

/**
 * Compile update with required filters.
 * Pagination / sort bounds use a unique-identity IN (subquery) so only one page is updated.
 */
export function compileD1Update(
  payload: AthenaUpdatePayload,
  options?: D1CompileOptions
): D1CompiledSql {
  const table = payload.table_name?.trim();
  if (!table) {
    throw new D1SqlCompileError(
      "missing_table",
      "table_name is required for update"
    );
  }
  const entries = Object.entries(payload.update_body ?? {});
  if (entries.length === 0) {
    throw new D1SqlCompileError(
      "empty_update",
      "update_body must not be empty"
    );
  }

  const params: unknown[] = [];
  const assignments = entries.map(([column, value]) => {
    params.push(jsonValue(value as AthenaJsonValue));
    return `${quoteIdent(column)} = ?`;
  });

  const where = buildWhere(payload.conditions);
  if (!where.sql) {
    throw new D1SqlCompileError(
      "unfiltered_update",
      "UPDATE requires at least one condition on D1 edge-local"
    );
  }

  if (hasPaginationBounds(payload) || payload.sort_by) {
    if (!hasPaginationBounds(payload)) {
      throw new D1SqlCompileError(
        "order_without_bounds",
        "UPDATE with sort_by requires limit/offset or page_size/current_page on D1 edge-local"
      );
    }
    const bounded = boundedRowidInClause(
      table,
      where.sql,
      where.params,
      {
        ...payload,
        conditions: payload.conditions,
      },
      options
    );
    params.push(...bounded.params);
    const parts = [
      `UPDATE ${quoteIdent(table)} SET ${assignments.join(", ")}`,
      `WHERE ${bounded.sql}`,
    ];
    if (wantsReturning(payload)) {
      parts.push(`RETURNING ${selectClause(payload.columns)}`);
    }
    return asSingle(parts.join(" "), params);
  }

  params.push(...where.params);
  const parts = [
    `UPDATE ${quoteIdent(table)} SET ${assignments.join(", ")}`,
    where.sql,
  ];
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }
  return asSingle(parts.join(" "), params);
}

/**
 * Compile delete with required filters.
 *
 * `payload.resource_id` alone (no column filter) maps to `id = ?` for the common
 * Athena PK path. Explicit `.eq('resource_id', …)` / other filters are preserved
 * so tables with a real `resource_id` column are not rewritten to `id`.
 */
export function compileD1Delete(
  payload: AthenaDeletePayload,
  options?: D1CompileOptions
): D1CompiledSql {
  const table = payload.table_name?.trim();
  if (!table) {
    throw new D1SqlCompileError(
      "missing_table",
      "table_name is required for delete"
    );
  }

  const conditions: AthenaGatewayCondition[] = [...(payload.conditions ?? [])];
  if (payload.resource_id !== undefined && payload.resource_id !== null) {
    const hasResourceIdFilter = conditions.some((condition) => {
      const column = (condition.column ?? condition.eq_column ?? "").trim();
      return column === "resource_id";
    });
    const hasIdFilter = conditions.some((condition) => {
      const column = (condition.column ?? condition.eq_column ?? "").trim();
      return column === "id";
    });
    // Only invent `id = resource_id` when the caller did not already filter by
    // resource_id or id (e.g. delete({ resourceId }) with no eq conditions).
    if (!(hasResourceIdFilter || hasIdFilter)) {
      conditions.unshift({
        column: "id",
        operator: "eq",
        value: payload.resource_id,
      });
    }
  }

  const where = buildWhere(conditions);
  if (!where.sql) {
    throw new D1SqlCompileError(
      "unfiltered_delete",
      "DELETE requires at least one condition or resource_id on D1 edge-local"
    );
  }

  if (hasPaginationBounds(payload) || payload.sort_by) {
    if (!hasPaginationBounds(payload)) {
      throw new D1SqlCompileError(
        "order_without_bounds",
        "DELETE with sort_by requires limit/offset or page_size/current_page on D1 edge-local"
      );
    }
    const bounded = boundedRowidInClause(
      table,
      where.sql,
      where.params,
      {
        ...payload,
        conditions,
      },
      options
    );
    const parts = [`DELETE FROM ${quoteIdent(table)}`, `WHERE ${bounded.sql}`];
    if (wantsReturning(payload)) {
      parts.push(`RETURNING ${selectClause(payload.columns)}`);
    }
    return asSingle(parts.join(" "), bounded.params);
  }

  const parts = [`DELETE FROM ${quoteIdent(table)}`, where.sql];
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }
  return asSingle(parts.join(" "), where.params);
}
