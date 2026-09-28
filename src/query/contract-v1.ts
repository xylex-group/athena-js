import type {
  AthenaCompareOperator,
  AthenaConditionAst,
  AthenaFieldRefAst,
  AthenaSelectQueryAst,
} from "./engine/ast.ts";
import { AthenaQueryError } from "./engine/errors.ts";

export type QueryValueV1 =
  | { null: null }
  | { bool: boolean }
  | { integer: number }
  | { number: string }
  | { float: string }
  | { text: string }
  | { bytes: number[] }
  | { json: JsonValue };

export type CompareRightV1 =
  | { none: null }
  | { value: QueryValueV1 }
  | { values: QueryValueV1[] };

export type PredicateV1 =
  | { kind: "true" }
  | { kind: "false" }
  | {
      kind: "comparison";
      column: string;
      operator:
        | "eq"
        | "neq"
        | "gt"
        | "gte"
        | "lt"
        | "lte"
        | "like"
        | "ilike"
        | "is_null"
        | "is_not_null"
        | "in"
        | "not_in"
        | "contains"
        | "contained_by";
      right: CompareRightV1;
    }
  | { kind: "and"; conditions: PredicateV1[] }
  | { kind: "or"; conditions: PredicateV1[] }
  | { kind: "not"; condition: PredicateV1 };

export type RowValueV1 =
  | { value: QueryValueV1 }
  | { default: null };

export type ReturningV1 =
  | "none"
  | "star"
  | { columns: string[] };

export type MutationSafetyV1 = "allow_unfiltered" | "require_filter";

export interface SelectQueryV1 {
  kind: "select";
  from: { schema: string | null; name: string };
  selection: { columns: string[] } | "all";
  predicate: PredicateV1;
  order_by: Array<{
    column: string;
    direction: "asc" | "desc";
    nulls: "first" | "last" | null;
  }>;
  pagination: { limit: number | null; offset: number | null };
  for_update: boolean;
}

export interface InsertQueryV1 {
  kind: "insert";
  into: { schema: string | null; name: string };
  columns: string[];
  rows: RowValueV1[][];
  returning: ReturningV1;
}

export interface UpdateQueryV1 {
  kind: "update";
  table: { schema: string | null; name: string };
  assignments: Array<{ column: string; value: RowValueV1 }>;
  predicate: PredicateV1;
  returning: ReturningV1;
  safety: MutationSafetyV1;
}

export interface DeleteQueryV1 {
  kind: "delete";
  table: { schema: string | null; name: string };
  predicate: PredicateV1;
  returning: ReturningV1;
  safety: MutationSafetyV1;
}

export type QueryOperationV1 =
  | SelectQueryV1
  | InsertQueryV1
  | UpdateQueryV1
  | DeleteQueryV1;

export interface QueryRequestV1<
  TOperation extends QueryOperationV1 = SelectQueryV1,
> {
  version: 1;
  operation: TOperation;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function unsupported(message: string): never {
  throw new AthenaQueryError("ATHENA_QUERY_UNSUPPORTED_CAPABILITY", message);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      unsupported("Query V1 cannot encode non-finite numeric values");
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    unsupported(
      "Query V1 bytes must be encoded as a scalar value, not nested JSON"
    );
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = toJsonValue(entry);
    }
    return result;
  }
  unsupported(`Query V1 cannot encode value of type ${typeof value}`);
}

export function toQueryValue(value: unknown): QueryValueV1 {
  if (value === null) {
    return { null: null };
  }
  if (value instanceof Uint8Array) {
    return { bytes: Array.from(value) };
  }
  if (typeof value === "boolean") {
    return { bool: value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      unsupported("Query V1 cannot encode non-finite numeric values");
    }
    if (Number.isSafeInteger(value)) {
      return { integer: value };
    }
    return Number.isInteger(value)
      ? { number: String(value) }
      : { float: String(value) };
  }
  if (typeof value === "string") {
    return { text: value };
  }
  if (value === undefined || typeof value === "bigint" || typeof value === "symbol") {
    unsupported(`Query V1 cannot encode value of type ${typeof value}`);
  }
  return { json: toJsonValue(value) };
}

function fieldName(field: AthenaFieldRefAst): string {
  if (field.source) {
    unsupported(`Query V1 does not support qualified field "${field.field}"`);
  }
  return field.field;
}

function compareOperator(
  operator: AthenaCompareOperator
): Extract<PredicateV1, { kind: "comparison" }>["operator"] {
  return operator;
}

function toPredicate(condition?: AthenaConditionAst): PredicateV1 {
  if (!condition) {
    return { kind: "true" };
  }
  switch (condition.kind) {
    case "and":
      return {
        kind: "and",
        conditions: condition.conditions.map(toPredicate),
      };
    case "or":
      return {
        kind: "or",
        conditions: condition.conditions.map(toPredicate),
      };
    case "not":
      return { kind: "not", condition: toPredicate(condition.condition) };
    case "compare":
      return {
        kind: "comparison",
        column: fieldName(condition.field),
        operator: compareOperator(condition.operator),
        right: { value: toQueryValue(condition.value) },
      };
    case "in":
      return {
        kind: "comparison",
        column: fieldName(condition.field),
        operator: "in",
        right: { values: condition.values.map(toQueryValue) },
      };
    case "is-null":
      return {
        kind: "comparison",
        column: fieldName(condition.field),
        operator: condition.negated ? "is_not_null" : "is_null",
        right: { none: null },
      };
    case "is-true":
    case "is-false":
      return {
        kind: "comparison",
        column: fieldName(condition.field),
        operator: "eq",
        right: { value: { bool: condition.kind === "is-true" } },
      };
    case "contains":
    case "contained-by":
      return {
        kind: "comparison",
        column: fieldName(condition.field),
        operator: condition.kind === "contains" ? "contains" : "contained_by",
        right: { value: toQueryValue(condition.value) },
      };
    case "relation":
    case "resolved-relation":
      return unsupported(
        "Query V1 does not support relation predicates; use the compatibility projection"
      );
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

function pagination(ast: AthenaSelectQueryAst) {
  const source = ast.pagination;
  const limit =
    source?.limit ??
    source?.pageSize ??
    (ast.cardinality === "first" || ast.cardinality === "unique" ? 1 : null);
  const offset =
    source?.offset ??
    (source?.page && source?.pageSize
      ? (source.page - 1) * source.pageSize
      : null);
  return {
    limit: paginationNumber(limit, "limit"),
    offset: paginationNumber(offset, "offset"),
  };
}

function paginationNumber(value: number | null, name: string): number | null {
  if (value === null) {
    return null;
  }
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    unsupported(`Query V1 pagination ${name} must be a non-negative integer`);
  }
  return value;
}

export function serializeQueryRequestV1(
  ast: AthenaSelectQueryAst
): QueryRequestV1 {
  const fields = ast.selection.fields.map((field) => {
    if (field.kind !== "column") {
      unsupported(
        "Query V1 does not support relation selections; use the compatibility projection"
      );
    }
    if (field.alias !== undefined) {
      unsupported(
        "Query V1 does not support aliased fields; use the compatibility projection"
      );
    }
    return field.column;
  });

  return {
    version: 1,
    operation: {
      kind: "select",
      from: { name: ast.source.table, schema: ast.source.schema ?? null },
      selection:
        fields.length === 0 || fields.includes("*")
          ? "all"
          : { columns: fields },
      predicate: toPredicate(ast.filter),
      order_by: (ast.orderBy ?? []).map((order) => ({
        column: fieldName(order.field),
        direction: order.direction,
        nulls: order.nulls ?? null,
      })),
      pagination: pagination(ast),
      for_update: false,
    },
  };
}
