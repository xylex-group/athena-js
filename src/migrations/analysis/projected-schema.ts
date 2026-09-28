import { formatObjectRef, objectKey, type SchemaObjectRef } from "./ast.ts";
import type { MigrationAnalysis } from "./semantic-ir.ts";

export interface ProjectedTable {
  columns: Set<string>;
  indexes: Set<string>;
  name: string;
  schema: string;
}

export interface ProjectedSchema {
  extensions: Set<string>;
  functions: Set<string>;
  schemas: Set<string>;
  sequences: Set<string>;
  tables: Map<string, ProjectedTable>;
  types: Set<string>;
  views: Set<string>;
}

export const PHYSICAL_CATALOG_CAPABILITIES = {
  columns: true,
  constraints: false,
  extensions: true,
  indexes: false,
  policies: false,
  relations: true,
  routines: true,
  schemas: true,
  sequences: true,
  triggers: false,
  types: true,
} as const;

export function isPhysicalCatalogObservable(
  object: SchemaObjectRef
): boolean {
  switch (object.kind) {
    case "column":
      return PHYSICAL_CATALOG_CAPABILITIES.columns;
    case "extension":
      return PHYSICAL_CATALOG_CAPABILITIES.extensions;
    case "function":
    case "procedure":
      return PHYSICAL_CATALOG_CAPABILITIES.routines;
    case "schema":
      return PHYSICAL_CATALOG_CAPABILITIES.schemas;
    case "sequence":
      return PHYSICAL_CATALOG_CAPABILITIES.sequences;
    case "table":
    case "view":
    case "materialized_view":
      return PHYSICAL_CATALOG_CAPABILITIES.relations;
    case "type":
    case "domain":
    case "enum":
      return PHYSICAL_CATALOG_CAPABILITIES.types;
    default:
      return false;
  }
}

export function emptyProjectedSchema(): ProjectedSchema {
  return {
    extensions: new Set(),
    functions: new Set(),
    schemas: new Set(["public", "pg_catalog"]),
    sequences: new Set(),
    tables: new Map(),
    types: new Set(),
    views: new Set(),
  };
}

export function mergeProjectedSchemas(
  base: ProjectedSchema,
  extra: ProjectedSchema
): ProjectedSchema {
  const merged = cloneProjectedSchema(base);
  for (const name of extra.schemas) {
    merged.schemas.add(name);
  }
  for (const name of extra.extensions) {
    merged.extensions.add(name);
  }
  for (const name of extra.functions) {
    merged.functions.add(name);
  }
  for (const name of extra.sequences) {
    merged.sequences.add(name);
  }
  for (const name of extra.types) {
    merged.types.add(name);
  }
  for (const name of extra.views) {
    merged.views.add(name);
  }
  for (const [key, table] of extra.tables) {
    const existing = merged.tables.get(key);
    if (!existing) {
      merged.tables.set(key, {
        columns: new Set(table.columns),
        indexes: new Set(table.indexes),
        name: table.name,
        schema: table.schema,
      });
      continue;
    }
    for (const column of table.columns) {
      existing.columns.add(column);
    }
    for (const index of table.indexes) {
      existing.indexes.add(index);
    }
  }
  return merged;
}

export function cloneProjectedSchema(schema: ProjectedSchema): ProjectedSchema {
  const tables = new Map<string, ProjectedTable>();
  for (const [key, table] of schema.tables) {
    tables.set(key, {
      columns: new Set(table.columns),
      indexes: new Set(table.indexes),
      name: table.name,
      schema: table.schema,
    });
  }
  return {
    extensions: new Set(schema.extensions),
    functions: new Set(schema.functions),
    schemas: new Set(schema.schemas),
    sequences: new Set(schema.sequences),
    tables,
    types: new Set(schema.types),
    views: new Set(schema.views),
  };
}

function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

function functionKeys(
  object: Extract<SchemaObjectRef, { kind: "function" | "procedure" }>
): string[] {
  const base = object.schema ? `${object.schema}.${object.name}` : object.name;
  if (object.identityArguments && object.identityArguments.length > 0) {
    return [`${base}(${object.identityArguments.join(",")})`, base];
  }
  return [base];
}

function ensureTable(
  schema: ProjectedSchema,
  schemaName: string,
  name: string
): ProjectedTable {
  const key = tableKey(schemaName, name);
  const existing = schema.tables.get(key);
  if (existing) {
    return existing;
  }
  const created: ProjectedTable = {
    columns: new Set(),
    indexes: new Set(),
    name,
    schema: schemaName,
  };
  schema.tables.set(key, created);
  schema.schemas.add(schemaName);
  return created;
}

function applyCreate(schema: ProjectedSchema, object: SchemaObjectRef): void {
  switch (object.kind) {
    case "schema":
      schema.schemas.add(object.name);
      return;
    case "extension":
      schema.extensions.add(object.name);
      return;
    case "table":
      ensureTable(schema, object.schema, object.name);
      return;
    case "column":
      ensureTable(schema, object.schema, object.table).columns.add(object.name);
      return;
    case "index":
      if (object.table) {
        ensureTable(schema, object.schema, object.table).indexes.add(
          object.name
        );
      }
      return;
    case "function":
    case "procedure": {
      const keys = functionKeys(object);
      for (const key of keys) {
        schema.functions.add(key);
      }
      return;
    }
    case "sequence":
      schema.sequences.add(tableKey(object.schema, object.name));
      schema.schemas.add(object.schema);
      return;
    case "type":
    case "domain":
    case "enum":
      schema.types.add(`${object.schema}.${object.name}`);
      return;
    case "view":
    case "materialized_view":
      schema.views.add(`${object.schema}.${object.name}`);
      return;
    default:
      return;
  }
}

function applyDrop(schema: ProjectedSchema, object: SchemaObjectRef): void {
  switch (object.kind) {
    case "schema":
      schema.schemas.delete(object.name);
      for (const key of [...schema.tables.keys()]) {
        if (key.startsWith(`${object.name}.`)) {
          schema.tables.delete(key);
        }
      }
      return;
    case "table":
      schema.tables.delete(tableKey(object.schema, object.name));
      return;
    case "column":
      schema.tables
        .get(tableKey(object.schema, object.table))
        ?.columns.delete(object.name);
      return;
    case "index":
      if (object.table) {
        schema.tables
          .get(tableKey(object.schema, object.table))
          ?.indexes.delete(object.name);
      }
      return;
    case "function":
    case "procedure": {
      for (const key of functionKeys(object)) {
        schema.functions.delete(key);
      }
      return;
    }
    case "sequence":
      schema.sequences.delete(tableKey(object.schema, object.name));
      return;
    case "type":
    case "domain":
    case "enum":
      schema.types.delete(`${object.schema}.${object.name}`);
      return;
    case "view":
    case "materialized_view":
      schema.views.delete(`${object.schema}.${object.name}`);
      return;
    default:
      return;
  }
}

export function applyEffects(
  schema: ProjectedSchema,
  effects: MigrationAnalysis["effects"]
): ProjectedSchema {
  const next = cloneProjectedSchema(schema);
  for (const object of effects.creates) {
    applyCreate(next, object);
  }
  for (const mutation of effects.modifies) {
    if (mutation.kind === "add_column") {
      applyCreate(next, mutation.object);
    }
    if (mutation.kind === "drop_column") {
      applyDrop(next, mutation.object);
    }
  }
  for (const object of effects.drops) {
    applyDrop(next, object);
  }
  return next;
}

export function applyAnalysis(
  schema: ProjectedSchema,
  analysis: MigrationAnalysis
): ProjectedSchema {
  return applyEffects(schema, analysis.effects);
}

export function schemaHas(
  schema: ProjectedSchema,
  object: SchemaObjectRef
): boolean {
  switch (object.kind) {
    case "schema":
      return schema.schemas.has(object.name);
    case "extension":
      return schema.extensions.has(object.name);
    case "index": {
      if (!object.table) {
        return false;
      }
      return Boolean(
        schema.tables
          .get(tableKey(object.schema, object.table))
          ?.indexes.has(object.name)
      );
    }
    case "function":
    case "procedure": {
      if (
        object.schema === "pg_catalog" ||
        object.schema === "information_schema"
      ) {
        return true;
      }
      if (!object.schema) {
        const suffix = `.${object.name}`;
        for (const key of schema.functions) {
          if (
            key === object.name ||
            key.endsWith(suffix) ||
            key.startsWith(`${object.name}(`)
          ) {
            return true;
          }
        }
        return true;
      }
      return functionKeys(object).some((key) => schema.functions.has(key));
    }
    case "sequence":
      if (!object.schema) {
        const suffix = `.${object.name}`;
        for (const key of schema.sequences) {
          if (key === object.name || key.endsWith(suffix)) {
            return true;
          }
        }
        return false;
      }
      return schema.sequences.has(tableKey(object.schema, object.name));
    case "table":
      if (!object.schema) {
        for (const table of schema.tables.values()) {
          if (table.name === object.name) {
            return true;
          }
        }
        return false;
      }
      return schema.tables.has(tableKey(object.schema, object.name));
    case "column": {
      if (!object.schema) {
        for (const table of schema.tables.values()) {
          if (table.name === object.table && table.columns.has(object.name)) {
            return true;
          }
        }
        return false;
      }
      const table = schema.tables.get(tableKey(object.schema, object.table));
      return Boolean(table?.columns.has(object.name));
    }
    case "type":
    case "domain":
    case "enum":
      return schema.types.has(`${object.schema}.${object.name}`);
    case "view":
    case "materialized_view":
      return (
        schema.views.has(`${object.schema}.${object.name}`) ||
        schema.tables.has(tableKey(object.schema, object.name))
      );
    default:
      return true;
  }
}

export function fingerprintProjectedSchema(schema: ProjectedSchema): string {
  const tables = [...schema.tables.values()]
    .map((table) => {
      const columns = [...table.columns].sort().join(",");
      const indexes = [...table.indexes].sort().join(",");
      return `${table.schema}.${table.name}{${columns}}[${indexes}]`;
    })
    .sort();
  return [
    `schemas:${[...schema.schemas].sort().join(",")}`,
    `tables:${tables.join(";")}`,
    `sequences:${[...schema.sequences].sort().join(",")}`,
    `functions:${[...schema.functions].sort().join(",")}`,
    `views:${[...schema.views].sort().join(",")}`,
  ].join("|");
}

export function catalogToProjected(
  objects: readonly SchemaObjectRef[]
): ProjectedSchema {
  const schema = emptyProjectedSchema();
  for (const object of objects) {
    applyCreate(schema, object);
  }
  return schema;
}

export function missingObjects(
  expected: ProjectedSchema,
  actual: ProjectedSchema
): SchemaObjectRef[] {
  const missing: SchemaObjectRef[] = [];
  for (const name of expected.schemas) {
    if (!actual.schemas.has(name) && name !== "pg_catalog") {
      missing.push({ kind: "schema", name });
    }
  }
  for (const table of expected.tables.values()) {
    const key = tableKey(table.schema, table.name);
    const live = actual.tables.get(key);
    if (!live) {
      missing.push({ kind: "table", name: table.name, schema: table.schema });
      continue;
    }
    for (const column of table.columns) {
      if (!live.columns.has(column)) {
        missing.push({
          kind: "column",
          name: column,
          schema: table.schema,
          table: table.name,
        });
      }
    }
  }
  for (const fn of expected.functions) {
    if (!actual.functions.has(fn)) {
      const [schema, name] = fn.split(".");
      missing.push({ kind: "function", name, schema });
    }
  }
  return missing;
}

export { formatObjectRef, objectKey };
