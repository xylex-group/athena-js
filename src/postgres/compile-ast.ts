import {
  AthenaQueryError,
  type AthenaConditionAst,
  type AthenaQueryPlan,
  type AthenaResolvedRelationConditionAst,
  type AthenaResolvedSource,
  canonicalizePagination,
  POSTGRES_QUERY_CAPABILITIES,
  validatePlanAgainstCapabilities,
} from "../query/engine/index.ts";
import { quoteQualifiedIdentifier } from "../sql-identifiers.ts";
import { type PostgresCompiledQuery, PostgresSqlCompileError } from "./sql.ts";

const SAFE_QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

class Binder {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function quoteIdent(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || !SAFE_QUALIFIED.test(trimmed)) {
    throw new PostgresSqlCompileError(
      "invalid_identifier",
      `Invalid SQL identifier for PostgreSQL direct: ${name}`
    );
  }
  return quoteQualifiedIdentifier(trimmed);
}

function qualifyTable(source: AthenaResolvedSource): string {
  const name = source.schema ? `${source.schema}.${source.table}` : source.table;
  return `${quoteIdent(name)} AS ${quoteIdent(source.alias)}`;
}

function qualifyNamedTable(
  schema: string | undefined,
  table: string,
  alias: string
): string {
  const name = schema ? `${schema}.${table}` : table;
  return `${quoteIdent(name)} AS ${quoteIdent(alias)}`;
}

function qualifyColumn(alias: string, column: string): string {
  if (column === "*") {
    return `${quoteIdent(alias)}.*`;
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
      return `${qualifyColumn(parent.alias, condition.field.field)} IS TRUE`;
    case "is-false":
      return `${qualifyColumn(parent.alias, condition.field.field)} IS FALSE`;
    case "in": {
      if (condition.values.length === 0) {
        return "1 = 0";
      }
      const placeholders = condition.values
        .map((value) => binder.add(value ?? null))
        .join(", ");
      return `${qualifyColumn(parent.alias, condition.field.field)} IN (${placeholders})`;
    }
    case "contains": {
      const value =
        condition.value !== null &&
        typeof condition.value === "object" &&
        !Array.isArray(condition.value)
          ? JSON.stringify(condition.value)
          : condition.value;
      return `${qualifyColumn(parent.alias, condition.field.field)} @> ${binder.add(value ?? null)}::jsonb`;
    }
    case "contained-by": {
      const value =
        condition.value !== null &&
        typeof condition.value === "object" &&
        !Array.isArray(condition.value)
          ? JSON.stringify(condition.value)
          : condition.value;
      return `${qualifyColumn(parent.alias, condition.field.field)} <@ ${binder.add(value ?? null)}::jsonb`;
    }
    case "compare": {
      if (condition.value === null) {
        throw new AthenaQueryError(
          "ATHENA_QUERY_INVALID_NORMALIZED_AST",
          `Compare against null must be normalized to is-null before PostgreSQL compilation`
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
        case "ilike":
          return `${column} ILIKE ${placeholder}`;
        default:
          throw new PostgresSqlCompileError(
            "unsupported_operator",
            `Unknown compare operator "${String((condition as { operator?: string }).operator)}"`
          );
      }
    }
    case "resolved-relation":
      return compileRelationPredicate(condition, parent, binder);
    case "relation":
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_NORMALIZED_AST",
        `Unresolved relation predicate "${condition.relation}" reached the PostgreSQL compiler`
      );
    default:
      throw new PostgresSqlCompileError(
        "unsupported_operator",
        `Unsupported condition kind "${String((condition as { kind?: string }).kind)}"`
      );
  }
}

function compileRelationPredicate(
  condition: AthenaResolvedRelationConditionAst,
  parent: AthenaResolvedSource,
  binder: Binder
): string {
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
  if (condition.filter) {
    const inner = compileCondition(condition.filter, child, binder);
    if (condition.predicate === "every") {
      filters.push(`(${inner}) IS NOT TRUE`);
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

function compileRelationScope(
  parent: AthenaResolvedSource,
  child: AthenaResolvedSource,
  descriptor: AthenaResolvedRelationConditionAst["descriptor"] | {
    cardinality: string;
    from: { columns: string[]; schema?: string; table: string };
    junction?: {
      fromColumns: string[];
      schema?: string;
      table: string;
      toColumns: string[];
    };
    to: { columns: string[]; schema?: string; table: string };
  },
  junctionAlias?: string
): { fromSql: string; joinSql: string } {
  if (descriptor.cardinality === "many-to-many") {
    if (!descriptor.junction || !junctionAlias) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_NORMALIZED_AST",
        `Many-to-many relation ${descriptor.from.table} → ${descriptor.to.table} is missing junction metadata`
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
      fromSql: `${qualifyTable(child)} JOIN ${qualifyNamedTable(descriptor.junction.schema, descriptor.junction.table, junctionAlias)} ON ${junctionOn}`,
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

function joinPredicate(
  parent: AthenaResolvedSource,
  child: AthenaResolvedSource,
  fromColumns: string[],
  toColumns: string[]
): string {
  if (fromColumns.length === 0 || fromColumns.length !== toColumns.length) {
    throw new PostgresSqlCompileError(
      "invalid_condition",
      "Relation join requires matching composite key columns"
    );
  }
  return fromColumns
    .map(
      (column, index) =>
        `${qualifyColumn(parent.alias, column)} = ${qualifyColumn(child.alias, toColumns[index] as string)}`
    )
    .join(" AND ");
}

function compileSelectList(plan: AthenaQueryPlan, binder: Binder): string {
  const parts: string[] = [];
  for (const field of plan.selection) {
    if (field.kind === "column") {
      const expr = qualifyColumn(plan.source.alias, field.column);
      parts.push(
        field.alias && field.alias !== field.column
          ? `${expr} AS ${quoteIdent(field.alias)}`
          : expr
      );
      continue;
    }

    const childPlan = field.plan;
    const { fromSql, joinSql } = compileRelationScope(
      plan.source,
      childPlan.source,
      field.descriptor,
      field.junctionAlias
    );
    const innerSelect = compileSelectList(childPlan, binder);
    const childWhere = [joinSql];
    if (childPlan.filter) {
      childWhere.push(compileCondition(childPlan.filter, childPlan.source, binder));
    }
    const childOrder = compileOrder(childPlan);
    const childPage = canonicalizePagination(childPlan.pagination);
    const toMany =
      field.descriptor.cardinality === "one-to-many" ||
      field.descriptor.cardinality === "many-to-many";
    const childLimit = toMany
      ? childPage.limit !== undefined
        ? ` LIMIT ${Math.max(0, Math.trunc(childPage.limit))}`
        : ""
      : " LIMIT 1";
    const childOffset =
      childPage.offset !== undefined
        ? ` OFFSET ${Math.max(0, Math.trunc(childPage.offset))}`
        : "";

    const inner = `SELECT ${innerSelect} FROM ${fromSql} WHERE ${childWhere.join(" AND ")}${childOrder}${childLimit}${childOffset}`;
    if (
      field.descriptor.cardinality === "one-to-many" ||
      field.descriptor.cardinality === "many-to-many"
    ) {
      parts.push(
        `COALESCE((SELECT json_agg(row_to_json(${quoteIdent(childPlan.source.alias)})) FROM (${inner}) ${quoteIdent(childPlan.source.alias)}), '[]'::json) AS ${quoteIdent(field.alias)}`
      );
    } else {
      parts.push(
        `(SELECT row_to_json(${quoteIdent(childPlan.source.alias)}) FROM (${inner}) ${quoteIdent(childPlan.source.alias)}) AS ${quoteIdent(field.alias)}`
      );
    }
  }
  return parts.join(", ");
}

function compileOrder(plan: AthenaQueryPlan): string {
  if (!plan.orderBy?.length) {
    return "";
  }
  const parts = plan.orderBy.map((order) => {
    const direction = order.direction === "desc" ? "DESC" : "ASC";
    const nulls =
      order.nulls === "first"
        ? " NULLS FIRST"
        : order.nulls === "last"
          ? " NULLS LAST"
          : "";
    return `${qualifyColumn(plan.source.alias, order.field.field)} ${direction}${nulls}`;
  });
  return ` ORDER BY ${parts.join(", ")}`;
}

export function compilePostgresAst(plan: AthenaQueryPlan): PostgresCompiledQuery {
  if (!plan || plan.kind !== "resolved-select" || !Array.isArray(plan.selection)) {
    throw new PostgresSqlCompileError(
      "unsupported_operator",
      "compilePostgresAst requires a resolved AthenaQueryPlan"
    );
  }
  validatePlanAgainstCapabilities(plan, POSTGRES_QUERY_CAPABILITIES);
  const binder = new Binder();
  const selectList = compileSelectList(plan, binder);
  const parts = [`SELECT ${selectList} FROM ${qualifyTable(plan.source)}`];
  if (plan.filter) {
    parts.push(`WHERE ${compileCondition(plan.filter, plan.source, binder)}`);
  }
  const order = compileOrder(plan);
  if (order) {
    parts.push(order.trim());
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
  return { text: parts.join(" "), values: binder.values };
}

export function compilePostgresAstCount(
  plan: AthenaQueryPlan
): PostgresCompiledQuery {
  validatePlanAgainstCapabilities(plan, POSTGRES_QUERY_CAPABILITIES);
  const binder = new Binder();
  const parts = [
    `SELECT COUNT(*)::bigint AS __athena_count FROM ${qualifyTable(plan.source)}`,
  ];
  if (plan.filter) {
    parts.push(
      `WHERE ${compileCondition(plan.filter, plan.source, binder)}`
    );
  }
  return { text: parts.join(" "), values: binder.values };
}
