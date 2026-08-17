/**
 * PostgreSQL parameterized SQL compiler for flat gateway payloads.
 * Emits `$1..$n` binds (never string-interpolated values).
 * Mirrors D1 L1 surface with PG-native ILIKE / @> / <@ and schema-qualified names.
 */

import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaRpcPayload,
  AthenaSortBy,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
import { quoteQualifiedIdentifier } from "../sql-identifiers.ts";
import {
  compileLegacyBooleanNode,
  LegacyBooleanParseError,
  parseLegacyBooleanExpression,
} from "../query/legacy-boolean.ts";

export interface PostgresCompiledQuery {
  text: string;
  values: unknown[];
}

export interface PostgresCompileOptions {
  /**
   * Proven single-column unique identity for bounded UPDATE/DELETE
   * (PK or UNIQUE). Required when limit/offset/page bounds are set.
   */
  identityColumn?: string;
}

export class PostgresSqlCompileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PostgresSqlCompileError";
    this.code = code;
  }
}

/** Simple/qualified SQL identifier: letter/underscore start, optional schema segments. */
const SAFE_QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Response alias form: `user_id:id` → `"id" AS "user_id"`. */
const RESPONSE_ALIAS_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)$/;
/** SQL alias form: `id as user_id` or `id user_id`. */
const SQL_ALIAS_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_.]*)\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)$/i;

const SAFE_CASTS = new Set([
  "text",
  "uuid",
  "int",
  "integer",
  "bigint",
  "boolean",
  "bool",
  "numeric",
  "float",
  "double",
  "json",
  "jsonb",
  "date",
  "timestamp",
  "timestamptz",
]);

class Binder {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
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
    throw new PostgresSqlCompileError(
      "page_without_size",
      "current_page requires page_size (or limit) for bounded update/delete on PostgreSQL direct"
    );
  }
  const clause = limitOffsetClause(payload);
  if (!clause.trim()) {
    throw new PostgresSqlCompileError(
      "invalid_pagination_bounds",
      "Bounded update/delete requires limit, offset, and/or page_size on PostgreSQL direct"
    );
  }
}

function quoteIdent(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new PostgresSqlCompileError(
      "invalid_identifier",
      "Identifier is required"
    );
  }
  if (!SAFE_QUALIFIED.test(trimmed)) {
    throw new PostgresSqlCompileError(
      "invalid_identifier",
      `Invalid SQL identifier for PostgreSQL direct: ${trimmed}`
    );
  }
  return quoteQualifiedIdentifier(trimmed);
}

function quoteSelectTokenStrict(token: string): string {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "*") {
    return trimmed || "*";
  }

  if (SAFE_QUALIFIED.test(trimmed)) {
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

  throw new PostgresSqlCompileError(
    "unsafe_select",
    `SELECT/RETURNING expressions are not supported on PostgreSQL direct; use column names or aliases only: ${token}`
  );
}

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

function wantsReturning(payload: {
  columns?: string[] | string;
  head?: boolean;
}): boolean {
  return Boolean(payload.columns) && payload.head !== true;
}

function applyCast(expr: string, cast?: string | null): string {
  if (!cast) {
    return expr;
  }
  const normalized = cast.trim().toLowerCase();
  if (!SAFE_CASTS.has(normalized)) {
    throw new PostgresSqlCompileError(
      "unsupported_cast",
      `Cast type "${cast}" is not allowed on PostgreSQL direct`
    );
  }
  return `${expr}::${normalized}`;
}

/** Bind JSON-ish values; objects become JSON text for driver-neutral jsonb/json. */
function jsonValue(value: AthenaJsonValue | undefined): unknown {
  if (value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // Nested object arrays → JSON text; primitive arrays stay for PG arrays.
    if (value.some((item) => item !== null && typeof item === "object")) {
      return JSON.stringify(value);
    }
  }
  return value;
}

interface WhereClause {
  sql: string;
  values: unknown[];
}

function conditionToWhere(
  condition: AthenaGatewayCondition,
  binder: Binder
): string {
  const column = condition.column?.trim() || condition.eq_column?.trim() || "";
  const operator = (condition.operator || "eq").toLowerCase();
  const value =
    condition.value === undefined ? condition.eq_value : condition.value;

  if (operator === "or" || operator === "not") {
    if (typeof value !== "string") {
      throw new PostgresSqlCompileError(
        "unsupported_operator",
        `Condition operator "${operator}" requires a legacy expression string`
      );
    }
    try {
      const tree = parseLegacyBooleanExpression(
        value,
        operator === "or" ? "or" : "and"
      );
      const compiled = compileLegacyBooleanNode(tree, (predicate) =>
        conditionToWhere(predicate, binder)
      );
      return operator === "not" ? `(NOT (${compiled}))` : compiled;
    } catch (error) {
      if (error instanceof PostgresSqlCompileError) {
        throw error;
      }
      const message =
        error instanceof LegacyBooleanParseError
          ? error.message
          : `Condition operator "${operator}" requires structured AST; raw expressions are rejected on PostgreSQL direct`;
      throw new PostgresSqlCompileError("unsupported_operator", message);
    }
  }

  if (!column) {
    throw new PostgresSqlCompileError(
      "invalid_condition",
      "Condition requires a column"
    );
  }

  const col = applyCast(quoteIdent(column), condition.column_cast);

  const bind = (v: unknown, valueCast?: string | null): string =>
    applyCast(binder.add(v), valueCast ?? condition.value_cast);

  switch (operator) {
    case "eq": {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return "1 = 0";
        }
        const placeholders = value
          .map((item) => bind(item ?? null))
          .join(", ");
        return `${col} IN (${placeholders})`;
      }
      if (value === null) {
        return `${col} IS NULL`;
      }
      return `${col} = ${bind(value ?? null)}`;
    }
    case "neq":
      if (value === null) {
        return `${col} IS NOT NULL`;
      }
      return `${col} <> ${bind(value ?? null)}`;
    case "gt":
      return `${col} > ${bind(value ?? null)}`;
    case "gte":
      return `${col} >= ${bind(value ?? null)}`;
    case "lt":
      return `${col} < ${bind(value ?? null)}`;
    case "lte":
      return `${col} <= ${bind(value ?? null)}`;
    case "like":
      return `${col} LIKE ${bind(value ?? null)}`;
    case "ilike":
      return `${col} ILIKE ${bind(value ?? null)}`;
    case "in": {
      const items = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
      if (items.length === 0) {
        return "1 = 0";
      }
      const placeholders = items.map((item) => bind(item ?? null)).join(", ");
      return `${col} IN (${placeholders})`;
    }
    case "is": {
      if (value === null || value === "null") {
        return `${col} IS NULL`;
      }
      if (value === true || value === "true") {
        return `${col} IS TRUE`;
      }
      if (value === false || value === "false") {
        return `${col} IS FALSE`;
      }
      return `${col} IS ${bind(value)}`;
    }
    case "contains": {
      // jsonb object containment or array @>
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return `${col} @> ${bind(JSON.stringify(value))}::jsonb`;
      }
      return `${col} @> ${bind(value ?? null)}`;
    }
    case "containedby": {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return `${col} <@ ${bind(JSON.stringify(value))}::jsonb`;
      }
      return `${col} <@ ${bind(value ?? null)}`;
    }
    default:
      throw new PostgresSqlCompileError(
        "unsupported_operator",
        `Unknown condition operator "${operator}"`
      );
  }
}

function buildWhere(
  conditions: AthenaGatewayCondition[] | undefined
): WhereClause {
  if (!conditions?.length) {
    return { sql: "", values: [] };
  }
  const binder = new Binder();
  const parts: string[] = [];
  for (const condition of conditions) {
    if (!condition.operator && condition.eq_column) {
      parts.push(
        conditionToWhere(
          {
            ...condition,
            column: condition.eq_column,
            operator: "eq",
            value: condition.eq_value,
          },
          binder
        )
      );
      continue;
    }
    parts.push(conditionToWhere(condition, binder));
  }
  return {
    sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    values: binder.values,
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

  if (limit === undefined && payload.page_size !== undefined) {
    limit = payload.page_size;
  }

  if (payload.current_page !== undefined && offset === undefined) {
    const pageSize = payload.page_size ?? payload.limit;
    if (pageSize !== undefined) {
      offset = Math.max(0, (payload.current_page - 1) * pageSize);
    }
  }

  const parts: string[] = [];
  // PostgreSQL allows OFFSET without LIMIT (unlike SQLite/D1).
  if (limit !== undefined) {
    parts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`);
  }
  if (offset !== undefined) {
    parts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`);
  }
  return parts.join(" ");
}

function rejectStructuredRelations(payload: AthenaFetchPayload): void {
  const select = payload.select;
  if (select && typeof select === "object" && !Array.isArray(select)) {
    for (const value of Object.values(select)) {
      if (value && typeof value === "object") {
        throw new PostgresSqlCompileError(
          "relations_unsupported",
          "Nested relation selects are unsupported on PostgreSQL direct"
        );
      }
    }
  }
  if (payload.view_name) {
    throw new PostgresSqlCompileError(
      "view_unsupported",
      "view_name is unsupported on PostgreSQL direct L1"
    );
  }
}

function resolveWhere(payload: {
  conditions?: AthenaGatewayCondition[];
  where?: AthenaJsonObject | Record<string, unknown>;
}): WhereClause {
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
  return where;
}

function resolveBoundedIdentityColumn(
  options?: PostgresCompileOptions
): string {
  const identity = options?.identityColumn?.trim();
  if (!identity) {
    throw new PostgresSqlCompileError(
      "bounded_mutation_no_unique_identity",
      "Bounded update/delete requires a proven unique identity column from the table schema " +
        "(single-column PRIMARY KEY or UNIQUE index). Cannot assume a column named id."
    );
  }
  if (!SAFE_QUALIFIED.test(identity)) {
    throw new PostgresSqlCompileError(
      "bounded_mutation_unsafe_identity",
      `Bounded update/delete cannot use identity column "${identity}"`
    );
  }
  return identity;
}

/**
 * Bounded mutation via unique-identity IN (subquery).
 * Prefer caller-supplied PK/UNIQUE; never invent `id`.
 */
function boundedIdentityInClause(
  table: string,
  whereSql: string,
  whereValues: unknown[],
  payload: {
    limit?: number;
    offset?: number;
    current_page?: number;
    page_size?: number;
    sort_by?: AthenaSortBy;
  },
  options?: PostgresCompileOptions
): { sql: string; values: unknown[] } {
  assertEffectiveMutationBounds(payload);
  const identity = resolveBoundedIdentityColumn(options);
  const identitySql = quoteIdent(identity);
  const tableSql = quoteIdent(table);
  const innerWhere = whereSql.replace(/^WHERE\s+/i, "");
  const parts = [
    `SELECT ${identitySql} FROM ${tableSql}`,
    innerWhere ? `WHERE ${innerWhere}` : "",
    orderClause(payload.sort_by),
    limitOffsetClause(payload),
  ].filter(Boolean);
  return {
    sql: `${identitySql} IN (${parts.join(" ")})`,
    values: [...whereValues],
  };
}

/**
 * Compile flat gateway fetch to PostgreSQL SELECT.
 * When `head: true`, compiles a COUNT(*) query (no row body).
 */
export function compilePostgresFetch(
  payload: AthenaFetchPayload
): PostgresCompiledQuery {
  rejectStructuredRelations(payload);
  const table = payload.table_name?.trim();
  if (!table) {
    throw new PostgresSqlCompileError(
      "missing_table",
      "table_name is required for fetch"
    );
  }

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

  const where = resolveWhere(payload);

  if (payload.head === true) {
    return compilePostgresCountFromWhere(table, where);
  }

  const parts = [
    `SELECT ${selectClause(columns)} FROM ${quoteIdent(table)}`,
    where.sql,
    orderClause(payload.sort_by),
    limitOffsetClause(payload),
  ].filter(Boolean);
  return { text: parts.join(" "), values: where.values };
}

/**
 * COUNT(*) for the same filters as a fetch (used for head and exact totals).
 */
export function compilePostgresCount(
  payload: AthenaFetchPayload
): PostgresCompiledQuery {
  rejectStructuredRelations(payload);
  const table = payload.table_name?.trim();
  if (!table) {
    throw new PostgresSqlCompileError(
      "missing_table",
      "table_name is required for count"
    );
  }
  const where = resolveWhere(payload);
  return compilePostgresCountFromWhere(table, where);
}

function compilePostgresCountFromWhere(
  table: string,
  where: WhereClause
): PostgresCompiledQuery {
  const parts = [
    `SELECT COUNT(*)::bigint AS __athena_count FROM ${quoteIdent(table)}`,
    where.sql,
  ].filter(Boolean);
  return { text: parts.join(" "), values: where.values };
}

export function extractAthenaCount(rows: unknown[]): number {
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
    throw new PostgresSqlCompileError(
      "invalid_on_conflict",
      "on_conflict requires at least one column"
    );
  }
  return columns;
}

function appendOnConflict(
  parts: string[],
  binder: Binder,
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
      const ph = binder.add(jsonValue(value as AthenaJsonValue));
      return `${quoteIdent(column)} = ${ph}`;
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
      return `${quoted} = EXCLUDED.${quoted}`;
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
 * Compile insert / upsert for PostgreSQL.
 * Sparse multi-row uses DEFAULT for omitted columns (PG allows DEFAULT in VALUES).
 */
export function compilePostgresInsert(
  payload: AthenaInsertPayload
): PostgresCompiledQuery {
  const table = payload.table_name?.trim();
  if (!table) {
    throw new PostgresSqlCompileError(
      "missing_table",
      "table_name is required for insert"
    );
  }

  const rows = Array.isArray(payload.insert_body)
    ? payload.insert_body
    : [payload.insert_body];
  if (rows.length === 0) {
    throw new PostgresSqlCompileError(
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

  const binder = new Binder();
  const tableSql = quoteIdent(table);

  if (columns.length === 0) {
    if (rows.length !== 1) {
      throw new PostgresSqlCompileError(
        "empty_insert",
        "Multi-row insert_body cannot be empty objects; use a single {} for DEFAULT VALUES"
      );
    }
    if (payload.on_conflict) {
      throw new PostgresSqlCompileError(
        "default_values_upsert_unsupported",
        "DEFAULT VALUES upsert is unsupported on PostgreSQL direct; provide insert columns or omit onConflict"
      );
    }
    const parts = [`INSERT INTO ${tableSql} DEFAULT VALUES`];
    if (wantsReturning(payload)) {
      parts.push(`RETURNING ${selectClause(payload.columns)}`);
    }
    return { text: parts.join(" "), values: [] };
  }

  const forceNullForMissing = payload.default_to_null === true;

  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      const has = Object.hasOwn(row ?? {}, column);
      if (!has) {
        if (forceNullForMissing) {
          return binder.add(null);
        }
        return "DEFAULT";
      }
      return binder.add(jsonValue((row as AthenaJsonObject)[column]));
    });
    return `(${placeholders.join(", ")})`;
  });

  const parts = [
    `INSERT INTO ${tableSql} (${columns.map(quoteIdent).join(", ")})`,
    `VALUES ${valueGroups.join(", ")}`,
  ];
  appendOnConflict(parts, binder, payload, columns);
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }

  return { text: parts.join(" "), values: binder.values };
}

/**
 * Compile update with required filters.
 * Pagination / sort bounds use a unique-identity IN (subquery).
 */
export function compilePostgresUpdate(
  payload: AthenaUpdatePayload,
  options?: PostgresCompileOptions
): PostgresCompiledQuery {
  const table = payload.table_name?.trim();
  if (!table) {
    throw new PostgresSqlCompileError(
      "missing_table",
      "table_name is required for update"
    );
  }
  const entries = Object.entries(payload.update_body ?? {});
  if (entries.length === 0) {
    throw new PostgresSqlCompileError(
      "empty_update",
      "update_body must not be empty"
    );
  }

  if (!payload.conditions?.length) {
    throw new PostgresSqlCompileError(
      "unfiltered_update",
      "UPDATE requires at least one condition on PostgreSQL direct"
    );
  }

  const binder = new Binder();
  const assignments = entries.map(([column, value]) => {
    const ph = binder.add(jsonValue(value as AthenaJsonValue));
    return `${quoteIdent(column)} = ${ph}`;
  });

  // WHERE shares the same binder so $n continues after SET values.
  const whereParts: string[] = [];
  for (const condition of payload.conditions) {
    if (!condition.operator && condition.eq_column) {
      whereParts.push(
        conditionToWhere(
          {
            ...condition,
            column: condition.eq_column,
            operator: "eq",
            value: condition.eq_value,
          },
          binder
        )
      );
      continue;
    }
    whereParts.push(conditionToWhere(condition, binder));
  }
  if (whereParts.length === 0) {
    throw new PostgresSqlCompileError(
      "unfiltered_update",
      "UPDATE requires at least one condition on PostgreSQL direct"
    );
  }

  let finalWhere = `WHERE ${whereParts.join(" AND ")}`;

  if (hasPaginationBounds(payload) || payload.sort_by) {
    if (!hasPaginationBounds(payload)) {
      throw new PostgresSqlCompileError(
        "order_without_bounds",
        "UPDATE with sort_by requires limit/offset or page_size/current_page on PostgreSQL direct"
      );
    }
    // Rebuild with SET binds first, then a fresh where-only binder for the IN subquery.
    const setValues = binder.values.slice(0, entries.length);
    const whereOnly = buildWhere(payload.conditions);
    const bound = boundedIdentityInClause(
      table,
      whereOnly.sql,
      whereOnly.values,
      payload,
      options
    );
    binder.values.length = 0;
    binder.values.push(...setValues, ...bound.values);
    finalWhere = `WHERE ${reindexPlaceholders(bound.sql, setValues.length)}`;
  }

  const parts = [
    `UPDATE ${quoteIdent(table)}`,
    `SET ${assignments.join(", ")}`,
    finalWhere,
  ];
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }
  return { text: parts.join(" "), values: binder.values };
}

/** Shift $n placeholders by `offset` (for composing SET + IN-subquery binds). */
function reindexPlaceholders(sql: string, offset: number): string {
  if (!sql || offset === 0) {
    return sql;
  }
  return sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`);
}

/**
 * Compile delete with required filters.
 * Pagination / sort bounds use a unique-identity IN (subquery).
 *
 * `payload.resource_id` alone (no column filter) maps to `id = $n` for the common
 * Athena PK path — same contract as the D1 compiler. Explicit `.eq('resource_id', …)`
 * / other filters are preserved so tables with a real `resource_id` column are not
 * rewritten to `id`.
 */
export function compilePostgresDelete(
  payload: AthenaDeletePayload,
  options?: PostgresCompileOptions
): PostgresCompiledQuery {
  const table = payload.table_name?.trim();
  if (!table) {
    throw new PostgresSqlCompileError(
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
    throw new PostgresSqlCompileError(
      "unfiltered_delete",
      "DELETE requires at least one condition or resource_id on PostgreSQL direct"
    );
  }

  let finalWhere = where.sql;
  let values = where.values;

  if (hasPaginationBounds(payload) || payload.sort_by) {
    if (!hasPaginationBounds(payload)) {
      throw new PostgresSqlCompileError(
        "order_without_bounds",
        "DELETE with sort_by requires limit/offset or page_size/current_page on PostgreSQL direct"
      );
    }
    const bound = boundedIdentityInClause(
      table,
      where.sql,
      where.values,
      payload,
      options
    );
    finalWhere = `WHERE ${bound.sql}`;
    values = bound.values;
  }

  const parts = [`DELETE FROM ${quoteIdent(table)}`, finalWhere];
  if (wantsReturning(payload)) {
    parts.push(`RETURNING ${selectClause(payload.columns)}`);
  }
  return { text: parts.join(" "), values };
}

/**
 * Compile `athena.rpc(fn, args)` to `SELECT … FROM schema.fn(name => $n, …)`.
 * Filters apply to the table-valued result. Values stay bound.
 */
export function compilePostgresRpc(
  payload: AthenaRpcPayload
): PostgresCompiledQuery {
  const name = (payload.function || payload.function_name || "").trim();
  if (!name) {
    throw new PostgresSqlCompileError(
      "missing_function",
      "function is required for rpc"
    );
  }
  const schema = payload.schema?.trim();
  const qualified = schema ? `${schema}.${name}` : name;
  if (!SAFE_QUALIFIED.test(qualified)) {
    throw new PostgresSqlCompileError(
      "invalid_identifier",
      `Invalid RPC function identifier: ${qualified}`
    );
  }

  const binder = new Binder();
  const args =
    payload.args && typeof payload.args === "object" && !Array.isArray(payload.args)
      ? Object.entries(payload.args)
      : [];
  const argSql = args
    .map(([key, value]) => {
      if (!SAFE_QUALIFIED.test(key)) {
        throw new PostgresSqlCompileError(
          "invalid_identifier",
          `Invalid RPC argument name: ${key}`
        );
      }
      return `${quoteIdent(key)} => ${binder.add(jsonValue(value as AthenaJsonValue))}`;
    })
    .join(", ");

  const select = payload.head
    ? "COUNT(*)::bigint AS __athena_count"
    : selectClause(payload.select);
  const parts = [`SELECT ${select} FROM ${quoteIdent(qualified)}(${argSql})`];

  if (payload.filters?.length) {
    const whereParts = payload.filters.map((filter) =>
      conditionToWhere(
        {
          column: filter.column,
          operator: filter.operator,
          value: filter.value as AthenaGatewayCondition["value"],
        },
        binder
      )
    );
    parts.push(`WHERE ${whereParts.join(" AND ")}`);
  }

  if (payload.order?.column?.trim()) {
    const direction = payload.order.ascending === false ? "DESC" : "ASC";
    parts.push(`ORDER BY ${quoteIdent(payload.order.column)} ${direction}`);
  }

  if (!payload.head && payload.limit !== undefined) {
    parts.push(`LIMIT ${Math.max(0, Math.trunc(payload.limit))}`);
  }
  if (!payload.head && payload.offset !== undefined) {
    parts.push(`OFFSET ${Math.max(0, Math.trunc(payload.offset))}`);
  }

  return { text: parts.join(" "), values: binder.values };
}
