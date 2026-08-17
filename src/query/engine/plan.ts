import type {
  AthenaConditionAst,
  AthenaOrderAst,
  AthenaPaginationAst,
  AthenaQueryCardinality,
  AthenaSelectQueryAst,
  AthenaSourceAst,
} from "./ast.ts";
import { selectionHasRelations } from "./ast.ts";
import { AthenaQueryError } from "./errors.ts";
import type { AthenaRelationCatalog, AthenaRelationDescriptor } from "./relations.ts";
import { resolveRelation } from "./relations.ts";
import { validateSelectQueryAst } from "./validate.ts";

export interface AthenaResolvedSource {
  alias: string;
  modelId?: string;
  schema?: string;
  table: string;
}

export interface AthenaResolvedColumn {
  alias?: string;
  column: string;
  kind: "column";
}

export interface AthenaResolvedRelation {
  alias: string;
  descriptor: AthenaRelationDescriptor;
  junctionAlias?: string;
  kind: "relation";
  plan: AthenaQueryPlan;
}

export type AthenaResolvedSelectionField =
  | AthenaResolvedColumn
  | AthenaResolvedRelation;

export interface AthenaQueryPlan {
  ast: AthenaSelectQueryAst;
  cardinality: AthenaQueryCardinality;
  filter?: AthenaConditionAst;
  kind: "resolved-select";
  orderBy?: AthenaOrderAst[];
  pagination?: AthenaPaginationAst;
  selection: AthenaResolvedSelectionField[];
  source: AthenaResolvedSource;
}

class AthenaQueryAliasAllocator {
  private seq = 0;

  next(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }
}

/**
 * @deprecated Planning allocates aliases per invocation. Kept as a no-op
 * for existing tests that reset between cases.
 */
export function resetQueryPlanAliases(): void {}

export function isAthenaQueryPlan(value: unknown): value is AthenaQueryPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { kind?: unknown }).kind === "resolved-select";
}

interface ResolveQueryPlanOptions {
  aliasPrefix?: string;
  aliases?: AthenaQueryAliasAllocator;
  catalog?: AthenaRelationCatalog;
  path?: string[];
}

export function resolveAthenaQueryPlan(
  ast: AthenaSelectQueryAst,
  options?: ResolveQueryPlanOptions
): AthenaQueryPlan {
  return resolveQueryPlan(ast, options);
}

export function resolveQueryPlan(
  ast: AthenaSelectQueryAst,
  options?: ResolveQueryPlanOptions
): AthenaQueryPlan {
  validateSelectQueryAst(ast);
  const aliases = options?.aliases ?? new AthenaQueryAliasAllocator();
  const path = options?.path ?? [ast.source.table];
  const source: AthenaResolvedSource = {
    alias: ast.source.alias ?? aliases.next(options?.aliasPrefix ?? "t"),
    modelId: ast.source.modelId,
    schema: ast.source.schema,
    table: ast.source.table,
  };

  const selection: AthenaResolvedSelectionField[] = [];
  const outputAliases = new Set<string>();
  for (const field of ast.selection.fields) {
    if (field.kind === "column") {
      const outputAlias = field.alias ?? field.column;
      if (outputAliases.has(outputAlias)) {
        throw new AthenaQueryError(
          "ATHENA_QUERY_INVALID_SELECTION",
          `Duplicate output alias "${outputAlias}" at ${path.join(".")}`
        );
      }
      outputAliases.add(outputAlias);
      selection.push({
        alias: field.alias,
        column: field.column,
        kind: "column",
      });
      continue;
    }

    if (!options?.catalog) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_UNKNOWN_RELATION",
        `Relation "${field.relation}" cannot be resolved without relation metadata at ${path.join(".")}.${field.relation}`
      );
    }

    const descriptor = resolveRelation({
      catalog: options.catalog,
      name: field.relation,
      source: ast.source,
      targetHint: field.query.source,
    });

    const nestedSource: AthenaSourceAst = {
      ...field.query.source,
      schema: field.query.source.schema ?? descriptor.to.schema,
      table: descriptor.to.table,
    };

    const outputAlias = field.alias ?? field.relation;
    if (outputAliases.has(outputAlias)) {
      throw new AthenaQueryError(
        "ATHENA_QUERY_INVALID_SELECTION",
        `Duplicate output alias "${outputAlias}" at ${path.join(".")}`
      );
    }
    outputAliases.add(outputAlias);

    const nestedPlan = resolveQueryPlan(
      {
        ...field.query,
        source: nestedSource,
      },
      {
        aliasPrefix: "r",
        aliases,
        catalog: options.catalog,
        path: [...path, outputAlias],
      }
    );

    selection.push({
      alias: outputAlias,
      descriptor,
      junctionAlias:
        descriptor.cardinality === "many-to-many" ? aliases.next("j") : undefined,
      kind: "relation",
      plan: nestedPlan,
    });
  }

  if (selection.length === 0) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_INVALID_SELECTION",
      "Resolved selection is empty"
    );
  }

  return {
    ast,
    cardinality: ast.cardinality,
    filter: ast.filter
      ? resolveCondition(ast.filter, {
          aliases,
          catalog: options?.catalog,
          path,
          source: ast.source,
        })
      : undefined,
    kind: "resolved-select",
    orderBy: ast.orderBy,
    pagination: ast.pagination,
    selection,
    source,
  };
}

function resolveCondition(
  condition: AthenaConditionAst,
  context: {
    aliases: AthenaQueryAliasAllocator;
    catalog?: AthenaRelationCatalog;
    path: string[];
    source: AthenaSourceAst;
  }
): AthenaConditionAst {
  if (condition.kind === "and" || condition.kind === "or") {
    return {
      conditions: condition.conditions.map((child) =>
        resolveCondition(child, context)
      ),
      kind: condition.kind,
    };
  }
  if (condition.kind === "not") {
    return {
      condition: resolveCondition(condition.condition, context),
      kind: "not",
    };
  }
  if (condition.kind === "resolved-relation") {
    return {
      ...condition,
      filter: condition.filter
        ? resolveCondition(condition.filter, {
            ...context,
            source: {
              kind: "table",
              modelId: condition.target.modelId,
              schema: condition.target.schema,
              table: condition.target.table,
            },
          })
        : undefined,
    };
  }
  if (condition.kind !== "relation") {
    return condition;
  }

  if (!context.catalog) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_UNKNOWN_RELATION",
      `Relation "${condition.relation}" cannot be resolved without relation metadata at ${context.path.join(".")}.${condition.relation}`
    );
  }

  const descriptor = resolveRelation({
    catalog: context.catalog,
    name: condition.via ?? condition.relation,
    source: context.source,
  });
  const target = {
    alias: context.aliases.next("r"),
    schema: descriptor.to.schema,
    table: descriptor.to.table,
  };
  const nestedSource: AthenaSourceAst = {
    kind: "table",
    schema: descriptor.to.schema,
    table: descriptor.to.table,
  };
  return {
    descriptor,
    filter: condition.filter
      ? resolveCondition(condition.filter, {
          aliases: context.aliases,
          catalog: context.catalog,
          path: [...context.path, condition.relation],
          source: nestedSource,
        })
      : undefined,
    junctionAlias:
      descriptor.cardinality === "many-to-many"
        ? context.aliases.next("j")
        : undefined,
    kind: "resolved-relation",
    predicate: condition.predicate,
    relation: condition.relation,
    target,
  };
}

export function planHasRelations(plan: AthenaQueryPlan): boolean {
  return (
    plan.selection.some((field) => field.kind === "relation") ||
    selectionHasRelations(plan.ast)
  );
}
