import type { AthenaAuthDatabase } from "./database.ts";
import { assertQueryResult } from "./database.ts";
import type {
  SchemaExpectation,
  SchemaForeignKeyAction,
  SchemaForeignKeyExpectation,
} from "./schema-manifest.ts";

export type AthenaAuthSchemaDriftKind =
  | "missing-schema"
  | "missing-table"
  | "missing-column"
  | "column-mismatch"
  | "missing-index"
  | "missing-constraint"
  | "constraint-mismatch";

export interface AthenaAuthSchemaDrift {
  actual?: unknown;
  expected?: unknown;
  kind: AthenaAuthSchemaDriftKind;
  object: string;
}

interface CatalogSnapshot {
  columns: Set<string>;
  constraintDefinitions: Map<string, string>;
  constraints: Set<string>;
  foreignKeys: Map<string, CatalogForeignKey>;
  indexes: Set<string>;
  schemas: Set<string>;
  tables: Set<string>;
}

interface CatalogForeignKey {
  columns: readonly string[];
  onDelete: SchemaForeignKeyAction;
  onUpdate: SchemaForeignKeyAction;
  references: {
    columns: readonly string[];
    schema: string;
    table: string;
  };
}

const INSPECT_SAVEPOINT = "athena_auth_schema_inspect";

/**
 * Physical catalog probes must not abort an in-flight Auth migrate transaction.
 * PostgreSQL treats any statement error as fatal for the rest of the transaction.
 */
async function withInspectSavepoint<T>(
  db: AthenaAuthDatabase,
  run: () => Promise<T>
): Promise<T> {
  await db.query(`SAVEPOINT ${INSPECT_SAVEPOINT}`);
  try {
    const value = await run();
    await db.query(`RELEASE SAVEPOINT ${INSPECT_SAVEPOINT}`);
    return value;
  } catch (error) {
    try {
      await db.query(`ROLLBACK TO SAVEPOINT ${INSPECT_SAVEPOINT}`);
      await db.query(`RELEASE SAVEPOINT ${INSPECT_SAVEPOINT}`);
    } catch {
      // Session may already be failed closed.
    }
    throw error;
  }
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
  const constraintDefinitionsResult = assertQueryResult<{
    definition: string;
    table_schema: string;
    table_name: string;
    constraint_name: string;
  }>(
    await db.query<{
      definition: string;
      table_schema: string;
      table_name: string;
      constraint_name: string;
    }>(
      `SELECT n.nspname AS table_schema,
              rel.relname AS table_name,
              pg_con.conname AS constraint_name,
              pg_get_constraintdef(pg_con.oid) AS definition
       FROM pg_catalog.pg_constraint AS pg_con
       JOIN pg_catalog.pg_class AS rel
         ON rel.oid = pg_con.conrelid
       JOIN pg_catalog.pg_namespace AS n
         ON n.oid = rel.relnamespace
       WHERE n.nspname = 'athena'`
    ),
    "schema-inspect constraint definitions"
  );
  const foreignKeysResult = assertQueryResult<{
    columns: string[];
    condeferrable: boolean;
    condeferred: boolean;
    confdeltype: string;
    confmatchtype: string;
    confupdtype: string;
    constraint_name: string;
    referenced_columns: string[];
    referenced_schema: string;
    referenced_table: string;
    table_name: string;
    table_schema: string;
  }>(
    await db.query<{
      columns: string[];
      condeferrable: boolean;
      condeferred: boolean;
      confdeltype: string;
      confmatchtype: string;
      confupdtype: string;
      constraint_name: string;
      referenced_columns: string[];
      referenced_schema: string;
      referenced_table: string;
      table_name: string;
      table_schema: string;
    }>(
      `SELECT source_n.nspname AS table_schema,
              source_rel.relname AS table_name,
              pg_con.conname AS constraint_name,
              ARRAY(
                SELECT source_att.attname::text
                FROM unnest(pg_con.conkey) WITH ORDINALITY AS source_key(attnum, position)
                JOIN pg_catalog.pg_attribute AS source_att
                  ON source_att.attrelid = pg_con.conrelid
                 AND source_att.attnum = source_key.attnum
                ORDER BY source_key.position
              ) AS columns,
              referenced_n.nspname AS referenced_schema,
              referenced_rel.relname AS referenced_table,
              ARRAY(
                SELECT referenced_att.attname::text
                FROM unnest(pg_con.confkey) WITH ORDINALITY AS referenced_key(attnum, position)
                JOIN pg_catalog.pg_attribute AS referenced_att
                  ON referenced_att.attrelid = pg_con.confrelid
                 AND referenced_att.attnum = referenced_key.attnum
                ORDER BY referenced_key.position
              ) AS referenced_columns,
              pg_con.confdeltype,
              pg_con.confupdtype,
              pg_con.confmatchtype,
              pg_con.condeferrable,
              pg_con.condeferred
       FROM pg_catalog.pg_constraint AS pg_con
       JOIN pg_catalog.pg_class AS source_rel
         ON source_rel.oid = pg_con.conrelid
       JOIN pg_catalog.pg_namespace AS source_n
         ON source_n.oid = source_rel.relnamespace
       JOIN pg_catalog.pg_class AS referenced_rel
         ON referenced_rel.oid = pg_con.confrelid
       JOIN pg_catalog.pg_namespace AS referenced_n
         ON referenced_n.oid = referenced_rel.relnamespace
       WHERE source_n.nspname = 'athena'
         AND pg_con.contype = 'f'`
    ),
    "schema-inspect foreign keys"
  );

  return {
    columns: new Set(
      columnsResult.rows.map(
        (row) => `${row.table_schema}.${row.table_name}.${row.column_name}`
      )
    ),
    constraintDefinitions: new Map(
      constraintDefinitionsResult.rows.map((row) => [
        `${row.table_schema}.${row.table_name}.${row.constraint_name}`,
        row.definition,
      ])
    ),
    constraints: new Set(
      constraintsResult.rows.map(
        (row) => `${row.table_schema}.${row.table_name}.${row.constraint_name}`
      )
    ),
    foreignKeys: new Map(
      foreignKeysResult.rows.map((row) => [
        `${row.table_schema}.${row.table_name}.${row.constraint_name}`,
        {
          columns: row.columns,
          onDelete: foreignKeyAction(row.confdeltype),
          onUpdate: foreignKeyAction(row.confupdtype),
          references: {
            columns: row.referenced_columns,
            schema: row.referenced_schema,
            table: row.referenced_table,
          },
        },
      ])
    ),
    indexes: new Set(
      indexesResult.rows.map((row) => `${row.schemaname}.${row.indexname}`)
    ),
    schemas: new Set(schemasResult.rows.map((row) => row.nspname)),
    tables: new Set(
      tablesResult.rows.map((row) => `${row.table_schema}.${row.table_name}`)
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
          expected: name,
          kind: "missing-schema",
          object: expectation.object,
        };
      }
      return;
    }
    case "table": {
      if (!catalog.tables.has(expectation.object)) {
        return {
          expected: expectation.object,
          kind: "missing-table",
          object: expectation.object,
        };
      }
      return;
    }
    case "column": {
      if (!catalog.columns.has(expectation.object)) {
        return {
          expected: expectation.object,
          kind: "missing-column",
          object: expectation.object,
        };
      }
      return;
    }
    case "index": {
      if (!catalog.indexes.has(expectation.object)) {
        return {
          expected: expectation.object,
          kind: "missing-index",
          object: expectation.object,
        };
      }
      return;
    }
    case "constraint": {
      if (!catalog.constraints.has(expectation.object)) {
        return {
          expected: expectation.object,
          kind: "missing-constraint",
          object: expectation.object,
        };
      }
      if (expectation.definition != null) {
        const actual = catalog.constraintDefinitions.get(expectation.object);
        if (
          actual == null ||
          !constraintDefinitionsMatch(actual, expectation.definition)
        ) {
          return {
            actual,
            expected: expectation.definition,
            kind: "constraint-mismatch",
            object: expectation.object,
          };
        }
      }
      if (expectation.foreignKey != null) {
        const actual = catalog.foreignKeys.get(expectation.object);
        if (
          actual == null ||
          !foreignKeysMatch(actual, expectation.foreignKey)
        ) {
          return {
            actual,
            expected: expectation.foreignKey,
            kind: "constraint-mismatch",
            object: expectation.object,
          };
        }
      }
      return;
    }
    default:
      return;
  }
}

function foreignKeyAction(value: string): SchemaForeignKeyAction {
  switch (value) {
    case "c":
      return "cascade";
    case "r":
      return "restrict";
    case "n":
      return "set-null";
    case "d":
      return "set-default";
    default:
      return "no-action";
  }
}

function foreignKeysMatch(
  actual: CatalogForeignKey,
  expected: SchemaForeignKeyExpectation
): boolean {
  return (
    arraysEqual(actual.columns, expected.columns) &&
    arraysEqual(actual.references.columns, expected.references.columns) &&
    actual.references.schema === expected.references.schema &&
    actual.references.table === expected.references.table &&
    (expected.onDelete == null || actual.onDelete === expected.onDelete) &&
    (expected.onUpdate == null || actual.onUpdate === expected.onUpdate)
  );
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeDefinition(definition: string): string {
  return definition.replace(/\s+/g, " ").trim().toLowerCase();
}

function unwrapBalancedParens(value: string): string {
  let text = value.trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0 && index < text.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (!wrapsAll) {
      break;
    }
    text = text.slice(1, -1).trim();
  }
  return text;
}

function canonicalConstraintDefinition(definition: string): string {
  let text = normalizeDefinition(definition);
  if (text.startsWith("check ")) {
    text = text.slice("check ".length).trim();
  }
  return unwrapBalancedParens(text);
}

function constraintDefinitionsMatch(actual: string, expected: string): boolean {
  const canonicalActual = canonicalConstraintDefinition(actual);
  const canonicalExpected = canonicalConstraintDefinition(expected);
  return (
    canonicalActual === canonicalExpected ||
    canonicalActual.includes(canonicalExpected) ||
    canonicalExpected.includes(canonicalActual)
  );
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
  const byMigration = await inspectAthenaAuthMigrationExpectations(db, [
    { expectations, version: 0 },
  ]);
  return byMigration.get(0) ?? [];
}

export async function inspectAthenaAuthMigrationExpectations(
  db: AthenaAuthDatabase,
  expectationSets: readonly {
    expectations: readonly SchemaExpectation[];
    version: number;
  }[]
): Promise<ReadonlyMap<number, AthenaAuthSchemaDrift[]>> {
  const inspectCatalog = () =>
    inspectCatalogAgainstExpectations(db, expectationSets);
  if (db.inTransaction !== true) {
    return inspectCatalog();
  }
  return withInspectSavepoint(db, inspectCatalog);
}

async function inspectCatalogAgainstExpectations(
  db: AthenaAuthDatabase,
  expectationSets: readonly {
    expectations: readonly SchemaExpectation[];
    version: number;
  }[]
): Promise<ReadonlyMap<number, AthenaAuthSchemaDrift[]>> {
  const catalog = await loadCatalogSnapshot(db);
  const driftByMigration = new Map<number, AthenaAuthSchemaDrift[]>();
  for (const set of expectationSets) {
    if (set.expectations.length === 0) {
      continue;
    }
    const drift: AthenaAuthSchemaDrift[] = [];
    for (const expectation of set.expectations) {
      const item = evaluateExpectation(expectation, catalog);
      if (item) {
        drift.push(item);
      }
    }
    if (drift.length > 0) {
      driftByMigration.set(set.version, drift);
    }
  }
  return driftByMigration;
}
