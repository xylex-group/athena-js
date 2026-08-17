import type {
  AthenaConditionCastType,
  AthenaConditionValue,
  AthenaDeletePayload,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaJsonValue,
  AthenaRpcFilter,
  AthenaRpcPayload,
  AthenaSortBy,
  AthenaUpdatePayload,
} from "./gateway/types.ts";
import { resolvePagination } from "./query-transport.ts";
import {
  quoteQualifiedIdentifier,
  quoteSelectColumnsExpression,
  quoteSelectColumnToken,
} from "./sql-identifiers.ts";

const SAFE_CAST_PATTERN = /^[a-z_][a-z0-9_]*(?:\[\])?$/i;

function normalizeCast(cast: AthenaConditionCastType): string {
  const normalized = cast.trim().toLowerCase();
  if (!SAFE_CAST_PATTERN.test(normalized)) {
    throw new Error(`Invalid cast type "${cast}"`);
  }
  return normalized;
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function toSqlLiteral(value: AthenaConditionValue): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return `'${escapeSqlStringLiteral(value)}'`;
}

function withCast(expression: string, cast?: AthenaConditionCastType): string {
  if (!cast) {
    return expression;
  }
  return `${expression}::${normalizeCast(cast)}`;
}

function buildSelectColumnsClause(columns: string | string[]): string {
  if (Array.isArray(columns)) {
    return columns.map((column) => quoteSelectColumnToken(column)).join(", ");
  }
  return quoteSelectColumnsExpression(columns);
}

interface ParsedIdentifierSegment {
  normalizedValue: string;
}

function parseIdentifierSegment(input: string): ParsedIdentifierSegment | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.startsWith('"')) {
    return {
      normalizedValue: trimmed.toLowerCase(),
    };
  }

  let value = "";
  let index = 1;
  let closed = false;
  while (index < trimmed.length) {
    const char = trimmed[index];
    const next = index + 1 < trimmed.length ? trimmed[index + 1] : "";
    if (char === '"' && next === '"') {
      value += '"';
      index += 2;
      continue;
    }
    if (char === '"') {
      closed = true;
      index += 1;
      break;
    }
    value += char;
    index += 1;
  }

  if (!closed || trimmed.slice(index).trim().length > 0 || !value.trim()) {
    return null;
  }

  return {
    normalizedValue: value,
  };
}

function splitQualifiedTableName(
  tableName: string
): { schemaSegment: string } | null {
  const trimmed = tableName.trim();
  let inQuotes = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    const next = index + 1 < trimmed.length ? trimmed[index + 1] : "";
    if (char === '"') {
      if (inQuotes && next === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "." && !inQuotes) {
      const schemaSegment = trimmed.slice(0, index).trim();
      const tableSegment = trimmed.slice(index + 1).trim();
      if (!(schemaSegment && tableSegment)) {
        return null;
      }
      return { schemaSegment };
    }
  }
  return null;
}

export function resolveTableNameForCall(
  tableName: string,
  schema: string | undefined
): string {
  if (!schema) {
    return tableName;
  }
  const normalizedSchema = schema.trim();
  if (!normalizedSchema) {
    throw new Error("schema option must be a non-empty string");
  }
  const normalizedTableName = tableName.trim();
  const parsedSchema = parseIdentifierSegment(normalizedSchema);
  if (!parsedSchema) {
    throw new Error("schema option must be a non-empty string");
  }
  const qualified = splitQualifiedTableName(normalizedTableName);
  if (qualified) {
    const parsedTableSchema = parseIdentifierSegment(qualified.schemaSegment);
    const sameSchema = parsedTableSchema
      ? parsedTableSchema.normalizedValue === parsedSchema.normalizedValue
      : normalizedTableName.startsWith(`${normalizedSchema}.`);
    if (sameSchema) {
      return normalizedTableName;
    }
    throw new Error(
      `schema option "${normalizedSchema}" conflicts with schema-qualified table "${normalizedTableName}"`
    );
  }
  return `${normalizedSchema}.${normalizedTableName}`;
}

function conditionToSqlClause(
  condition: AthenaGatewayCondition
): string | null {
  if (!condition.column) {
    return null;
  }
  const column = withCast(
    quoteQualifiedIdentifier(condition.column),
    condition.column_cast
  );
  const value = condition.value;
  const sqlOperator = {
    eq: "=",
    gt: ">",
    gte: ">=",
    ilike: "ILIKE",
    like: "LIKE",
    lt: "<",
    lte: "<=",
    neq: "!=",
  } as const;

  switch (condition.operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike": {
      if (Array.isArray(value) || value === undefined) {
        return null;
      }
      const rhs = withCast(toSqlLiteral(value), condition.value_cast);
      return `${column} ${sqlOperator[condition.operator]} ${rhs}`;
    }
    case "is": {
      if (value === null) {
        return `${column} IS NULL`;
      }
      if (value === true) {
        return `${column} IS TRUE`;
      }
      if (value === false) {
        return `${column} IS FALSE`;
      }
      return null;
    }
    case "in": {
      if (!Array.isArray(value)) {
        return null;
      }
      if (value.length === 0) {
        return "FALSE";
      }
      const values = value.map((item) =>
        withCast(toSqlLiteral(item), condition.value_cast)
      );
      return `${column} IN (${values.join(", ")})`;
    }
    default:
      return null;
  }
}

export function buildTypedSelectQuery(input: {
  tableName: string;
  columns: string | string[];
  conditions: AthenaGatewayCondition[];
  limit?: number;
  offset?: number;
  currentPage?: number;
  pageSize?: number;
  order?: AthenaSortBy;
}): string | null {
  const whereClauses: string[] = [];
  for (const condition of input.conditions) {
    const clause = conditionToSqlClause(condition);
    if (!clause) {
      return null;
    }
    whereClauses.push(clause);
  }

  let limit = input.limit;
  let offset = input.offset;
  if (limit === undefined && input.pageSize !== undefined) {
    limit = input.pageSize;
  }
  if (
    offset === undefined &&
    input.pageSize !== undefined &&
    input.currentPage !== undefined &&
    input.currentPage > 0
  ) {
    offset = (input.currentPage - 1) * input.pageSize;
  }

  const sqlParts = [
    `SELECT ${buildSelectColumnsClause(input.columns)} FROM ${quoteQualifiedIdentifier(input.tableName)}`,
  ];

  if (whereClauses.length > 0) {
    sqlParts.push(`WHERE ${whereClauses.join(" AND ")}`);
  }

  if (input.order?.field) {
    const direction = input.order.direction === "descending" ? "DESC" : "ASC";
    sqlParts.push(
      `ORDER BY ${quoteQualifiedIdentifier(input.order.field)} ${direction}`
    );
  }

  if (limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`);
  }

  if (offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`);
  }

  return `${sqlParts.join(" ")};`;
}

export function buildIncludeJoinSelectQuery(input: {
  tableName: string;
  columns: string | string[];
  conditions: AthenaGatewayCondition[];
  relations: readonly {
    columns?: readonly string[];
    name: string;
    sourceColumns?: readonly string[];
    star?: boolean;
    targetColumns?: readonly string[];
    targetModel?: string;
    targetSchema?: string;
    via?: string;
  }[];
  limit?: number;
  offset?: number;
  order?: AthenaSortBy;
}): string | null {
  if (input.relations.length === 0) {
    return null;
  }
  const rootAlias = "root";
  const rootTable = quoteQualifiedIdentifier(input.tableName);
  const rawColumns = (
    Array.isArray(input.columns) ? input.columns : [input.columns]
  )
    .map((column) => column.trim())
    .filter(Boolean);
  const isStar = rawColumns.length === 0 || rawColumns.includes("*");
  const selectParts = isStar
    ? [`${rootAlias}.*`]
    : rawColumns.map(
        (column) =>
          `${rootAlias}.${quoteQualifiedIdentifier(column)} AS ${quoteQualifiedIdentifier(column)}`
      );

  const joinParts: string[] = [];
  for (const relation of input.relations) {
    const targetTable = [
      relation.targetSchema,
      relation.via ?? relation.targetModel,
    ]
      .filter(Boolean)
      .join(".");
    if (!targetTable) {
      return null;
    }
    const source = relation.sourceColumns ?? [];
    const target = relation.targetColumns ?? [];
    if (source.length === 0 || source.length !== target.length) {
      return null;
    }
    const alias = quoteQualifiedIdentifier(relation.name);
    const ons = source.map(
      (column, index) =>
        `${rootAlias}.${quoteQualifiedIdentifier(column)} = ${alias}.${quoteQualifiedIdentifier(target[index] as string)}`
    );
    joinParts.push(
      `LEFT JOIN ${quoteQualifiedIdentifier(targetTable)} AS ${alias} ON ${ons.join(" AND ")}`
    );
    if (relation.star || !relation.columns?.length) {
      selectParts.push(`${alias}.*`);
    } else {
      for (const column of relation.columns) {
        selectParts.push(
          `${alias}.${quoteQualifiedIdentifier(column)} AS ${quoteQualifiedIdentifier(`${relation.name}.${column}`)}`
        );
      }
    }
  }

  const whereClauses: string[] = [];
  for (const condition of input.conditions) {
    const clause = conditionToSqlClause(condition);
    if (!clause) {
      return null;
    }
    whereClauses.push(clause.replace(/^"([^"]+)"/, `${rootAlias}."$1"`));
  }

  const sqlParts = [
    `SELECT ${selectParts.join(", ")} FROM ${rootTable} AS ${rootAlias}`,
    ...joinParts,
  ];
  if (whereClauses.length > 0) {
    sqlParts.push(`WHERE ${whereClauses.join(" AND ")}`);
  }
  if (input.order?.field) {
    const direction = input.order.direction === "descending" ? "DESC" : "ASC";
    sqlParts.push(
      `ORDER BY ${rootAlias}.${quoteQualifiedIdentifier(input.order.field)} ${direction}`
    );
  }
  if (input.limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(input.limit))}`);
  }
  if (input.offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(input.offset))}`);
  }
  return `${sqlParts.join(" ")};`;
}

function sanitizeSqlComment(comment: string): string {
  return comment.replace(/\*\//g, "* /");
}

function toSqlJsonLiteral(value: AthenaJsonValue | undefined): string {
  if (value === undefined) {
    return "DEFAULT";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return toSqlLiteral(value);
  }
  return `'${escapeSqlStringLiteral(JSON.stringify(value))}'::jsonb`;
}

function conditionToDebugSqlClause(condition: AthenaGatewayCondition): string {
  const exact = conditionToSqlClause(condition);
  if (exact) {
    return exact;
  }

  const rawCondition = sanitizeSqlComment(JSON.stringify(condition));
  if (!condition.column) {
    return `TRUE /* unsupported condition: ${rawCondition} */`;
  }

  const column = withCast(
    quoteQualifiedIdentifier(condition.column),
    condition.column_cast
  );
  const value = condition.value;
  const rhs = withCast(
    toSqlJsonLiteral(value as AthenaJsonValue | undefined),
    condition.value_cast
  );

  switch (condition.operator) {
    case "contains":
      return `${column} @> ${rhs}`;
    case "containedBy":
      return `${column} <@ ${rhs}`;
    case "not":
      return `TRUE /* NOT expression passthrough: ${rawCondition} */`;
    case "or":
      return `TRUE /* OR expression passthrough: ${rawCondition} */`;
    default:
      return `TRUE /* unsupported condition: ${rawCondition} */`;
  }
}

function appendOrderLimitOffset(
  sqlParts: string[],
  order?: AthenaSortBy,
  limit?: number,
  offset?: number
) {
  if (order?.field) {
    const direction = order.direction === "descending" ? "DESC" : "ASC";
    sqlParts.push(
      `ORDER BY ${quoteQualifiedIdentifier(order.field)} ${direction}`
    );
  }
  if (limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`);
  }
  if (offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`);
  }
}

export function buildDebugSelectQuery(input: {
  tableName: string;
  columns: string | string[];
  conditions?: AthenaGatewayCondition[];
  limit?: number;
  offset?: number;
  currentPage?: number;
  pageSize?: number;
  order?: AthenaSortBy;
}): string {
  const sqlParts = [
    `SELECT ${buildSelectColumnsClause(input.columns)} FROM ${quoteQualifiedIdentifier(input.tableName)}`,
  ];
  if (input.conditions?.length) {
    const whereClauses = input.conditions.map(conditionToDebugSqlClause);
    sqlParts.push(`WHERE ${whereClauses.join(" AND ")}`);
  }
  const pagination = resolvePagination(input);
  appendOrderLimitOffset(
    sqlParts,
    input.order,
    pagination.limit,
    pagination.offset
  );
  return `${sqlParts.join(" ")};`;
}

function resolveDebugTableIdentifier(tableName: string | undefined): string {
  if (!tableName?.trim()) {
    return '"__unknown_table__"';
  }
  return quoteQualifiedIdentifier(tableName);
}

export function buildInsertDebugSql(payload: AthenaInsertPayload): string {
  const rows = Array.isArray(payload.insert_body)
    ? payload.insert_body
    : [payload.insert_body];
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seen.has(column)) {
        continue;
      }
      seen.add(column);
      columns.push(column);
    }
  }

  const sqlParts = [
    `INSERT INTO ${quoteQualifiedIdentifier(payload.table_name)}`,
  ];

  if (rows.length && columns.length) {
    const valuesClause = rows
      .map((row) => {
        const values = columns.map((column) => {
          const hasColumn = Object.hasOwn(row, column);
          if (!hasColumn) {
            return payload.default_to_null ? "NULL" : "DEFAULT";
          }
          const rowValue = (row as Record<string, AthenaJsonValue | undefined>)[
            column
          ];
          return toSqlJsonLiteral(rowValue);
        });
        return `(${values.join(", ")})`;
      })
      .join(", ");
    const columnClause = columns
      .map((column) => quoteQualifiedIdentifier(column))
      .join(", ");
    sqlParts.push(`(${columnClause})`);
    sqlParts.push(`VALUES ${valuesClause}`);
  } else {
    sqlParts.push("DEFAULT VALUES");
    if (rows.length > 1) {
      sqlParts.push(
        `/* trace: ${rows.length} rows collapsed to DEFAULT VALUES */`
      );
    }
  }

  if (payload.on_conflict) {
    const conflictColumns = Array.isArray(payload.on_conflict)
      ? payload.on_conflict
          .map((column) => quoteQualifiedIdentifier(column))
          .join(", ")
      : payload.on_conflict;
    if (payload.update_body && Object.keys(payload.update_body).length > 0) {
      const assignments = Object.entries(payload.update_body).map(
        ([column, value]) =>
          `${quoteQualifiedIdentifier(column)} = ${toSqlJsonLiteral(value as AthenaJsonValue)}`
      );
      sqlParts.push(
        `ON CONFLICT (${conflictColumns}) DO UPDATE SET ${assignments.join(", ")}`
      );
    } else {
      sqlParts.push(`ON CONFLICT (${conflictColumns}) DO NOTHING`);
    }
  }

  if (payload.columns) {
    sqlParts.push(`RETURNING ${buildSelectColumnsClause(payload.columns)}`);
  }

  return `${sqlParts.join(" ")};`;
}

export function buildUpdateDebugSql(payload: AthenaUpdatePayload): string {
  const assignments = Object.entries(payload.update_body).map(
    ([column, value]) =>
      `${quoteQualifiedIdentifier(column)} = ${toSqlJsonLiteral(value as AthenaJsonValue)}`
  );
  const sqlParts = [
    `UPDATE ${resolveDebugTableIdentifier(payload.table_name)} SET ${assignments.length ? assignments.join(", ") : "/* empty set */"}`,
  ];
  if (payload.conditions?.length) {
    const whereClauses = payload.conditions.map(conditionToDebugSqlClause);
    sqlParts.push(`WHERE ${whereClauses.join(" AND ")}`);
  }
  const pagination = resolvePagination({
    currentPage: payload.current_page,
    limit: payload.limit,
    offset: payload.offset,
    pageSize: payload.page_size,
  });
  appendOrderLimitOffset(
    sqlParts,
    payload.sort_by,
    pagination.limit,
    pagination.offset
  );
  if (payload.columns) {
    sqlParts.push(`RETURNING ${buildSelectColumnsClause(payload.columns)}`);
  }
  return `${sqlParts.join(" ")};`;
}

export function buildDeleteDebugSql(payload: AthenaDeletePayload): string {
  const sqlParts = [
    `DELETE FROM ${quoteQualifiedIdentifier(payload.table_name)}`,
  ];
  const whereClauses: string[] = [];
  if (payload.resource_id) {
    whereClauses.push(`"resource_id" = ${toSqlLiteral(payload.resource_id)}`);
  }
  if (payload.conditions?.length) {
    whereClauses.push(...payload.conditions.map(conditionToDebugSqlClause));
  }
  if (whereClauses.length) {
    sqlParts.push(`WHERE ${whereClauses.join(" AND ")}`);
  }
  const pagination = resolvePagination({
    currentPage: payload.current_page,
    limit: payload.limit,
    offset: payload.offset,
    pageSize: payload.page_size,
  });
  appendOrderLimitOffset(
    sqlParts,
    payload.sort_by,
    pagination.limit,
    pagination.offset
  );
  if (payload.columns) {
    sqlParts.push(`RETURNING ${buildSelectColumnsClause(payload.columns)}`);
  }
  return `${sqlParts.join(" ")};`;
}

function rpcFilterToSqlClause(filter: AthenaRpcFilter): string {
  const column = quoteQualifiedIdentifier(filter.column);
  const value = filter.value;
  switch (filter.operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike": {
      if (value === undefined || Array.isArray(value)) {
        return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`;
      }
      const operatorMap = {
        eq: "=",
        gt: ">",
        gte: ">=",
        ilike: "ILIKE",
        like: "LIKE",
        lt: "<",
        lte: "<=",
        neq: "!=",
      } as const;
      return `${column} ${operatorMap[filter.operator]} ${toSqlLiteral(value)}`;
    }
    case "is":
      if (value === null) {
        return `${column} IS NULL`;
      }
      if (value === true) {
        return `${column} IS TRUE`;
      }
      if (value === false) {
        return `${column} IS FALSE`;
      }
      return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`;
    case "in":
      if (!Array.isArray(value)) {
        return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`;
      }
      if (value.length === 0) {
        return "FALSE";
      }
      return `${column} IN (${value.map((item) => toSqlLiteral(item)).join(", ")})`;
    default:
      return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`;
  }
}

export function buildRpcDebugSql(payload: AthenaRpcPayload): string {
  const argsEntries = payload.args ? Object.entries(payload.args) : [];
  const argsClause = argsEntries
    .map(
      ([key, value]) =>
        `${quoteQualifiedIdentifier(key)} => ${toSqlJsonLiteral(value as AthenaJsonValue)}`
    )
    .join(", ");
  const functionRef = payload.schema
    ? `${quoteQualifiedIdentifier(payload.schema)}.${quoteQualifiedIdentifier(payload.function)}`
    : quoteQualifiedIdentifier(payload.function);
  const sqlParts = [
    `SELECT ${payload.select ? quoteSelectColumnsExpression(payload.select) : "*"} FROM ${functionRef}(${argsClause})`,
  ];
  if (payload.filters?.length) {
    sqlParts.push(
      `WHERE ${payload.filters.map(rpcFilterToSqlClause).join(" AND ")}`
    );
  }
  if (payload.order?.column) {
    const direction = payload.order.ascending === false ? "DESC" : "ASC";
    sqlParts.push(
      `ORDER BY ${quoteQualifiedIdentifier(payload.order.column)} ${direction}`
    );
  }
  if (payload.limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(payload.limit))}`);
  }
  if (payload.offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(payload.offset))}`);
  }
  return `${sqlParts.join(" ")};`;
}
