import { SchemaDiffError } from "./errors.ts";
import { foreignKeyMatchKey, indexStructuralKey, uniqueStructuralKey } from "./identity.ts";
import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  type SchemaTable,
} from "./types.ts";

function validateTable(table: SchemaTable): void {
  const tableLabel = `${table.schema}.${table.name}`;
  const columnNames = new Set<string>();

  for (const column of table.columns) {
    if (columnNames.has(column.name)) {
      throw new SchemaDiffError(
        "duplicate_column",
        `Duplicate column "${column.name}" on table ${tableLabel}`,
        { table: tableLabel, column: column.name }
      );
    }
    columnNames.add(column.name);
  }

  if (table.primaryKey) {
    for (const col of table.primaryKey.columns) {
      if (!columnNames.has(col)) {
        throw new SchemaDiffError(
          "missing_pk_column",
          `Primary key column "${col}" missing on table ${tableLabel}`,
          { table: tableLabel, column: col }
        );
      }
    }
  }

  const uniqueKeys = new Set<string>();
  for (const unique of table.uniqueConstraints) {
    const key = uniqueStructuralKey(unique);
    if (uniqueKeys.has(key)) {
      throw new SchemaDiffError(
        "duplicate_unique",
        `Duplicate unique constraint on ${tableLabel}: (${unique.columns.join(", ")})`,
        { table: tableLabel, columns: unique.columns }
      );
    }
    uniqueKeys.add(key);
    for (const col of unique.columns) {
      if (!columnNames.has(col)) {
        throw new SchemaDiffError(
          "missing_unique_column",
          `Unique constraint column "${col}" missing on table ${tableLabel}`,
          { table: tableLabel, column: col }
        );
      }
    }
  }

  const fkKeys = new Set<string>();
  for (const fk of table.foreignKeys) {
    if (fk.columns.length !== fk.targetColumns.length) {
      throw new SchemaDiffError(
        "fk_arity_mismatch",
        `Foreign key arity mismatch on ${tableLabel}`,
        {
          table: tableLabel,
          columns: fk.columns,
          targetColumns: fk.targetColumns,
        }
      );
    }
    const key = foreignKeyMatchKey(fk);
    if (fkKeys.has(key)) {
      throw new SchemaDiffError(
        "duplicate_foreign_key",
        `Duplicate foreign key on ${tableLabel}`,
        { table: tableLabel, columns: fk.columns }
      );
    }
    fkKeys.add(key);
    for (const col of fk.columns) {
      if (!columnNames.has(col)) {
        throw new SchemaDiffError(
          "missing_fk_column",
          `Foreign key column "${col}" missing on table ${tableLabel}`,
          { table: tableLabel, column: col }
        );
      }
    }
  }

  const indexKeys = new Set<string>();
  for (const index of table.indexes) {
    const key = indexStructuralKey(index);
    if (indexKeys.has(key)) {
      throw new SchemaDiffError(
        "duplicate_index",
        `Duplicate index on ${tableLabel}`,
        { table: tableLabel, columns: index.columns.map((c) => c.name) }
      );
    }
    indexKeys.add(key);
    for (const col of index.columns) {
      if (!columnNames.has(col.name)) {
        throw new SchemaDiffError(
          "missing_index_column",
          `Index column "${col.name}" missing on table ${tableLabel}`,
          { table: tableLabel, column: col.name }
        );
      }
    }
  }
}

/**
 * Fail-closed validation of snapshot invariants before diffing.
 * Does not require FK targets to exist (cross-boundary / unmanaged targets allowed).
 */
export function validateSchemaSnapshot(snapshot: AthenaSchemaSnapshot): void {
  if (!snapshot || typeof snapshot !== "object") {
    throw new SchemaDiffError(
      "invalid_snapshot",
      "Schema snapshot must be an object"
    );
  }

  if (snapshot.version !== ATHENA_SCHEMA_SNAPSHOT_VERSION) {
    throw new SchemaDiffError(
      "unsupported_snapshot_version",
      `Unsupported schema snapshot version: ${String(
        (snapshot as { version?: unknown }).version
      )}`,
      { version: (snapshot as { version?: unknown }).version }
    );
  }

  if (!Array.isArray(snapshot.schemas)) {
    throw new SchemaDiffError(
      "invalid_snapshot",
      "Schema snapshot.schemas must be an array"
    );
  }

  const schemaNames = new Set<string>();
  for (const ns of snapshot.schemas) {
    if (schemaNames.has(ns.name)) {
      throw new SchemaDiffError(
        "duplicate_schema",
        `Duplicate schema namespace "${ns.name}"`,
        { schema: ns.name }
      );
    }
    schemaNames.add(ns.name);

    const tableNames = new Set<string>();
    for (const table of ns.tables) {
      if (table.schema !== ns.name) {
        throw new SchemaDiffError(
          "invalid_snapshot",
          `Table ${table.schema}.${table.name} nested under schema "${ns.name}"`,
          { schema: ns.name, table: `${table.schema}.${table.name}` }
        );
      }
      if (tableNames.has(table.name)) {
        throw new SchemaDiffError(
          "duplicate_table",
          `Duplicate table "${ns.name}.${table.name}"`,
          { schema: ns.name, table: table.name }
        );
      }
      tableNames.add(table.name);
      validateTable(table);
    }
  }
}
