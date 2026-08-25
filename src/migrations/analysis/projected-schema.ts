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
  tables: Map<string, ProjectedTable>;
  types: Set<string>;
  views: Set<string>;
}

export function emptyProjectedSchema(): ProjectedSchema {
  return {
    extensions: new Set(),
    functions: new Set(),
    schemas: new Set(["public", "pg_catalog"]),
    tables: new Map(),
    types: new Set(),
    views: new Set(),
  };
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
    tables,
    types: new Set(schema.types),
    views: new Set(schema.views),
  };
}

function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

function functionKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

function ensureTable(schema: ProjectedSchema, schemaName: string, name: string): ProjectedTable {
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
        ensureTable(schema, object.schema, object.table).indexes.add(object.name);
      }
      return;
    case "function":
    case "procedure":
      schema.functions.add(functionKey(object.schema, object.name));
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
      schema.tables.get(tableKey(object.schema, object.table))?.columns.delete(object.name);
      return;
    case "index":
      if (object.table) {
        schema.tables.get(tableKey(object.schema, object.table))?.indexes.delete(object.name);
      }
      return;
    case "function":
    case "procedure":
      schema.functions.delete(functionKey(object.schema, object.name));
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

export function schemaHas(schema: ProjectedSchema, object: SchemaObjectRef): boolean {
  switch (object.kind) {
    case "schema":
      return schema.schemas.has(object.name);
    case "extension":
      return schema.extensions.has(object.name);
    case "table":
      return schema.tables.has(tableKey(object.schema, object.name));
    case "column": {
      const table = schema.tables.get(tableKey(object.schema, object.table));
      return Boolean(table?.columns.has(object.name));
    }
    case "index": {
      if (!object.table) {
        return false;
      }
      return Boolean(
        schema.tables.get(tableKey(object.schema, object.table))?.indexes.has(object.name)
      );
    }
    case "function":
    case "procedure":
      return schema.functions.has(functionKey(object.schema, object.name));
    case "type":
    case "domain":
    case "enum":
      return schema.types.has(`${object.schema}.${object.name}`);
    case "view":
    case "materialized_view":
      return schema.views.has(`${object.schema}.${object.name}`) ||
        schema.tables.has(tableKey(object.schema, object.name));
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
    `functions:${[...schema.functions].sort().join(",")}`,
    `views:${[...schema.views].sort().join(",")}`,
  ].join("|");
}

export function catalogToProjected(objects: readonly SchemaObjectRef[]): ProjectedSchema {
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
