import type { ModelRelationKind, ModelRelationMetadata } from "../../schema/types.ts";
import type { AthenaSourceAst } from "./ast.ts";
import { AthenaQueryError } from "./errors.ts";

export type AthenaRelationCardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

export interface AthenaRelationEnd {
  columns: string[];
  schema?: string;
  table: string;
}

export interface AthenaRelationDescriptor {
  cardinality: AthenaRelationCardinality;
  from: AthenaRelationEnd;
  id: string;
  junction?: {
    fromColumns: string[];
    schema?: string;
    table: string;
    toColumns: string[];
  };
  name: string;
  to: AthenaRelationEnd;
}

export interface AthenaRelationCatalog {
  entries: AthenaRelationDescriptor[];
}

function sameTable(
  left: { schema?: string; table: string },
  right: { schema?: string; table: string }
): boolean {
  if (left.table !== right.table) {
    return false;
  }
  if (left.schema && right.schema) {
    return left.schema === right.schema;
  }
  return true;
}

function invertCardinality(
  cardinality: AthenaRelationCardinality
): AthenaRelationCardinality {
  if (cardinality === "one-to-many") {
    return "many-to-one";
  }
  if (cardinality === "many-to-one") {
    return "one-to-many";
  }
  return cardinality;
}

export function catalogFromModelRelations(input: {
  schema?: string;
  table: string;
  relations: Record<string, ModelRelationMetadata>;
}): AthenaRelationCatalog {
  const entries: AthenaRelationDescriptor[] = [];
  for (const [name, relation] of Object.entries(input.relations)) {
    entries.push({
      cardinality: relation.kind as ModelRelationKind,
      from: {
        columns: relation.sourceColumns.map(String),
        schema: input.schema,
        table: input.table,
      },
      id: `${input.schema ?? "_"}.${input.table}.${name}`,
      junction: relation.through
        ? {
            fromColumns: relation.through.sourceColumns.map(String),
            schema: relation.through.schema,
            table: relation.through.model,
            toColumns: relation.through.targetColumns.map(String),
          }
        : undefined,
      name,
      to: {
        columns: relation.targetColumns.map(String),
        schema: relation.targetSchema,
        table: relation.targetModel,
      },
    });
  }
  return { entries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectModels(input: unknown, found: Array<Record<string, unknown>>): void {
  if (!isRecord(input)) {
    return;
  }
  const meta = input.meta;
  if (isRecord(meta) && Array.isArray(meta.primaryKey)) {
    found.push(input);
    return;
  }
  if (isRecord(input.models)) {
    collectModels(input.models, found);
    return;
  }
  if (isRecord(input.schemas)) {
    collectModels(input.schemas, found);
    return;
  }
  for (const value of Object.values(input)) {
    collectModels(value, found);
  }
}

/**
 * Priority-1 catalog: explicit AthenaModels relation metadata.
 * Compilers merge this ahead of live FK introspection.
 */
export function catalogFromModels(models: unknown): AthenaRelationCatalog {
  const found: Array<Record<string, unknown>> = [];
  collectModels(models, found);
  const catalogs: AthenaRelationCatalog[] = [];
  for (const model of found) {
    const meta = isRecord(model.meta) ? model.meta : {};
    const relations = isRecord(meta.relations)
      ? (meta.relations as Record<string, ModelRelationMetadata>)
      : undefined;
    if (!relations || Object.keys(relations).length === 0) {
      continue;
    }
    const tableName =
      (typeof model.tableName === "string" && model.tableName) ||
      (typeof meta.tableName === "string" && meta.tableName) ||
      (typeof meta.model === "string" && meta.model) ||
      "";
    if (!tableName) {
      continue;
    }
    const schema =
      typeof meta.schema === "string" && meta.schema.trim()
        ? meta.schema.trim()
        : tableName.includes(".")
          ? tableName.split(".")[0]
          : undefined;
    const table = tableName.includes(".")
      ? (tableName.split(".").pop() as string)
      : tableName;
    catalogs.push(
      catalogFromModelRelations({
        relations,
        schema,
        table,
      })
    );
  }
  return mergeRelationCatalogs(...catalogs);
}

export function mergeRelationCatalogs(
  ...catalogs: Array<AthenaRelationCatalog | undefined>
): AthenaRelationCatalog {
  const entries: AthenaRelationDescriptor[] = [];
  const seen = new Set<string>();
  for (const catalog of catalogs) {
    if (!catalog) {
      continue;
    }
    for (const entry of catalog.entries) {
      if (seen.has(entry.id)) {
        continue;
      }
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return { entries };
}

export function resolveRelation(input: {
  catalog: AthenaRelationCatalog;
  name: string;
  source: AthenaSourceAst;
  targetHint?: AthenaSourceAst;
}): AthenaRelationDescriptor {
  const byName = input.catalog.entries.filter(
    (entry) =>
      entry.name === input.name && sameTable(entry.from, input.source)
  );
  if (byName.length === 1) {
    return byName[0] as AthenaRelationDescriptor;
  }
  if (byName.length > 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_AMBIGUOUS_RELATION",
      `Relation "${input.name}" is ambiguous on ${input.source.table}`
    );
  }

  const targetTable = input.targetHint?.table ?? input.name;
  const targetSchema = input.targetHint?.schema;
  const outgoing = input.catalog.entries.filter(
    (entry) =>
      sameTable(entry.from, input.source) &&
      entry.to.table === targetTable &&
      (!targetSchema || !entry.to.schema || entry.to.schema === targetSchema)
  );
  if (outgoing.length === 1) {
    return outgoing[0] as AthenaRelationDescriptor;
  }
  if (outgoing.length > 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_AMBIGUOUS_RELATION",
      `Multiple foreign keys from ${input.source.table} to ${targetTable}`
    );
  }

  const incoming = input.catalog.entries.filter(
    (entry) =>
      sameTable(entry.to, input.source) &&
      entry.from.table === targetTable &&
      (!targetSchema || !entry.from.schema || entry.from.schema === targetSchema)
  );
  if (incoming.length === 1) {
    const found = incoming[0] as AthenaRelationDescriptor;
    return {
      ...found,
      cardinality: invertCardinality(found.cardinality),
      from: found.to,
      name: input.name,
      to: found.from,
    };
  }
  if (incoming.length > 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_AMBIGUOUS_RELATION",
      `Multiple foreign keys from ${targetTable} to ${input.source.table}`
    );
  }

  throw new AthenaQueryError(
    "ATHENA_QUERY_UNKNOWN_RELATION",
    `Unknown relation "${input.name}" on ${input.source.schema ? `${input.source.schema}.` : ""}${input.source.table}`
  );
}
