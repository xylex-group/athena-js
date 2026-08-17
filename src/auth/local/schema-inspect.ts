import type { AthenaAuthDatabase } from "./database.ts";
import { assertQueryResult } from "./database.ts";
import type { SchemaExpectation } from "./schema-manifest.ts";

export type AthenaAuthSchemaDriftKind =
  | "missing-schema"
  | "missing-table"
  | "missing-column"
  | "column-mismatch"
  | "missing-index"
  | "missing-constraint";

export interface AthenaAuthSchemaDrift {
  kind: AthenaAuthSchemaDriftKind;
  object: string;
  expected?: unknown;
  actual?: unknown;
}

interface CatalogSnapshot {
  schemas: Set<string>;
  tables: Set<string>;
  columns: Set<string>;
  indexes: Set<string>;
  constraints: Set<string>;
}

async function loadCatalogSnapshot(
  db: AthenaAuthDatabase
): Promise<CatalogSnapshot> {
  const schemasResult = assertQueryResult<{ nspname: string }>(
    await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname = 'athena'`
    ),
    "schema-inspect schemas"
  );

  const tablesResult = assertQueryResult<{
    table_schema: string;
    table_name: string;
  }>(
    await db.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema = 'athena'
         AND table_type = 'BASE TABLE'`
    ),
    "schema-inspect tables"
  );

  const columnsResult = assertQueryResult<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(
    await db.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'athena'`
    ),
    "schema-inspect columns"
  );

  const indexesResult = assertQueryResult<{
    schemaname: string;
    indexname: string;
  }>(
    await db.query<{ schemaname: string; indexname: string }>(
      `SELECT schemaname, indexname
       FROM pg_catalog.pg_indexes
       WHERE schemaname = 'athena'`
    ),
    "schema-inspect indexes"
  );

  const constraintsResult = assertQueryResult<{
    table_schema: string;
    table_name: string;
    constraint_name: string;
  }>(
    await db.query<{
      table_schema: string;
      table_name: string;
      constraint_name: string;
    }>(
      `SELECT table_schema, table_name, constraint_name
       FROM information_schema.table_constraints
       WHERE table_schema = 'athena'`
    ),
    "schema-inspect constraints"
  );

  return {
    schemas: new Set(schemasResult.rows.map((row) => row.nspname)),
    tables: new Set(
      tablesResult.rows.map((row) => `${row.table_schema}.${row.table_name}`)
    ),
    columns: new Set(
      columnsResult.rows.map(
        (row) => `${row.table_schema}.${row.table_name}.${row.column_name}`
      )
    ),
    indexes: new Set(
      indexesResult.rows.map((row) => `${row.schemaname}.${row.indexname}`)
    ),
    constraints: new Set(
      constraintsResult.rows.map(
        (row) =>
          `${row.table_schema}.${row.table_name}.${row.constraint_name}`
      )
    ),
  };
}

function evaluateExpectation(
  expectation: SchemaExpectation,
  catalog: CatalogSnapshot
): AthenaAuthSchemaDrift | undefined {
  switch (expectation.kind) {
    case "schema": {
      const name = expectation.schema ?? expectation.name ?? "";
      if (!catalog.schemas.has(name)) {
        return {
          kind: "missing-schema",
          object: expectation.object,
          expected: name,
        };
      }
      return undefined;
    }
    case "table": {
      if (!catalog.tables.has(expectation.object)) {
        return {
          kind: "missing-table",
          object: expectation.object,
          expected: expectation.object,
        };
      }
      return undefined;
    }
    case "column": {
      if (!catalog.columns.has(expectation.object)) {
        return {
          kind: "missing-column",
          object: expectation.object,
          expected: expectation.object,
        };
      }
      return undefined;
    }
    case "index": {
      if (!catalog.indexes.has(expectation.object)) {
        return {
          kind: "missing-index",
          object: expectation.object,
          expected: expectation.object,
        };
      }
      return undefined;
    }
    case "constraint": {
      if (!catalog.constraints.has(expectation.object)) {
        return {
          kind: "missing-constraint",
          object: expectation.object,
          expected: expectation.object,
        };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Compare structural expectations against live PostgreSQL catalogs.
 */
export async function inspectAthenaAuthExpectations(
  db: AthenaAuthDatabase,
  expectations: readonly SchemaExpectation[]
): Promise<AthenaAuthSchemaDrift[]> {
  if (expectations.length === 0) {
    return [];
  }
  const catalog = await loadCatalogSnapshot(db);
  const drift: AthenaAuthSchemaDrift[] = [];
  for (const expectation of expectations) {
    const item = evaluateExpectation(expectation, catalog);
    if (item) {
      drift.push(item);
    }
  }
  return drift;
}
