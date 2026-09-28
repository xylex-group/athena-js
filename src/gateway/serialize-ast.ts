import type {
  AthenaConditionAst,
  AthenaSelectQueryAst,
} from "../query/engine/ast.ts";
import { GATEWAY_QUERY_CAPABILITIES } from "../query/engine/capabilities.ts";
import { AthenaQueryError } from "../query/engine/errors.ts";
import { canonicalizePagination } from "../query/engine/normalize.ts";
import type { AthenaQueryPlan } from "../query/engine/plan.ts";
import { validatePlanAgainstCapabilities } from "../query/engine/validate.ts";
import type {
  AthenaRelationSelectNode,
  AthenaSelectShape,
} from "../query-ast.ts";
import { compileSelectShape } from "../query-ast.ts";
import type { AthenaFetchPayload } from "./types.ts";

const GATEWAY_OPERATOR_KEYS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setOwnValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function mergeWhereValues(
  path: string,
  left: unknown,
  right: unknown
): unknown {
  if (!(isRecord(left) && isRecord(right))) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `Gateway cannot represent repeated predicate key "${path}" without losing conditions`
    );
  }
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(left)) {
    setOwnValue(merged, key, value);
  }
  for (const [key, value] of Object.entries(right)) {
    const childPath = `${path}.${key}`;
    if (Object.hasOwn(merged, key)) {
      if (GATEWAY_OPERATOR_KEYS.has(key)) {
        throw new AthenaQueryError(
          "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
          `Gateway cannot represent repeated predicate operator "${childPath}"`
        );
      }
      setOwnValue(merged, key, mergeWhereValues(childPath, merged[key], value));
      continue;
    }
    setOwnValue(merged, key, value);
  }
  return merged;
}

function sourceName(ast: AthenaSelectQueryAst): string {
  return ast.source.schema
    ? `${ast.source.schema}.${ast.source.table}`
    : ast.source.table;
}

function selectionToShape(ast: AthenaSelectQueryAst): AthenaSelectShape {
  const shape: AthenaSelectShape = {};
  for (const field of ast.selection.fields) {
    if (field.kind === "column") {
      if (field.column === "*") {
        shape["*"] = true;
      } else {
        shape[field.column] = true;
        if (field.alias && field.alias !== field.column) {
          delete shape[field.column];
          shape[field.alias] = true;
        }
      }
      continue;
    }
    shape[field.alias ?? field.relation] = {
      as: field.alias,
      constraint: field.constraintHint,
      join: field.join,
      relation: field.relation,
      schema: field.query.source.schema,
      select: selectionToShape(field.query),
      via: field.legacyVia ?? field.via,
    } as unknown as AthenaRelationSelectNode;
  }
  return shape;
}

function conditionToWhere(
  condition: AthenaConditionAst
): Record<string, unknown> {
  switch (condition.kind) {
    case "and": {
      const where = Object.create(null) as Record<string, unknown>;
      for (const child of condition.conditions) {
        const childWhere = conditionToWhere(child);
        for (const [key, value] of Object.entries(childWhere)) {
          if (Object.hasOwn(where, key)) {
            setOwnValue(
              where,
              key,
              mergeWhereValues(key, where[key], value)
            );
            continue;
          }
          setOwnValue(where, key, value);
        }
      }
      return { ...where };
    }
    case "or":
      return {
        or: condition.conditions.map((child) => conditionToWhere(child)),
      };
    case "not":
      return { not: conditionToWhere(condition.condition) };
    case "compare":
      return {
        [condition.field.field]: { [condition.operator]: condition.value },
      };
    case "in":
      return { [condition.field.field]: { in: condition.values } };
    case "is-null":
      return {
        [condition.field.field]: condition.negated
          ? { neq: null }
          : { eq: null },
      };
    case "is-true":
      return { [condition.field.field]: { is: true } };
    case "is-false":
      return { [condition.field.field]: { is: false } };
    case "contains":
      return { [condition.field.field]: { contains: condition.value } };
    case "contained-by":
      return { [condition.field.field]: { containedBy: condition.value } };
    case "relation":
    case "resolved-relation":
      return {
        [condition.relation]: {
          [condition.predicate]: condition.filter
            ? conditionToWhere(condition.filter)
            : {},
        },
      };
    default:
      return {};
  }
}

/**
 * Project a semantic AST onto the existing Gateway `/gateway/fetch` wire.
 * Rust remains a consumer, not the owner, of query semantics.
 */
export function serializeGatewayAst(
  ast: AthenaSelectQueryAst
): AthenaFetchPayload {
  const select = selectionToShape(ast);
  const page = canonicalizePagination(ast.pagination);
  const payload: AthenaFetchPayload = {
    select: compileSelectShape(select),
    table_name: sourceName(ast),
  };
  if (ast.filter) {
    payload.where = conditionToWhere(ast.filter) as AthenaFetchPayload["where"];
  }
  if (ast.orderBy?.[0]) {
    payload.orderBy = {
      [ast.orderBy[0].field.field]: ast.orderBy[0].direction,
    };
  }
  if (page.limit !== undefined) {
    payload.limit = page.limit;
  }
  if (page.offset !== undefined) {
    payload.offset = page.offset;
  }
  if (ast.cardinality === "first" || ast.cardinality === "unique") {
    payload.limit = 1;
  }
  return payload;
}

/**
 * Serialize a resolved plan onto the existing Gateway fetch wire.
 * Compilers must not re-resolve relations; the plan is the input.
 */
export function serializeGatewayPlan(
  plan: AthenaQueryPlan
): AthenaFetchPayload {
  validatePlanAgainstCapabilities(plan, GATEWAY_QUERY_CAPABILITIES);
  return serializeGatewayAst(plan.ast);
}

export function serializeGatewayFindManyAst(ast: AthenaSelectQueryAst): {
  limit?: number;
  orderBy?: Record<string, string>;
  select: AthenaSelectShape;
  table_name: string;
  where?: Record<string, unknown>;
} {
  const page = canonicalizePagination(ast.pagination);
  return {
    limit:
      ast.cardinality === "first" || ast.cardinality === "unique"
        ? 1
        : page.limit,
    orderBy: ast.orderBy?.[0]
      ? { [ast.orderBy[0].field.field]: ast.orderBy[0].direction }
      : undefined,
    select: selectionToShape(ast),
    table_name: sourceName(ast),
    where: ast.filter ? conditionToWhere(ast.filter) : undefined,
  };
}
