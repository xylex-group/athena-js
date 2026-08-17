import {
  AthenaQueryError,
  type AthenaConditionAst,
  type AthenaQueryPlan,
  type AthenaResolvedRelationConditionAst,
  type AthenaResolvedSelectionField,
  type AthenaResolvedSource,
  canonicalizePagination,
  D1_QUERY_CAPABILITIES,
  validatePlanAgainstCapabilities,
} from "../../query/engine/index.ts";
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
            `Unknown compare operator`
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
    if (!descriptor.junction || !junctionAlias) {
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

function jsonObjectExpr(
  fields: AthenaResolvedSelectionField[],
  alias: string
): string {
  const pairs: string[] = [];
  for (const field of fields) {
    if (field.kind !== "column") {
      throw new D1SqlCompileError(
        "relations_unsupported",
        "D1 nested relations deeper than one level require an explicit column list at each level"
      );
    }
    const key = field.alias ?? field.column;
    pairs.push(`'${key.replace(/'/g, "''")}'`, qualifyColumn(alias, field.column));
  }
  if (pairs.length === 0) {
    throw new D1SqlCompileError(
      "unsafe_select",
      "Nested D1 relation select is empty"
    );
  }
  return `json_object(${pairs.join(", ")})`;
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

    const child = field.plan;
    const { fromSql, joinSql } = compileRelationScope(
      plan.source,
      child.source,
      field.descriptor,
      field.junctionAlias
    );
    const objectExpr = jsonObjectExpr(child.selection, child.source.alias);
    const filters = [joinSql];
    if (child.filter) {
      filters.push(compileCondition(child.filter, child.source, binder));
    }
    const page = canonicalizePagination(child.pagination);
    const childOrder = child.orderBy?.[0]
      ? ` ORDER BY ${qualifyColumn(child.source.alias, child.orderBy[0].field.field)} ${child.orderBy[0].direction === "desc" ? "DESC" : "ASC"}`
      : "";
    const toMany =
      field.descriptor.cardinality === "one-to-many" ||
      field.descriptor.cardinality === "many-to-many";
    const limit = toMany
      ? page.limit !== undefined
        ? ` LIMIT ${Math.max(0, Math.trunc(page.limit))}`
        : ""
      : " LIMIT 1";
    const offset =
      page.offset !== undefined
        ? ` OFFSET ${Math.max(0, Math.trunc(page.offset))}`
        : "";
    const inner = `SELECT ${objectExpr} AS __athena_rel FROM ${fromSql} WHERE ${filters.join(" AND ")}${childOrder}${limit}${offset}`;
    if (
      field.descriptor.cardinality === "one-to-many" ||
      field.descriptor.cardinality === "many-to-many"
    ) {
      parts.push(
        `COALESCE((SELECT json_group_array(__athena_rel) FROM (${inner})), '[]') AS ${quoteIdent(field.alias)}`
      );
    } else {
      parts.push(
        `(SELECT __athena_rel FROM (${inner})) AS ${quoteIdent(field.alias)}`
      );
    }
  }
  return parts.join(", ");
}

export function compileD1Ast(plan: AthenaQueryPlan): D1CompiledSql {
  if (!plan || plan.kind !== "resolved-select" || !Array.isArray(plan.selection)) {
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
  if (plan.filter) {
    parts.push(`WHERE ${compileCondition(plan.filter, plan.source, binder)}`);
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
