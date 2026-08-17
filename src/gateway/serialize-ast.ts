import { compileSelectShape } from "../query-ast.ts";
import type { AthenaSelectShape } from "../query-ast.ts";
import type { AthenaConditionAst, AthenaSelectQueryAst } from "../query/engine/ast.ts";
import { GATEWAY_QUERY_CAPABILITIES } from "../query/engine/capabilities.ts";
import { canonicalizePagination } from "../query/engine/normalize.ts";
import type { AthenaQueryPlan } from "../query/engine/plan.ts";
import { validatePlanAgainstCapabilities } from "../query/engine/validate.ts";
import type { AthenaFetchPayload } from "./types.ts";

function sourceName(ast: AthenaSelectQueryAst): string {
  return ast.source.schema
    ? `${ast.source.schema}.${ast.source.table}`
    : ast.source.table;
}

function selectionToShape(ast: AthenaSelectQueryAst): AthenaSelectShape {
  const shape: AthenaSelectShape = {};
  for (const field of ast.selection.fields) {
    if (field.kind === "column") {
      shape[field.alias ?? field.column] =
        field.alias && field.alias !== field.column
          ? true
          : true;
      if (field.column !== "*") {
        shape[field.column] = true;
        if (field.alias && field.alias !== field.column) {
          delete shape[field.column];
          shape[field.alias] = true;
        }
      } else {
        shape["*"] = true;
      }
      continue;
    }
    shape[field.alias ?? field.relation] = {
      as: field.alias,
      schema: field.query.source.schema,
      select: selectionToShape(field.query),
      via: field.via ?? field.relation,
    };
  }
  return shape;
}

function conditionToWhere(condition: AthenaConditionAst): Record<string, unknown> {
  switch (condition.kind) {
    case "and":
      return Object.assign(
        {},
        ...condition.conditions.map((child) => conditionToWhere(child))
      );
    case "or":
      return { or: condition.conditions.map((child) => conditionToWhere(child)) };
    case "not":
      return { not: conditionToWhere(condition.condition) };
    case "compare":
      return { [condition.field.field]: { [condition.operator]: condition.value } };
    case "in":
      return { [condition.field.field]: { in: condition.values } };
    case "is-null":
      return {
        [condition.field.field]: condition.negated ? { neq: null } : { eq: null },
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
export function serializeGatewayAst(ast: AthenaSelectQueryAst): AthenaFetchPayload {
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
export function serializeGatewayPlan(plan: AthenaQueryPlan): AthenaFetchPayload {
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
