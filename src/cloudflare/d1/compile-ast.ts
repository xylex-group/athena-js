import {
  type AthenaConditionAst,
  AthenaQueryError,
  type AthenaQueryPlan,
  type AthenaResolvedRelationConditionAst,
  type AthenaResolvedSelectionField,
  type AthenaResolvedSource,
  canonicalizePagination,
  D1_QUERY_CAPABILITIES,
  validatePlanAgainstCapabilities,
} from "../../query/engine/index.ts";
import {
  atMostOneSqlLimit,
  relationResultShape,
} from "../../query/engine/relation-result-shape.ts";
import { quoteQualifiedIdentifier } from "../../sql-identifiers.ts";
import { type D1CompiledSql, D1SqlCompileError } from "./sql.ts";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

class Binder {
  readonly params: unknown[] = [];

  add(value: unknown): string {
    this.params.push(value);
    return "?";
  }
}

function quoteIdent(name: string): string {
  const trimmed = name.trim();
  if (!SAFE_IDENT.test(trimmed)) {
    throw new D1SqlCompileError(
      "invalid_identifier",
      `Invalid SQL identifier for D1: ${name}`
    );
  }
  return quoteQualifiedIdentifier(trimmed);
}

function qualifyTable(source: AthenaResolvedSource): string {
  return `${quoteIdent(source.table)} AS ${quoteIdent(source.alias)}`;
}

function qualifyColumn(alias: string, column: string): string {
  if (column === "*") {
    throw new D1SqlCompileError(
      "unsafe_select",
      "SELECT * inside nested D1 relations is unsupported; name columns explicitly"
    );
  }
  return `${quoteIdent(alias)}.${quoteIdent(column)}`;
}

function compileCondition(
  condition: AthenaConditionAst,
  parent: AthenaResolvedSource,
  binder: Binder
): string {
  switch (condition.kind) {
    case "and":
      return `(${condition.conditions.map((child) => compileCondition(child, parent, binder)).join(" AND ")})`;
    case "or":
      return `(${condition.conditions.map((child) => compileCondition(child, parent, binder)).join(" OR ")})`;
    case "not":
      return `(NOT ${compileCondition(condition.condition, parent, binder)})`;
    case "is-null":
      return `${qualifyColumn(parent.alias, condition.field.field)} IS${condition.negated ? " NOT" : ""} NULL`;
    case "is-true":
      return `${qualifyColumn(parent.alias, condition.field.field)} = ${binder.add(1)}`;
    case "is-false":
      return `${qualifyColumn(parent.alias, condition.field.field)} = ${binder.add(0)}`;
    case "in": {
      if (condition.values.length === 0) {
        return "1 = 0";
      }
      return `${qualifyColumn(parent.alias, condition.field.field)} IN (${condition.values.map((value) => binder.add(value ?? null)).join(", ")})`;
    }
    case "contains":
    case "contained-by":
      throw new D1SqlCompileError(
        "unsupported_operator",
        `${condition.kind} is unsupported on D1`
      );
    case "compare": {
      if (condition.operator === "ilike") {
        throw new D1SqlCompileError(
          "unsupported_operator",
          "ilike is unsupported on D1"
        );
      }
      if (condition.value === null) {
        throw new AthenaQueryError(
          "ATHENA_QUERY_INVALID_NORMALIZED_AST",
          "Compare against null must be normalized to is-null before D1 compilation"
        );
      }
      const column = qualifyColumn(parent.alias, condition.field.field);
      const placeholder = binder.add(condition.value);
      switch (condition.operator) {
        case "eq":
          return `${column} = ${placeholder}`;
        case "neq":
          return `${column} <> ${placeholder}`;
        case "gt":
          return `${column} > ${placeholder}`;
        case "gte":
          return `${column} >= ${placeholder}`;
        case "lt":
          return `${column} < ${placeholder}`;
        case "lte":
          return `${column} <= ${placeholder}`;
        case "like":
          return `${column} LIKE ${placeholder}`;
        default:
          throw new D1SqlCompileError(
            "unsupported_operator",
            "Unknown compare operator"
          );
      }
    }
    case "resolved-relation":
      return compileRelationPredicate(condition, parent, binder);
    case "relation":
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_NORMALIZED_AST",
        `Unresolved relation predicate "${condition.relation}" reached the D1 compiler`
      );
    default:
      throw new D1SqlCompileError(
        "unsupported_operator",
        "Unsupported condition kind on D1"
      );
  }
}

function compileRelationPredicate(
  condition: AthenaResolvedRelationConditionAst,
  parent: AthenaResolvedSource,
  binder: Binder,
  effectivePlan?: AthenaQueryPlan
): string {
  if (condition.predicate === "every" && !condition.filter) {
    return "TRUE";
  }
  const child: AthenaResolvedSource = {
    alias: condition.target.alias,
    modelId: condition.target.modelId,
    schema: condition.target.schema,
    table: condition.target.table,
  };
  const { fromSql, joinSql } = compileRelationScope(
    parent,
    child,
    condition.descriptor,
    condition.junctionAlias
  );
  const filters = [joinSql];
  const effectiveFilters = effectivePlan
    ? compileEffectivePlanFilters(effectivePlan, binder)
    : condition.filter
      ? [compileCondition(condition.filter, child, binder)]
      : [];
  if (effectiveFilters.length > 0) {
    const inner = effectiveFilters.join(" AND ");
    if (condition.predicate === "every") {
      filters.push(`NOT (CASE WHEN ${inner} THEN 1 ELSE 0 END)`);
    } else {
      filters.push(inner);
    }
  }
  const exists = `EXISTS (SELECT 1 FROM ${fromSql} WHERE ${filters.join(" AND ")})`;
  if (
    condition.predicate === "none" ||
    condition.predicate === "isNot" ||
    condition.predicate === "every"
  ) {
    return `NOT ${exists}`;
  }
  return exists;
}

function compileEffectivePlanFilters(
  plan: AthenaQueryPlan,
  binder: Binder
): string[] {
  return [
    ...(plan.filter
      ? [compileCondition(plan.filter, plan.source, binder)]
      : []),
    ...compileInnerRelationFilters(plan, binder),
  ];
}

function compileRelationScope(
  parent: AthenaResolvedSource,
  child: AthenaResolvedSource,
  descriptor: {
    cardinality: string;
    from: { columns: string[] };
    junction?: { fromColumns: string[]; table: string; toColumns: string[] };
    to: { columns: string[] };
  },
  junctionAlias?: string
): { fromSql: string; joinSql: string } {
  if (descriptor.cardinality === "many-to-many") {
    if (!(descriptor.junction && junctionAlias)) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_NORMALIZED_AST",
        "Many-to-many relation is missing junction metadata"
      );
    }
    const junctionOn = descriptor.junction.toColumns
      .map(
        (column, index) =>
          `${qualifyColumn(junctionAlias, column)} = ${qualifyColumn(child.alias, descriptor.to.columns[index] as string)}`
      )
      .join(" AND ");
    const parentOn = descriptor.from.columns
      .map(
        (column, index) =>
          `${qualifyColumn(parent.alias, column)} = ${qualifyColumn(junctionAlias, descriptor.junction?.fromColumns[index] as string)}`
      )
      .join(" AND ");
    return {
      fromSql: `${qualifyTable(child)} JOIN ${quoteIdent(descriptor.junction.table)} AS ${quoteIdent(junctionAlias)} ON ${junctionOn}`,
      joinSql: parentOn,
    };
  }
  return {
    fromSql: qualifyTable(child),
    joinSql: joinPredicate(
      parent,
      child,
      descriptor.from.columns,
      descriptor.to.columns
    ),
  };
}

function compileInnerRelationFilters(
  plan: AthenaQueryPlan,
  binder: Binder
): string[] {
  return plan.selection.flatMap((field) => {
    if (field.kind !== "relation" || field.join !== "inner") {
      return [];
    }
    const child = field.plan;
    return [
      compileRelationPredicate(
        {
          descriptor: field.descriptor,
          filter: child.filter,
          junctionAlias: field.junctionAlias,
          kind: "resolved-relation",
          predicate: "exists",
          relation: field.descriptor.name,
          target: {
            alias: child.source.alias,
            modelId: child.source.modelId,
            schema: child.source.schema,
            table: child.source.table,
          },
        },
        plan.source,
        binder,
        child
      ),
    ];
  });
}

function joinPredicate(
  parent: AthenaResolvedSource,
  child: AthenaResolvedSource,
  fromColumns: string[],
  toColumns: string[]
): string {
  return fromColumns
    .map(
      (column, index) =>
        `${qualifyColumn(parent.alias, column)} = ${qualifyColumn(child.alias, toColumns[index] as string)}`
    )
    .join(" AND ");
}

function jsonObjectExpr(plan: AthenaQueryPlan, binder: Binder): string {
  const pairs: string[] = [];
  for (const field of plan.selection) {
    if (field.kind === "column") {
      const key = field.alias ?? field.column;
      pairs.push(
        `'${key.replace(/'/g, "''")}'`,
        qualifyColumn(plan.source.alias, field.column)
      );
      continue;
    }
    const key = field.alias;
    pairs.push(
      `'${key.replace(/'/g, "''")}'`,
      `json(${compileRelationValue(plan, field, binder)})`
    );
  }
  if (pairs.length === 0) {
    throw new D1SqlCompileError(
      "unsafe_select",
      "Nested D1 relation select is empty"
    );
  }
  return `json_object(${pairs.join(", ")})`;
}

function compileRelationValue(
  plan: AthenaQueryPlan,
  field: Extract<AthenaResolvedSelectionField, { kind: "relation" }>,
  binder: Binder
): string {
  const child = field.plan;
  const { fromSql, joinSql } = compileRelationScope(
    plan.source,
    child.source,
    field.descriptor,
    field.junctionAlias
  );
  const objectExpr = jsonObjectExpr(child, binder);
  const filters = [joinSql, ...compileEffectivePlanFilters(child, binder)];
  const page = canonicalizePagination(child.pagination);
  const childOrder = child.orderBy?.length
    ? ` ORDER BY ${child.orderBy
        .map(
          (order) =>
            `${qualifyColumn(child.source.alias, order.field.field)} ${order.direction === "desc" ? "DESC" : "ASC"}`
        )
        .join(", ")}`
    : "";
  const resultShape = relationResultShape(
    field.descriptor.cardinality,
    field.selection
  );
  const limit =
    resultShape === "many"
      ? page.limit === undefined
        ? ""
        : ` LIMIT ${Math.max(0, Math.trunc(page.limit))}`
      : ` LIMIT ${atMostOneSqlLimit(page.limit)}`;
  const offset =
    page.offset === undefined
      ? ""
      : ` OFFSET ${Math.max(0, Math.trunc(page.offset))}`;
  const inner = `SELECT ${objectExpr} AS __athena_rel FROM ${fromSql} WHERE ${filters.join(" AND ")}${childOrder}${limit}${offset}`;
  if (resultShape === "many") {
    return `COALESCE((SELECT json_group_array(json(__athena_rel)) FROM (${inner})), '[]')`;
  }
  return `(SELECT __athena_rel FROM (${inner}))`;
}

function compileSelectList(plan: AthenaQueryPlan, binder: Binder): string {
  const parts: string[] = [];
  for (const field of plan.selection) {
    if (field.kind === "column") {
      if (field.column === "*") {
        parts.push(`${quoteIdent(plan.source.alias)}.*`);
        continue;
      }
      const expr = qualifyColumn(plan.source.alias, field.column);
      parts.push(
        field.alias && field.alias !== field.column
          ? `${expr} AS ${quoteIdent(field.alias)}`
          : expr
      );
      continue;
    }

    parts.push(
      `${compileRelationValue(plan, field, binder)} AS ${quoteIdent(field.alias)}`
    );
  }
  return parts.join(", ");
}

export function compileD1Ast(plan: AthenaQueryPlan): D1CompiledSql {
  if (plan?.kind !== "resolved-select" || !Array.isArray(plan.selection)) {
    throw new D1SqlCompileError(
      "unsupported_operator",
      "compileD1Ast requires a resolved AthenaQueryPlan"
    );
  }
  validatePlanAgainstCapabilities(plan, D1_QUERY_CAPABILITIES);
  const binder = new Binder();
  const parts = [
    `SELECT ${compileSelectList(plan, binder)} FROM ${qualifyTable(plan.source)}`,
  ];
  const where = [
    ...compileInnerRelationFilters(plan, binder),
    ...(plan.filter
      ? [compileCondition(plan.filter, plan.source, binder)]
      : []),
  ];
  if (where.length > 0) {
    parts.push(`WHERE ${where.join(" AND ")}`);
  }
  if (plan.orderBy?.[0]) {
    const order = plan.orderBy[0];
    parts.push(
      `ORDER BY ${qualifyColumn(plan.source.alias, order.field.field)} ${order.direction === "desc" ? "DESC" : "ASC"}`
    );
  }
  const page = canonicalizePagination(plan.pagination);
  let limit = page.limit;
  if (plan.cardinality === "first" || plan.cardinality === "unique") {
    limit = 1;
  }
  if (limit !== undefined) {
    parts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`);
  }
  if (page.offset !== undefined) {
    parts.push(`OFFSET ${Math.max(0, Math.trunc(page.offset))}`);
  }
  return { params: binder.params, sql: parts.join(" ") };
}
