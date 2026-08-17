import type { AthenaConditionAst, AthenaSelectQueryAst } from "./ast.ts";
import type { AthenaQueryCapabilityMatrix } from "./capabilities.ts";
import { AthenaQueryError } from "./errors.ts";
import type { AthenaQueryPlan } from "./plan.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function walkConditions(
  condition: AthenaConditionAst | undefined,
  visit: (node: AthenaConditionAst) => void
): void {
  if (!condition) {
    return;
  }
  visit(condition);
  if (condition.kind === "and" || condition.kind === "or") {
    for (const child of condition.conditions) {
      walkConditions(child, visit);
    }
  }
  if (condition.kind === "not") {
    walkConditions(condition.condition, visit);
  }
  if (condition.kind === "relation" || condition.kind === "resolved-relation") {
    walkConditions(condition.filter, visit);
  }
}

export const DEFAULT_QUERY_MAX_NESTED_DEPTH = 8;
export const DEFAULT_QUERY_MAX_RELATIONS = 32;

function countConditionRelations(condition?: AthenaConditionAst): number {
  if (!condition) {
    return 0;
  }
  if (condition.kind === "and" || condition.kind === "or") {
    return condition.conditions.reduce(
      (total, child) => total + countConditionRelations(child),
      0
    );
  }
  if (condition.kind === "not") {
    return countConditionRelations(condition.condition);
  }
  if (condition.kind === "relation" || condition.kind === "resolved-relation") {
    return 1 + countConditionRelations(condition.filter);
  }
  return 0;
}

function measureConditionDepth(condition?: AthenaConditionAst): number {
  if (!condition) {
    return 0;
  }
  if (condition.kind === "and" || condition.kind === "or") {
    return condition.conditions.reduce(
      (depth, child) => Math.max(depth, measureConditionDepth(child)),
      0
    );
  }
  if (condition.kind === "not") {
    return measureConditionDepth(condition.condition);
  }
  if (condition.kind === "relation" || condition.kind === "resolved-relation") {
    return 1 + measureConditionDepth(condition.filter);
  }
  return 0;
}

export function countAstRelations(ast: AthenaSelectQueryAst): number {
  let count = countConditionRelations(ast.filter);
  for (const field of ast.selection.fields) {
    if (field.kind === "relation") {
      count += 1 + countAstRelations(field.query);
    }
  }
  return count;
}

export function measureAstDepth(ast: AthenaSelectQueryAst): number {
  let depth = measureConditionDepth(ast.filter);
  for (const field of ast.selection.fields) {
    if (field.kind === "relation") {
      depth = Math.max(depth, 1 + measureAstDepth(field.query));
    }
  }
  return depth;
}

export function validateQueryComplexity(
  ast: AthenaSelectQueryAst,
  limits?: { maxNestedDepth?: number; maxRelations?: number }
): void {
  const maxDepth = limits?.maxNestedDepth ?? DEFAULT_QUERY_MAX_NESTED_DEPTH;
  const maxRelations = limits?.maxRelations ?? DEFAULT_QUERY_MAX_RELATIONS;
  if (measureAstDepth(ast) > maxDepth) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_NESTING",
      `Nested relation depth exceeds ${maxDepth}`
    );
  }
  if (countAstRelations(ast) > maxRelations) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_NESTING",
      `Relation count exceeds ${maxRelations}`
    );
  }
}

export function validateSelectQueryAst(ast: AthenaSelectQueryAst): void {
  if (!IDENTIFIER.test(ast.source.table)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SOURCE",
      `Invalid source table: ${ast.source.table}`
    );
  }
  if (ast.selection.fields.length === 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SELECTION",
      "select requires at least one field"
    );
  }
  if (
    ast.pagination?.page !== undefined &&
    ast.pagination.page < 1
  ) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_PAGINATION",
      "page must be >= 1"
    );
  }
  validateQueryComplexity(ast);
}

export function validatePlanAgainstCapabilities(
  plan: AthenaQueryPlan,
  capabilities: AthenaQueryCapabilityMatrix
): void {
  if (planHasUnsupportedNulls(plan) && !capabilities.nullsOrdering) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `NULL ordering is unsupported on ${capabilities.backend}`
    );
  }

  walkConditions(plan.filter, (node) => {
    if (node.kind === "compare" && node.operator === "ilike" && !capabilities.ilike) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
        `ilike is unsupported on ${capabilities.backend}`
      );
    }
    if (
      (node.kind === "contains" || node.kind === "contained-by") &&
      !capabilities.jsonbContainment
    ) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNSUPPORTED_OPERATOR",
        `${node.kind} is unsupported on ${capabilities.backend}`
      );
    }
  });

  const hasRelations = plan.selection.some((field) => field.kind === "relation");
  if (hasRelations && !capabilities.nestedRelations) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `Nested relations are unsupported on ${capabilities.backend}`
    );
  }

  let hasRelationalPredicate = false;
  let hasManyToMany = false;
  walkConditions(plan.filter, (node) => {
    if (node.kind === "relation" || node.kind === "resolved-relation") {
      hasRelationalPredicate = true;
      if (node.kind === "resolved-relation" && node.descriptor.cardinality === "many-to-many") {
        hasManyToMany = true;
      }
    }
  });
  for (const field of plan.selection) {
    if (field.kind === "relation" && field.descriptor.cardinality === "many-to-many") {
      hasManyToMany = true;
    }
  }
  if (hasRelationalPredicate && !capabilities.relationalPredicates) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `Relational predicates are unsupported on ${capabilities.backend}`
    );
  }
  if (hasManyToMany && !capabilities.manyToManyRelations) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `Many-to-many relations are unsupported on ${capabilities.backend}`
    );
  }

  for (const field of plan.selection) {
    if (field.kind === "relation") {
      validatePlanAgainstCapabilities(field.plan, capabilities);
    }
  }
}

function planHasUnsupportedNulls(plan: AthenaQueryPlan): boolean {
  return Boolean(plan.orderBy?.some((order) => order.nulls));
}
