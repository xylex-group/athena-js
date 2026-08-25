import type { QueryResultRow } from "pg";
import type { AthenaPostgresClient } from "../../postgres/driver.ts";
import type { SchemaObjectRef } from "./ast.ts";
import { catalogToProjected, type ProjectedSchema } from "./projected-schema.ts";

export interface PhysicalCatalog {
  objects: SchemaObjectRef[];
  schema: ProjectedSchema;
}

interface RelRow extends QueryResultRow {
  nspname: string;
  relkind: string;
  relname: string;
}

interface ColRow extends QueryResultRow {
  attname: string;
  nspname: string;
  relname: string;
}

interface FnRow extends QueryResultRow {
  nspname: string;
  proname: string;
}

const CATALOG_SQL = `
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND c.relkind IN ('r', 'v', 'm', 'S')
`.trim();

const COLUMN_SQL = `
SELECT n.nspname, c.relname, a.attname
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND c.relkind IN ('r', 'v', 'm')
  AND a.attnum > 0
  AND NOT a.attisdropped
`.trim();

const FUNCTION_SQL = `
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
`.trim();

const SCHEMA_SQL = `
SELECT nspname
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND nspname NOT LIKE 'pg_toast%'
  AND nspname NOT LIKE 'pg_temp%'
`.trim();

export async function inspectPhysicalCatalog(
  client: AthenaPostgresClient
): Promise<PhysicalCatalog> {
  const objects: SchemaObjectRef[] = [];
  const schemas = await client.query<{ nspname: string } & QueryResultRow>(SCHEMA_SQL);
  for (const row of schemas.rows) {
    objects.push({ kind: "schema", name: row.nspname });
  }
  const rels = await client.query<RelRow>(CATALOG_SQL);
  for (const row of rels.rows) {
    if (row.relkind === "S") {
      objects.push({ kind: "sequence", name: row.relname, schema: row.nspname });
      continue;
    }
    if (row.relkind === "v") {
      objects.push({ kind: "view", name: row.relname, schema: row.nspname });
      continue;
    }
    if (row.relkind === "m") {
      objects.push({
        kind: "materialized_view",
        name: row.relname,
        schema: row.nspname,
      });
      continue;
    }
    objects.push({ kind: "table", name: row.relname, schema: row.nspname });
  }
  const columns = await client.query<ColRow>(COLUMN_SQL);
  for (const row of columns.rows) {
    objects.push({
      kind: "column",
      name: row.attname,
      schema: row.nspname,
      table: row.relname,
    });
  }
  const functions = await client.query<FnRow>(FUNCTION_SQL);
  for (const row of functions.rows) {
    objects.push({ kind: "function", name: row.proname, schema: row.nspname });
  }
  return { objects, schema: catalogToProjected(objects) };
}

export function emptyPhysicalCatalog(): PhysicalCatalog {
  return { objects: [], schema: catalogToProjected([]) };
}
