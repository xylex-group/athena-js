/**
 * Transport-independent Athena query semantics.
 * Must not contain SQL placeholders, JOIN text, HTTP paths, or Rust DTOs.
 */

export type AthenaQueryCardinality = "many" | "first" | "unique";

export type AthenaCompareOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike";

export interface AthenaSourceAst {
  kind: "table";
  alias?: string;
  modelId?: string;
  schema?: string;
  table: string;
}

export interface AthenaFieldRefAst {
  field: string;
  source?: string;
}

export type AthenaRelationPredicate =
  | "some"
  | "none"
  | "every"
  | "exists"
  | "is"
  | "isNot";

export interface AthenaRelationConditionAst {
  filter?: AthenaConditionAst;
  kind: "relation";
  predicate: AthenaRelationPredicate;
  relation: string;
  via?: string;
}

export interface AthenaResolvedRelationConditionAst {
  descriptor: {
    cardinality:
      | "one-to-one"
      | "one-to-many"
      | "many-to-one"
      | "many-to-many";
    from: { columns: string[]; schema?: string; table: string };
    id: string;
    junction?: {
      fromColumns: string[];
      schema?: string;
      table: string;
      toColumns: string[];
    };
    name: string;
    to: { columns: string[]; schema?: string; table: string };
  };
  filter?: AthenaConditionAst;
  junctionAlias?: string;
  kind: "resolved-relation";
  predicate: AthenaRelationPredicate;
  relation: string;
  target: {
    alias: string;
    modelId?: string;
    schema?: string;
    table: string;
  };
}

export interface AthenaColumnSelectionAst {
  kind: "column";
  alias?: string;
  column: string;
}

export interface AthenaRelationSelectionAst {
  kind: "relation";
  alias?: string;
  query: AthenaSelectQueryAst;
  relation: string;
  via?: string;
}

export type AthenaSelectedFieldAst =
  | AthenaColumnSelectionAst
  | AthenaRelationSelectionAst;

export interface AthenaSelectionAst {
  fields: AthenaSelectedFieldAst[];
}

export type AthenaConditionAst =
  | {
      field: AthenaFieldRefAst;
      kind: "compare";
      operator: AthenaCompareOperator;
      value: unknown;
    }
  | {
      field: AthenaFieldRefAst;
      kind: "in";
      values: unknown[];
    }
  | {
      field: AthenaFieldRefAst;
      kind: "is-null";
      negated?: boolean;
    }
  | {
      field: AthenaFieldRefAst;
      kind: "is-true" | "is-false";
    }
  | {
      field: AthenaFieldRefAst;
      kind: "contains" | "contained-by";
      value: unknown;
    }
  | {
      conditions: AthenaConditionAst[];
      kind: "and" | "or";
    }
  | {
      condition: AthenaConditionAst;
      kind: "not";
    }
  | AthenaRelationConditionAst
  | AthenaResolvedRelationConditionAst;

export interface AthenaOrderAst {
  direction: "asc" | "desc";
  field: AthenaFieldRefAst;
  nulls?: "first" | "last";
}

export interface AthenaPaginationAst {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
}

export interface AthenaDistinctAst {
  on?: AthenaFieldRefAst[];
}

export interface AthenaSelectQueryAst {
  cardinality: AthenaQueryCardinality;
  distinct?: AthenaDistinctAst;
  filter?: AthenaConditionAst;
  kind: "select";
  orderBy?: AthenaOrderAst[];
  pagination?: AthenaPaginationAst;
  selection: AthenaSelectionAst;
  source: AthenaSourceAst;
}

export type AthenaQueryAst = AthenaSelectQueryAst;

export function isAthenaSelectQueryAst(
  value: unknown
): value is AthenaSelectQueryAst {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "select" &&
    Boolean(record.source) &&
    typeof record.source === "object" &&
    Boolean(record.selection) &&
    typeof record.selection === "object"
  );
}

function collectConditionTables(condition?: AthenaConditionAst): AthenaSourceAst[] {
  if (!condition) {
    return [];
  }
  if (condition.kind === "and" || condition.kind === "or") {
    return condition.conditions.flatMap((child) => collectConditionTables(child));
  }
  if (condition.kind === "not") {
    return collectConditionTables(condition.condition);
  }
  if (condition.kind === "relation") {
    return collectConditionTables(condition.filter);
  }
  if (condition.kind === "resolved-relation") {
    return [
      {
        alias: condition.target.alias,
        kind: "table",
        modelId: condition.target.modelId,
        schema: condition.target.schema,
        table: condition.target.table,
      },
      ...collectConditionTables(condition.filter),
    ];
  }
  return [];
}

export function collectAstTables(ast: AthenaSelectQueryAst): AthenaSourceAst[] {
  const tables: AthenaSourceAst[] = [ast.source];
  for (const field of ast.selection.fields) {
    if (field.kind === "relation") {
      tables.push(...collectAstTables(field.query));
    }
  }
  tables.push(...collectConditionTables(ast.filter));
  return tables;
}

export function selectionHasRelations(ast: AthenaSelectQueryAst): boolean {
  return ast.selection.fields.some((field) => field.kind === "relation");
}
