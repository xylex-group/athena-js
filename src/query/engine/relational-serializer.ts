import type {
  AthenaCompareConditionAst,
  AthenaConditionAst,
  AthenaOrderAst,
  AthenaResolvedRelationConditionAst,
  AthenaSelectQueryAst,
} from "./ast.ts";
import type { AthenaQueryPlan } from "./plan.ts";
import type { AthenaRelationDescriptor } from "./relations.ts";
import { canonicalIdentity, isCanonicalIdentity } from "./relations.ts";
import { AthenaQueryError } from "./errors.ts";
import { canonicalizePagination } from "./normalize.ts";

export interface RelationalQueryRequestV1 {
  fields: Array<{ alias?: string; field: string }>;
  order_by: Array<{ direction: "asc" | "desc"; field: string }>;
  pagination: { limit?: number; offset?: number };
  predicate?: RelationalPredicateV1;
  relation_predicates: RelationalRelationPredicateV1[];
  relations: RelationalRelationSelectionV1[];
  source: { schema?: string; table: string };
  version: "v1";
}

export type RelationalPredicateV1 =
  | { kind: "constant"; value: boolean }
  | {
      field: string;
      kind: "comparison";
      operator: RelationalComparisonOperatorV1;
      value?: unknown;
      values?: unknown[];
    }
  | {
      conditions: RelationalPredicateV1[];
      kind: "and" | "or";
    }
  | { condition: RelationalPredicateV1; kind: "not" };

export type RelationalComparisonOperatorV1 =
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

export interface RelationalRelationPredicateV1 {
  predicate: RelationalPredicateV1;
  quantifier: RelationalRelationQuantifierV1;
  relation: RelationalRelationReferenceV1;
}

export type RelationalRelationQuantifierV1 =
  | "some"
  | "none"
  | "every"
  | "exists"
  | "is"
  | "is_not";

export interface RelationalRelationReferenceV1 {
  constraint?: string;
  direction?: "forward" | "reverse";
  relation: string;
  target?: { schema?: string; table: string };
}

export interface RelationalRelationSelectionV1 {
  alias?: string;
  fields: Array<{ alias?: string; field: string }>;
  join?: "inner";
  order_by: Array<{ direction: "asc" | "desc"; field: string }>;
  pagination: { limit?: number; offset?: number };
  predicate?: RelationalPredicateV1;
  relation: RelationalRelationReferenceV1;
  relation_predicates: RelationalRelationPredicateV1[];
  relations: RelationalRelationSelectionV1[];
}

/** Nested relation projection for Relational V2, including optional first selection. */
export interface RelationalRelationSelectionV2
  extends Omit<RelationalRelationSelectionV1, "relations"> {
  relations: RelationalRelationSelectionV2[];
  selection?: "natural" | "first";
}

/** Relational V2 request envelope. Serializes `selection: "first"` without rewriting it as `limit: 1`. */
export interface RelationalQueryRequestV2
  extends Omit<RelationalQueryRequestV1, "version" | "relations"> {
  relations: RelationalRelationSelectionV2[];
  version: "v2";
}

/** Lower a many-cardinality plan onto the Relational V1 wire envelope. */
export function serializeRelationalQueryV1(
  plan: AthenaQueryPlan
): RelationalQueryRequestV1 {
  if (plan.cardinality !== "many") {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `Relational V1 does not preserve ${plan.cardinality} query cardinality`
    );
  }
  if (planHasFirstSelection(plan)) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      "Relational V1 cannot serialize relation first selection without changing array result shape"
    );
  }
  if (plan.ast.distinct) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      "Distinct relational selections are not supported by the V1 contract"
    );
  }

  const rootFilter = splitCondition(plan.filter);
  return {
    fields: scalarFields(plan),
    order_by: serializeOrderBy(plan.orderBy),
    pagination: serializePagination(plan.pagination),
    predicate: rootFilter.predicate,
    relation_predicates: rootFilter.relations,
    relations: plan.selection
      .filter((field) => field.kind === "relation")
      .map((field) => serializeRelationSelection(field)),
    source: {
      schema: plan.source.schema,
      table: plan.source.table,
    },
    version: "v1",
  };
}

/** Lower a many-cardinality plan onto the Relational V2 wire envelope, including `selection: "first"`. */
export function serializeRelationalQueryV2(
  plan: AthenaQueryPlan
): RelationalQueryRequestV2 {
  if (plan.cardinality !== "many") {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      `Relational V2 does not preserve ${plan.cardinality} query cardinality`
    );
  }
  if (plan.ast.distinct) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      "Distinct relational selections are not supported by the V2 contract"
    );
  }

  const rootFilter = splitCondition(plan.filter);
  return {
    fields: scalarFields(plan),
    order_by: serializeOrderBy(plan.orderBy),
    pagination: serializePagination(plan.pagination),
    predicate: rootFilter.predicate,
    relation_predicates: rootFilter.relations,
    relations: plan.selection
      .filter((field) => field.kind === "relation")
      .map((field) => serializeRelationSelectionV2(field)),
    source: {
      schema: plan.source.schema,
      table: plan.source.table,
    },
    version: "v2",
  };
}

function planHasFirstSelection(plan: AthenaQueryPlan): boolean {
  return plan.selection.some(
    (field) =>
      field.kind === "relation" &&
      (field.selection === "first" || planHasFirstSelection(field.plan))
  );
}

function serializeRelationSelectionV2(
  field: Extract<AthenaQueryPlan["selection"][number], { kind: "relation" }>
): RelationalRelationSelectionV2 {
  const filter = splitCondition(field.plan.filter);
  return {
    alias: field.alias,
    fields: scalarFields(field.plan),
    join: field.join === "inner" ? "inner" : undefined,
    order_by: serializeOrderBy(field.plan.orderBy),
    pagination: serializePagination(field.plan.pagination),
    predicate: filter.predicate,
    relation: serializeRelationReference(field.descriptor),
    relation_predicates: filter.relations,
    relations: field.plan.selection
      .filter((nested) => nested.kind === "relation")
      .map((nested) => serializeRelationSelectionV2(nested)),
    selection: field.selection === "first" ? "first" : undefined,
  };
}

function serializeRelationSelection(
  field: Extract<AthenaQueryPlan["selection"][number], { kind: "relation" }>
): RelationalRelationSelectionV1 {
  const filter = splitCondition(field.plan.filter);
  return {
    alias: field.alias,
    fields: scalarFields(field.plan),
    join: field.join === "inner" ? "inner" : undefined,
    order_by: serializeOrderBy(field.plan.orderBy),
    pagination: serializePagination(field.plan.pagination),
    predicate: filter.predicate,
    relation: serializeRelationReference(field.descriptor),
    relation_predicates: filter.relations,
    relations: field.plan.selection
      .filter((nested) => nested.kind === "relation")
      .map((nested) => serializeRelationSelection(nested)),
  };
}

function scalarFields(plan: AthenaQueryPlan): Array<{
  alias?: string;
  field: string;
}> {
  return plan.selection
    .filter((field) => field.kind === "column")
    .map((field) => ({
      alias: field.alias,
      field: field.column,
    }));
}

function serializeRelationReference(
  descriptor: AthenaRelationDescriptor
): RelationalRelationReferenceV1 {
  const relation = requireCanonicalIdentity(descriptor.id, "relation", descriptor);
  const constraint = descriptor.constraint
    ? requireCanonicalIdentity(descriptor.constraint, "constraint", descriptor)
    : undefined;
  return {
    constraint,
    direction: descriptor.direction,
    relation,
    target: {
      schema: descriptor.to.schema,
      table: descriptor.to.table,
    },
  };
}

function serializeOrderBy(
  values?: AthenaOrderAst[]
): Array<{ direction: "asc" | "desc"; field: string }> {
  return (values ?? []).map((value) => ({
    direction: value.direction,
    field: value.field.field,
  }));
}

function serializePagination(
  value: AthenaSelectQueryAst["pagination"]
): { limit?: number; offset?: number } {
  return canonicalizePagination(value);
}

function splitCondition(condition?: AthenaConditionAst): {
  predicate?: RelationalPredicateV1;
  relations: RelationalRelationPredicateV1[];
} {
  if (!condition) {
    return { relations: [] };
  }

  if (condition.kind === "relation" || condition.kind === "resolved-relation") {
    return {
      relations: [serializeRelationPredicate(condition)],
    };
  }

  if (condition.kind === "and") {
    const predicates: RelationalPredicateV1[] = [];
    const relations: RelationalRelationPredicateV1[] = [];
    for (const child of condition.conditions) {
      const split = splitCondition(child);
      if (split.predicate) {
        predicates.push(split.predicate);
      }
      relations.push(...split.relations);
    }
    return {
      predicate:
        predicates.length === 0
          ? undefined
          : predicates.length === 1
            ? predicates[0]
            : { conditions: predicates, kind: "and" },
      relations,
    };
  }

  if (condition.kind === "or" || condition.kind === "not") {
    if (containsRelationCondition(condition)) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
        "Relation predicates must be top-level conjunctions in the relational wire contract"
      );
    }
    return {
      predicate: serializeScalarCondition(condition),
      relations: [],
    };
  }

  return {
    predicate: serializeScalarCondition(condition),
    relations: [],
  };
}

function serializeRelationPredicate(
  condition:
    | Extract<AthenaConditionAst, { kind: "relation" }>
    | AthenaResolvedRelationConditionAst
): RelationalRelationPredicateV1 {
  const resolved = condition.kind === "resolved-relation" ? condition : undefined;
  const filter = splitCondition(condition.filter);
  if (filter.relations.length > 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
      "Nested relation predicates are not representable in the relational wire contract"
    );
  }
  return {
    predicate: filter.predicate ?? { kind: "constant", value: true },
    quantifier:
      condition.predicate === "isNot" ? "is_not" : condition.predicate,
    relation: resolved
      ? serializeRelationReference({
          ...resolved.descriptor,
          direction: resolved.direction,
        })
      : {
          relation: requireCanonicalIdentity(condition.relation, "relation"),
          target: undefined,
        },
  };
}

function serializeScalarCondition(
  condition: AthenaConditionAst
): RelationalPredicateV1 {
  switch (condition.kind) {
    case "compare":
      return serializeComparison(condition);
    case "in":
      return {
        field: condition.field.field,
        kind: "comparison",
        operator: "in",
        values: condition.values,
      };
    case "is-null":
      return {
        field: condition.field.field,
        kind: "comparison",
        operator: condition.negated ? "is_not_null" : "is_null",
      };
    case "is-true":
    case "is-false":
      return {
        field: condition.field.field,
        kind: "comparison",
        operator: condition.kind === "is-true" ? "eq" : "neq",
        value: true,
      };
    case "contains":
    case "contained-by":
      return {
        field: condition.field.field,
        kind: "comparison",
        operator:
          condition.kind === "contained-by" ? "contained_by" : "contains",
        value: condition.value,
      };
    case "and":
    case "or":
      return {
        conditions: condition.conditions.map(serializeScalarCondition),
        kind: condition.kind,
      };
    case "not":
      return {
        condition: serializeScalarCondition(condition.condition),
        kind: "not",
      };
    case "relation":
    case "resolved-relation":
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
        "Relation predicates must be top-level conjunctions in the relational wire contract"
      );
  }
}

function serializeComparison(
  condition: AthenaCompareConditionAst
): RelationalPredicateV1 {
  return {
    field: condition.field.field,
    kind: "comparison",
    operator: condition.operator,
    value: condition.value,
  };
}

function containsRelationCondition(condition: AthenaConditionAst): boolean {
  if (condition.kind === "relation" || condition.kind === "resolved-relation") {
    return true;
  }
  if (condition.kind === "and" || condition.kind === "or") {
    return condition.conditions.some(containsRelationCondition);
  }
  if (condition.kind === "not") {
    return containsRelationCondition(condition.condition);
  }
  return false;
}

function requireCanonicalIdentity(
  value: string,
  kind: "relation" | "constraint",
  descriptor?: AthenaRelationDescriptor
): string {
  if (value.startsWith(`${kind}:v1/`)) {
    if (isCanonicalIdentity(value, kind)) {
      return value;
    }
    throw new AthenaQueryError(
      "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
      `Relational wire requests require a canonical ${kind} identity`
    );
  }
  if (!descriptor) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
      `Relational wire requests require a canonical ${kind} identity`
    );
  }

  const identityEnd =
    descriptor.direction === "reverse" ? descriptor.to : descriptor.from;
  const owner = descriptor.source === "provider-discovery" ? "postgres" : "model";
  const key =
    kind === "relation"
      ? descriptor.direction === "reverse"
        ? (descriptor.id.split(".").pop() ?? descriptor.name)
        : descriptor.name
      : value;
  return canonicalIdentity(
    kind,
    owner,
    identityEnd.schema,
    identityEnd.table,
    key
  );
}
