import type {
  ModelRelationKind,
  ModelRelationMetadata,
} from "../../schema/types.ts";
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
  /** Orientation used when this descriptor was resolved from a query source. */
  direction?: "forward" | "reverse";
  /** Canonical constraint identity, not a relation display name or catalog ID. */
  constraint?: string;
  /**
   * Exact provider-native selectors accepted at the compatibility boundary.
   * These are aliases only; canonical resolution still uses `constraint`.
   */
  constraintAliases?: string[];
  from: AthenaRelationEnd;
  id: string;
  junction?: {
    fromColumns: string[];
    schema?: string;
    table: string;
    toColumns: string[];
  };
  name: string;
  source?: "model-metadata" | "provider-discovery" | "explicit-catalog";
  to: AthenaRelationEnd;
}

export interface AthenaRelationCatalog {
  entries: AthenaRelationDescriptor[];
}

function sameTable(
  candidate: { schema?: string; table: string },
  requested: { schema?: string; table: string }
): boolean {
  if (candidate.table !== requested.table) {
    return false;
  }
  if (requested.schema) {
    return candidate.schema === requested.schema;
  }
  return true;
}

function hasConstraint(
  entry: AthenaRelationDescriptor,
  constraintHint: string | undefined
): boolean {
  if (!constraintHint) {
    return true;
  }
  return (
    entry.constraint === constraintHint ||
    entry.constraintAliases?.includes(constraintHint) === true
  );
}

function hasRelationHint(
  entry: AthenaRelationDescriptor,
  constraintHint: string | undefined,
  relationHint: string | undefined
): boolean {
  if (constraintHint) {
    return hasConstraint(entry, constraintHint);
  }
  if (!relationHint) {
    return true;
  }
  return (
    entry.constraint === relationHint ||
    entry.id === relationHint ||
    entry.id.endsWith(`.${relationHint}`) ||
    entry.name === relationHint
  );
}

function validateRelationMetadata(entry: AthenaRelationDescriptor): void {
  const invalid = (message: string): never => {
    throw new AthenaQueryError(
      "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
      message
    );
  };
  const validateEnd = (end: AthenaRelationEnd, label: string): void => {
    if (!end.table) {
      invalid(`Relation "${entry.name}" has an empty ${label} table`);
    }
    if (end.schema === "") {
      invalid(`Relation "${entry.name}" has an empty ${label} schema`);
    }
    if (end.columns.length === 0 || end.columns.some((column) => !column)) {
      invalid(`Relation "${entry.name}" has an invalid ${label} column set`);
    }
  };

  if (!entry.id || !entry.name) {
    invalid(`Relation metadata must include a non-empty id and name`);
  }
  validateCanonicalIdentity(entry.id, "relation", "id", entry.name);
  if (entry.constraint === "") {
    invalid(`Relation "${entry.name}" has an empty constraint identity`);
  }
  if (entry.constraint) {
    validateCanonicalIdentity(
      entry.constraint,
      "constraint",
      "constraint",
      entry.name
    );
  }
  validateEnd(entry.from, "source");
  validateEnd(entry.to, "target");
  if (entry.junction) {
    if (!entry.junction.table || entry.junction.schema === "") {
      invalid(`Relation "${entry.name}" has an invalid junction table`);
    }
    if (
      entry.junction.fromColumns.length === 0 ||
      entry.junction.toColumns.length === 0 ||
      entry.junction.fromColumns.some((column) => !column) ||
      entry.junction.toColumns.some((column) => !column)
    ) {
      invalid(`Relation "${entry.name}" has an invalid junction column set`);
    }
  }

  const hasZeroWidthMapping = entry.junction
    ? entry.from.columns.length === 0 ||
      entry.junction.fromColumns.length === 0 ||
      entry.junction.toColumns.length === 0 ||
      entry.to.columns.length === 0
    : entry.from.columns.length === 0 || entry.to.columns.length === 0;
  const hasInvalidWidths = entry.junction
    ? entry.from.columns.length !== entry.junction.fromColumns.length ||
      entry.to.columns.length !== entry.junction.toColumns.length
    : entry.from.columns.length !== entry.to.columns.length;
  if (hasZeroWidthMapping || hasInvalidWidths) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
      hasZeroWidthMapping
        ? `Relation "${entry.name}" has an empty mapped column set`
        : `Relation "${entry.name}" has mismatched ${
            entry.junction ? "junction key" : "composite key"
          } widths`
    );
  }
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

function encodeIdentityComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function identityError(
  label: string,
  relationName?: string
): AthenaQueryError {
  return new AthenaQueryError(
    "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
    relationName
      ? `Relation "${relationName}" has an invalid canonical ${label}`
      : `Canonical ${label} must be non-empty`
  );
}

function validateIdentityComponent(
  value: unknown,
  label: string,
  relationName?: string
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw identityError(label, relationName);
  }
}

export function canonicalIdentity(
  kind: "relation" | "constraint",
  owner: string,
  schema: string | undefined,
  table: string,
  key: string
): string {
  validateIdentityComponent(owner, "owner");
  if (schema !== undefined) {
    validateIdentityComponent(schema, "schema");
  }
  validateIdentityComponent(table, "table");
  validateIdentityComponent(key, "key");
  return `${kind}:v1/${[owner, schema ?? "", table, key]
    .map(encodeIdentityComponent)
    .join("/")}`;
}

function validateCanonicalIdentity(
  value: string,
  kind: "relation" | "constraint",
  label: string,
  relationName: string
): void {
  const prefix = `${kind}:v1/`;
  if (!value.startsWith(prefix)) {
    return;
  }

  try {
    const components = value
      .slice(prefix.length)
      .split("/")
      .map((component) => decodeURIComponent(component));
    if (components.length !== 4) {
      throw identityError(label, relationName);
    }
    const [owner, schema, table, key] = components;
    validateIdentityComponent(owner, "owner", relationName);
    validateIdentityComponent(table, "table", relationName);
    validateIdentityComponent(key, "key", relationName);
    if (
      canonicalIdentity(
        kind,
        owner,
        schema || undefined,
        table,
        key
      ) !== value
    ) {
      throw identityError(label, relationName);
    }
  } catch (error) {
    if (error instanceof AthenaQueryError) {
      throw error;
    }
    throw identityError(label, relationName);
  }
}

export function isCanonicalIdentity(
  value: unknown,
  kind: "relation" | "constraint"
): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const prefix = `${kind}:v1/`;
  if (!value.startsWith(prefix)) {
    return false;
  }
  try {
    const components = value
      .slice(prefix.length)
      .split("/")
      .map((component) => decodeURIComponent(component));
    if (components.length !== 4) {
      return false;
    }
    const [owner, schema, table, key] = components;
    if (!owner || !table || !key) {
      return false;
    }
    return (
      canonicalIdentity(kind, owner, schema || undefined, table, key) === value
    );
  } catch {
    return false;
  }
}

function assertRelationDescriptor(
  descriptor: AthenaRelationDescriptor
): AthenaRelationDescriptor {
  validateRelationMetadata(descriptor);
  if (
    descriptor.constraintAliases?.some(
      (alias) =>
        alias.length === 0 ||
        alias === descriptor.constraint ||
        alias.startsWith("constraint:v1/") ||
        alias.startsWith("relation:v1/")
    )
  ) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
      `Relation "${descriptor.name}" has an invalid constraint alias`
    );
  }
  return descriptor;
}

function canonicalizeConstraintSelector(
  catalog: AthenaRelationCatalog,
  selector: string,
  source: AthenaSourceAst,
  targetHint: AthenaSourceAst | undefined
): string {
  const scoped = catalog.entries.filter(
    (entry) =>
      (sameTable(entry.from, source) &&
        (!targetHint || sameTable(entry.to, targetHint))) ||
      (sameTable(entry.to, source) &&
        (!targetHint || sameTable(entry.from, targetHint)))
  );
  const matches = scoped.filter(
    (entry) =>
      entry.constraint === selector ||
      entry.constraintAliases?.includes(selector) === true
  );
  const identities = [
    ...new Set(
      matches
        .map((entry) => entry.constraint)
        .filter((constraint): constraint is string => Boolean(constraint))
    ),
  ];
  return identities.length === 1 ? (identities[0] as string) : selector;
}

function sameRelationDescriptor(
  left: AthenaRelationDescriptor,
  right: AthenaRelationDescriptor
): boolean {
  const sameEnd = (leftEnd: AthenaRelationEnd, rightEnd: AthenaRelationEnd) =>
    leftEnd.schema === rightEnd.schema &&
    leftEnd.table === rightEnd.table &&
    leftEnd.columns.length === rightEnd.columns.length &&
    leftEnd.columns.every((column, index) => column === rightEnd.columns[index]);
  const sameJunction =
    left.junction === right.junction ||
    (left.junction !== undefined &&
      right.junction !== undefined &&
      left.junction.schema === right.junction.schema &&
      left.junction.table === right.junction.table &&
      left.junction.fromColumns.length === right.junction.fromColumns.length &&
      left.junction.toColumns.length === right.junction.toColumns.length &&
      left.junction.fromColumns.every(
        (column, index) => column === right.junction?.fromColumns[index]
      ) &&
      left.junction.toColumns.every(
        (column, index) => column === right.junction?.toColumns[index]
      ));
  return (
    left.cardinality === right.cardinality &&
    left.constraint === right.constraint &&
    left.constraintAliases?.length === right.constraintAliases?.length &&
    left.constraintAliases?.every(
      (alias, index) => alias === right.constraintAliases?.[index]
    ) !== false &&
    left.id === right.id &&
    left.name === right.name &&
    left.source === right.source &&
    sameEnd(left.from, right.from) &&
    sameEnd(left.to, right.to) &&
    sameJunction
  );
}

export function catalogFromModelRelations(input: {
  schema?: string;
  table: string;
  relations: Record<string, ModelRelationMetadata>;
}): AthenaRelationCatalog {
  const entries: AthenaRelationDescriptor[] = [];
  for (const [name, relation] of Object.entries(input.relations)) {
    entries.push(assertRelationDescriptor({
        cardinality: relation.kind as ModelRelationKind,
        constraint: canonicalIdentity(
          "constraint",
          "model",
          input.schema,
          input.table,
          relation.constraintName ?? name
        ),
        constraintAliases: relation.constraintName
          ? [relation.constraintName]
          : undefined,
        from: {
          columns: relation.sourceColumns.map(String),
          schema: input.schema,
          table: input.table,
        },
        id: canonicalIdentity("relation", "model", input.schema, input.table, name),
        junction: relation.through
          ? {
              fromColumns: relation.through.sourceColumns.map(String),
              schema: relation.through.schema,
              table: relation.through.model,
              toColumns: relation.through.targetColumns.map(String),
            }
          : undefined,
        name,
        source: "model-metadata",
        to: {
          columns: relation.targetColumns.map(String),
          schema: relation.targetSchema,
          table: relation.targetModel,
        },
    }));
  }
  return { entries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectModels(
  input: unknown,
  found: Array<Record<string, unknown>>
): void {
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
  const seen = new Map<string, AthenaRelationDescriptor>();
  for (const catalog of catalogs) {
    if (!catalog) {
      continue;
    }
    for (const entry of catalog.entries) {
      assertRelationDescriptor(entry);
      const existing = seen.get(entry.id);
      if (existing) {
        if (!sameRelationDescriptor(existing, entry)) {
          throw new AthenaQueryError(
            "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
            `Conflicting relation metadata for ${entry.id}`
          );
        }
        continue;
      }
      if (entry.constraint) {
        const conflictingConstraint = [...seen.values()].find(
          (candidate) =>
            candidate.constraint === entry.constraint && candidate.id !== entry.id
        );
        if (conflictingConstraint) {
          throw new AthenaQueryError(
            "ATHENA_QUERY_RELATION_METADATA_CONFLICT",
            `Conflicting relation metadata for ${entry.constraint}`
          );
        }
      }
      seen.set(entry.id, entry);
      entries.push(entry);
    }
  }
  return { entries };
}

export function resolveRelation(input: {
  catalog: AthenaRelationCatalog;
  constraintId?: string;
  constraintHint?: string;
  name: string;
  relationId?: string;
  relationHint?: string;
  source: AthenaSourceAst;
  targetHint?: AthenaSourceAst;
}): AthenaRelationDescriptor {
  for (const entry of input.catalog.entries) {
    assertRelationDescriptor(entry);
  }
  const constraintHint = input.constraintHint
    ? canonicalizeConstraintSelector(
        input.catalog,
        input.constraintHint,
        input.source,
        input.targetHint
      )
    : undefined;
  const relationHint = input.relationHint
    ? canonicalizeConstraintSelector(
        input.catalog,
        input.relationHint,
        input.source,
        input.targetHint
      )
    : undefined;
  const identityEntries = input.catalog.entries.filter(
    (entry) =>
      (!input.relationId || entry.id === input.relationId) &&
      (!input.constraintId || entry.constraint === input.constraintId)
  );
  const candidates =
    input.relationId || input.constraintId
      ? identityEntries
      : input.catalog.entries;
  const byName = candidates.filter(
    (entry) =>
      entry.name === input.name &&
      hasRelationHint(entry, constraintHint, relationHint) &&
      sameTable(entry.from, input.source) &&
      (!input.targetHint || sameTable(entry.to, input.targetHint))
  );
  if (byName.length === 1) {
    validateRelationMetadata(byName[0] as AthenaRelationDescriptor);
    return {
      ...(byName[0] as AthenaRelationDescriptor),
      direction: "forward",
    };
  }
  if (byName.length > 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_AMBIGUOUS_RELATION",
      `Relation "${input.name}" is ambiguous on ${input.source.table}`
    );
  }

  const targetTable = input.targetHint?.table ?? input.name;
  const targetSchema = input.targetHint?.schema;
  const outgoing = candidates.filter(
    (entry) =>
      hasRelationHint(entry, constraintHint, relationHint) &&
      sameTable(entry.from, input.source) &&
      sameTable(entry.to, { schema: targetSchema, table: targetTable })
  );
  if (outgoing.length === 1) {
    validateRelationMetadata(outgoing[0] as AthenaRelationDescriptor);
    return {
      ...(outgoing[0] as AthenaRelationDescriptor),
      direction: "forward",
    };
  }
  if (outgoing.length > 1) {
    throw new AthenaQueryError(
      "ATHENA_QUERY_AMBIGUOUS_RELATION",
      `Multiple foreign keys from ${input.source.table} to ${targetTable}`
    );
  }

  const incoming = candidates.filter(
    (entry) =>
      hasRelationHint(entry, constraintHint, relationHint) &&
      sameTable(entry.to, input.source) &&
      sameTable(entry.from, { schema: targetSchema, table: targetTable })
  );
  if (incoming.length === 1) {
    const found = incoming[0] as AthenaRelationDescriptor;
    validateRelationMetadata(found);
    return {
      ...found,
      cardinality: invertCardinality(found.cardinality),
      direction: "reverse",
      from: found.to,
      name: input.name,
      junction: found.junction
        ? {
            ...found.junction,
            fromColumns: [...found.junction.toColumns],
            toColumns: [...found.junction.fromColumns],
          }
        : undefined,
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
