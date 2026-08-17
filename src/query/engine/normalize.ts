import type { AthenaGatewayCondition, AthenaSortBy } from "../../gateway/types.ts";
import type {
  AthenaOrderBy,
  AthenaRelationSelectNode,
  AthenaSelectShape,
  AthenaWhere,
  AthenaWhereOperatorInput,
} from "../../query-ast.ts";
import type {
  AthenaCompareOperator,
  AthenaConditionAst,
  AthenaFieldRefAst,
  AthenaOrderAst,
  AthenaPaginationAst,
  AthenaQueryCardinality,
  AthenaRelationPredicate,
  AthenaSelectQueryAst,
  AthenaSelectedFieldAst,
  AthenaSourceAst,
} from "./ast.ts";
import { AthenaQueryError } from "./errors.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMPARE_OPERATORS = new Set<AthenaCompareOperator>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
]);
const RELATION_PREDICATES = new Set<AthenaRelationPredicate>([
  "some",
  "none",
  "every",
  "exists",
  "is",
  "isNot",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!IDENTIFIER.test(trimmed)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_IDENTIFIER",
      `Invalid ${label}: ${value}`
    );
  }
  return trimmed;
}

export function parseSourceName(raw: string): AthenaSourceAst {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SOURCE",
      "Query source table is required"
    );
  }
  const segments = trimmed.split(".").map((segment) => segment.trim());
  if (segments.some((segment) => !IDENTIFIER.test(segment))) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SOURCE",
      `Invalid table identifier: ${raw}`
    );
  }
  if (segments.length === 1) {
    return { kind: "table", table: segments[0] as string };
  }
  if (segments.length === 2) {
    return {
      kind: "table",
      schema: segments[0],
      table: segments[1] as string,
    };
  }
  throw new AthenaQueryError(
    "ATHENA_QUERY_INVALID_SOURCE",
    `Table identifier is too deeply qualified: ${raw}`
  );
}

function isRelationSelectNode(
  value: unknown
): value is AthenaRelationSelectNode {
  return isRecord(value) && isRecord(value.select);
}

function normalizeSelectShape(
  select: AthenaSelectShape,
  parentSource: AthenaSourceAst,
  cardinality: AthenaQueryCardinality
): AthenaSelectedFieldAst[] {
  if (!isRecord(select)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SELECTION",
      "select must be an object"
    );
  }

  const fields: AthenaSelectedFieldAst[] = [];
  for (const [rawKey, rawValue] of Object.entries(select)) {
    if (rawValue === undefined) {
      continue;
    }
    if (rawValue === true) {
      fields.push({
        kind: "column",
        column: assertIdentifier(rawKey, "select column"),
      });
      continue;
    }
    if (!isRelationSelectNode(rawValue)) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_NESTING",
        `Unsupported select node for "${rawKey}"`
      );
    }
    const relationName = assertIdentifier(
      rawValue.via?.trim() || rawKey,
      "select relation"
    );
    const alias =
      rawValue.as?.trim() ||
      (relationName === rawKey ? undefined : assertIdentifier(rawKey, "relation alias"));
    const nestedSource = rawValue.schema?.trim()
      ? {
          kind: "table" as const,
          schema: assertIdentifier(rawValue.schema, "relation schema"),
          table: relationName,
        }
      : parseSourceName(relationName.includes(".") ? relationName : relationName);

    fields.push({
      alias,
      kind: "relation",
      query: {
        cardinality: "many",
        filter: normalizeWhere(rawValue.where),
        kind: "select",
        orderBy: normalizeOrderBy(rawValue.orderBy),
        pagination: normalizePagination({
          limit: rawValue.limit,
          offset: rawValue.offset,
        }),
        selection: {
          fields: normalizeSelectShape(
            rawValue.select,
            nestedSource,
            "many"
          ),
        },
        source: nestedSource.table === relationName && !rawValue.schema
          ? { kind: "table", table: relationName }
          : nestedSource,
      },
      relation: relationName,
      via: rawValue.via?.trim(),
    });
    void parentSource;
    void cardinality;
  }

  if (fields.length === 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SELECTION",
      "select requires at least one field"
    );
  }
  return fields;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === separator && depth === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseSelectList(
  raw: string,
  parentSource: AthenaSourceAst
): AthenaSelectedFieldAst[] {
  const tokens = splitTopLevel(raw, ",");
  if (tokens.length === 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SELECTION",
      "select requires at least one field"
    );
  }

  const fields: AthenaSelectedFieldAst[] = [];
  for (const token of tokens) {
    const open = token.indexOf("(");
    if (open < 0) {
      if (token === "*") {
        fields.push({ kind: "column", column: "*" });
        continue;
      }
      const aliasMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)$/.exec(
        token
      );
      if (aliasMatch) {
        fields.push({
          alias: aliasMatch[1],
          column: aliasMatch[2] as string,
          kind: "column",
        });
        continue;
      }
      fields.push({
        column: assertIdentifier(token.split(".").pop() ?? token, "select column"),
        kind: "column",
      });
      continue;
    }
    if (!token.endsWith(")")) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_NESTING",
        `Malformed relation select token: ${token}`
      );
    }
    const head = token.slice(0, open).trim();
    const inner = token.slice(open + 1, -1);
    const aliasIndex = head.indexOf(":");
    const alias = aliasIndex >= 0 ? head.slice(0, aliasIndex).trim() : undefined;
    const relationToken =
      aliasIndex >= 0 ? head.slice(aliasIndex + 1).trim() : head;
    const bang = relationToken.indexOf("!");
    const relationPath =
      bang >= 0 ? relationToken.slice(0, bang).trim() : relationToken;
    const nestedSource = parseSourceName(relationPath);
    fields.push({
      alias: alias || undefined,
      kind: "relation",
      query: {
        cardinality: "many",
        kind: "select",
        selection: { fields: parseSelectList(inner, nestedSource) },
        source: nestedSource,
      },
      relation: nestedSource.table,
    });
  }
  void parentSource;
  return fields;
}

function fieldRef(field: string): AthenaFieldRefAst {
  return { field: assertIdentifier(field, "field") };
}

function isRelationWhereValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (keys.some((key) => key !== "is" && RELATION_PREDICATES.has(key as AthenaRelationPredicate))) {
    return true;
  }
  return keys.includes("is") && isRecord(value.is);
}

function normalizeRelationPredicate(
  relation: string,
  value: Record<string, unknown>,
  seen: WeakSet<object>,
  path: string
): AthenaConditionAst {
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  const predicateKeys = keys.filter((key) =>
    RELATION_PREDICATES.has(key as AthenaRelationPredicate)
  );
  if (predicateKeys.length !== 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_CONDITION",
      `Relation "${relation}" at ${path} requires exactly one of some/none/every/exists/is/isNot`
    );
  }
  const predicate = predicateKeys[0] as AthenaRelationPredicate;
  const operand = value[predicate];
  if (predicate === "exists") {
    if (operand === true || (isRecord(operand) && Object.keys(operand).length === 0)) {
      return { kind: "relation", predicate, relation };
    }
    if (!isRecord(operand)) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_CONDITION",
        `exists at ${path}.${relation} must be true or a filter object`
      );
    }
  }
  if (operand === undefined) {
    return { kind: "relation", predicate, relation };
  }
  if (isRecord(operand) && Object.keys(operand).length === 0) {
    return { kind: "relation", predicate, relation };
  }
  return {
    filter: normalizeWhere(operand as AthenaWhere, seen, `${path}.${relation}.${predicate}`),
    kind: "relation",
    predicate,
    relation,
  };
}

function normalizeColumnPredicate(
  column: string,
  value: unknown
): AthenaConditionAst[] {
  const field = fieldRef(column);
  if (!isRecord(value)) {
    if (value === null) {
      return [{ field, kind: "is-null" }];
    }
    return [{ field, kind: "compare", operator: "eq", value }];
  }

  const conditions: AthenaConditionAst[] = [];
  for (const [operator, operand] of Object.entries(value)) {
    if (operand === undefined) {
      continue;
    }
    if (operator === "in") {
      conditions.push({
        field,
        kind: "in",
        values: Array.isArray(operand) ? operand : [operand],
      });
      continue;
    }
    if (operator === "contains") {
      conditions.push({ field, kind: "contains", value: operand });
      continue;
    }
    if (operator === "containedBy") {
      conditions.push({ field, kind: "contained-by", value: operand });
      continue;
    }
    if (operator === "is") {
      if (operand === null || operand === "null") {
        conditions.push({ field, kind: "is-null" });
        continue;
      }
      if (operand === true || operand === "true") {
        conditions.push({ field, kind: "is-true" });
        continue;
      }
      if (operand === false || operand === "false") {
        conditions.push({ field, kind: "is-false" });
        continue;
      }
    }
    if (COMPARE_OPERATORS.has(operator as AthenaCompareOperator)) {
      if (operator === "eq" && operand === null) {
        conditions.push({ field, kind: "is-null" });
        continue;
      }
      if (operator === "neq" && operand === null) {
        conditions.push({ field, kind: "is-null", negated: true });
        continue;
      }
      conditions.push({
        field,
        kind: "compare",
        operator: operator as AthenaCompareOperator,
        value: operand,
      });
      continue;
    }
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
      `Unsupported where operator "${operator}" on "${column}"`
    );
  }
  if (conditions.length === 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
      `where.${column} requires at least one operator`
    );
  }
  return conditions;
}

export function normalizeWhere(
  where?: AthenaWhere | Record<string, unknown>,
  seen: WeakSet<object> = new WeakSet<object>(),
  path = "where"
): AthenaConditionAst | undefined {
  if (where === undefined) {
    return;
  }
  if (!isRecord(where)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
      "where must be an object"
    );
  }
  if (seen.has(where)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_CYCLIC_INPUT",
      `Cyclic where object at ${path}`
    );
  }
  seen.add(where);

  const parts: AthenaConditionAst[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) {
      continue;
    }
    if (key === "or") {
      if (!Array.isArray(value) || value.length === 0) {
        throw new AthenaQueryError(
          "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
          "where.or must be a non-empty array"
        );
      }
      const orParts = value.flatMap((clause) => {
        const normalized = normalizeWhere(clause as AthenaWhere, seen, `${path}.or`);
        return normalized ? [normalized] : [];
      });
      if (orParts.length === 1) {
        parts.push(orParts[0] as AthenaConditionAst);
      } else if (orParts.length > 1) {
        parts.push({ kind: "or", conditions: orParts });
      }
      continue;
    }
    if (key === "not") {
      const negated = normalizeWhere(value as AthenaWhere, seen, `${path}.not`);
      if (negated) {
        parts.push({ kind: "not", condition: negated });
      }
      continue;
    }
    if (isRecord(value) && seen.has(value)) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_CYCLIC_INPUT",
        `Cyclic where object at ${path}.${key}`
      );
    }
    if (isRelationWhereValue(value)) {
      parts.push(normalizeRelationPredicate(key, value, seen, path));
      continue;
    }
    parts.push(
      ...normalizeColumnPredicate(
        key,
        value as AthenaWhereOperatorInput | unknown
      )
    );
  }

  if (parts.length === 0) {
    return;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { kind: "and", conditions: parts };
}

export function normalizeGatewayConditions(
  conditions?: AthenaGatewayCondition[]
): AthenaConditionAst | undefined {
  if (!conditions?.length) {
    return;
  }
  const parts: AthenaConditionAst[] = [];
  for (const condition of conditions) {
    const operator = (condition.operator || "eq").toLowerCase();
    const column = condition.column ?? condition.eq_column;
    const value =
      condition.value === undefined ? condition.eq_value : condition.value;
    if (operator === "or" || operator === "not") {
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
        `Raw "${operator}" expressions cannot be lifted into the Athena Query AST`
      );
    }
    if (!column) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
        "Condition requires a column"
      );
    }
    parts.push(
      ...normalizeColumnPredicate(column, {
        [operator === "containedby" ? "containedBy" : operator]: value,
      })
    );
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { kind: "and", conditions: parts };
}

export function normalizeOrderBy(
  orderBy?: AthenaOrderBy | AthenaSortBy | Record<string, unknown>
): AthenaOrderAst[] | undefined {
  if (!orderBy) {
    return;
  }
  if (!isRecord(orderBy)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
      "orderBy must be an object"
    );
  }
  if ("field" in orderBy && typeof orderBy.field === "string") {
    return [
      {
        direction: orderBy.direction === "descending" ? "desc" : "asc",
        field: fieldRef(orderBy.field),
      },
    ];
  }
  if ("column" in orderBy && orderBy.column !== undefined) {
    return [
      {
        direction: orderBy.ascending === false ? "desc" : "asc",
        field: fieldRef(String(orderBy.column)),
      },
    ];
  }
  const entries = Object.entries(orderBy).filter(
    ([, value]) => value !== undefined
  );
  if (entries.length === 0) {
    return;
  }
  if (entries.length > 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
      "orderBy only supports a single column in v1"
    );
  }
  const [column, input] = entries[0] as [string, unknown];
  let direction: "asc" | "desc" = "asc";
  if (input === false || input === "desc" || input === "descending") {
    direction = "desc";
  } else if (isRecord(input) && input.ascending === false) {
    direction = "desc";
  }
  return [{ direction, field: fieldRef(column) }];
}

export function normalizePagination(input: {
  limit?: number;
  offset?: number;
  currentPage?: number;
  current_page?: number;
  pageSize?: number;
  page_size?: number;
}): AthenaPaginationAst | undefined {
  const page = input.currentPage ?? input.current_page;
  const pageSize = input.pageSize ?? input.page_size;
  if (
    input.limit === undefined &&
    input.offset === undefined &&
    page === undefined &&
    pageSize === undefined
  ) {
    return;
  }
  if (page !== undefined && page < 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_PAGINATION",
      "current_page must be >= 1"
    );
  }
  if (pageSize !== undefined && pageSize < 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_PAGINATION",
      "page_size must be >= 0"
    );
  }
  return {
    limit: input.limit,
    offset: input.offset,
    page,
    pageSize,
  };
}

export function canonicalizePagination(
  pagination?: AthenaPaginationAst
): { limit?: number; offset?: number } {
  if (!pagination) {
    return {};
  }
  let { limit, offset } = pagination;
  if (limit === undefined && pagination.pageSize !== undefined) {
    limit = Math.max(0, Math.trunc(pagination.pageSize));
  }
  if (
    offset === undefined &&
    pagination.page !== undefined &&
    pagination.pageSize !== undefined
  ) {
    offset =
      (Math.trunc(pagination.page) - 1) *
      Math.max(0, Math.trunc(pagination.pageSize));
  }
  return { limit, offset };
}

export function normalizeFindManyInput(input: {
  table: string;
  select: AthenaSelectShape;
  where?: AthenaWhere | Record<string, unknown>;
  orderBy?: AthenaOrderBy | Record<string, unknown>;
  limit?: number;
  offset?: number;
  currentPage?: number;
  pageSize?: number;
  cardinality?: AthenaQueryCardinality;
  modelId?: string;
}): AthenaSelectQueryAst {
  const source = parseSourceName(input.table);
  if (input.modelId) {
    source.modelId = input.modelId;
  }
  const pagination = normalizePagination({
    currentPage: input.currentPage,
    limit: input.limit,
    offset: input.offset,
    pageSize: input.pageSize,
  });
  return {
    cardinality: input.cardinality ?? "many",
    filter: normalizeWhere(input.where),
    kind: "select",
    orderBy: normalizeOrderBy(input.orderBy),
    pagination,
    selection: {
      fields: normalizeSelectShape(
        input.select,
        source,
        input.cardinality ?? "many"
      ),
    },
    source,
  };
}

export function normalizeFindFirstInput(
  input: Omit<Parameters<typeof normalizeFindManyInput>[0], "cardinality">
): AthenaSelectQueryAst {
  return normalizeFindManyInput({ ...input, cardinality: "first" });
}

export function normalizeFindUniqueInput(
  input: Omit<Parameters<typeof normalizeFindManyInput>[0], "cardinality">
): AthenaSelectQueryAst {
  return normalizeFindManyInput({ ...input, cardinality: "unique" });
}

export function isFindManyAstPayload(
  value: unknown
): value is {
  limit?: number;
  orderBy?: Record<string, unknown>;
  select: AthenaSelectShape;
  table_name: string;
  where?: Record<string, unknown>;
} {
  if (!isRecord(value) || typeof value.table_name !== "string") {
    return false;
  }
  if (!isRecord(value.select)) {
    return false;
  }
  return Object.values(value.select).some(
    (entry) => entry === true || isRelationSelectNode(entry)
  );
}

export function whereHasRelationPredicates(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>()
): boolean {
  const where = isRecord(value) && "where" in value ? value.where : value;
  if (!isRecord(where) || seen.has(where)) {
    return false;
  }
  seen.add(where);
  for (const [key, child] of Object.entries(where)) {
    if (child === undefined) {
      continue;
    }
    if (key === "or" && Array.isArray(child)) {
      if (child.some((clause) => whereHasRelationPredicates(clause, seen))) {
        return true;
      }
      continue;
    }
    if (key === "not" && whereHasRelationPredicates(child, seen)) {
      return true;
    }
    if (isRelationWhereValue(child)) {
      return true;
    }
  }
  return false;
}

export function selectPayloadHasRelations(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (whereHasRelationPredicates(value)) {
    return true;
  }
  if (isRecord(value.select)) {
    return Object.values(value.select).some((entry) => isRelationSelectNode(entry));
  }
  if (typeof value.select === "string" && value.select.includes("(")) {
    return true;
  }
  if (typeof value.columns === "string" && value.columns.includes("(")) {
    return true;
  }
  if (
    Array.isArray(value.columns) &&
    value.columns.some((column) => String(column).includes("("))
  ) {
    return true;
  }
  return false;
}

export function normalizeTransportPayload(payload: unknown): AthenaSelectQueryAst {
  if (!isRecord(payload)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SOURCE",
      "Query payload must be an object"
    );
  }

  if (payload.kind === "select" && isRecord(payload.source)) {
    return payload as unknown as AthenaSelectQueryAst;
  }

  const table = String(payload.table_name ?? "").trim();
  if (!table) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SOURCE",
      "table_name is required"
    );
  }
  const source = parseSourceName(table);

  let fields: AthenaSelectedFieldAst[];
  if (isRecord(payload.select) && !Array.isArray(payload.select)) {
    const asShape = payload.select as AthenaSelectShape;
    const hasRelation = Object.values(asShape).some((value) =>
      isRelationSelectNode(value)
    );
    if (hasRelation || Object.values(asShape).every((value) => value === true)) {
      fields = normalizeSelectShape(asShape, source, "many");
    } else {
      fields = normalizeSelectShape(asShape, source, "many");
    }
  } else {
    const rawColumns =
      typeof payload.select === "string"
        ? payload.select
        : Array.isArray(payload.columns)
          ? payload.columns.join(",")
          : typeof payload.columns === "string"
            ? payload.columns
            : "*";
    fields =
      rawColumns.trim() === "" || rawColumns.trim() === "*"
        ? [{ kind: "column", column: "*" }]
        : parseSelectList(rawColumns, source);
  }

  return {
    cardinality: "many",
    filter:
      normalizeWhere(payload.where as AthenaWhere | undefined) ??
      normalizeGatewayConditions(
        payload.conditions as AthenaGatewayCondition[] | undefined
      ),
    kind: "select",
    orderBy: normalizeOrderBy(
      (payload.orderBy as AthenaOrderBy | undefined) ??
        (payload.sort_by as AthenaSortBy | undefined)
    ),
    pagination: normalizePagination({
      current_page: payload.current_page as number | undefined,
      limit: payload.limit as number | undefined,
      offset: payload.offset as number | undefined,
      page_size: payload.page_size as number | undefined,
    }),
    selection: { fields },
    source,
  };
}
