import {
  foreignKeyMatchKey,
  indexStructuralKey,
  tableIdentityKeyParts,
  uniqueStructuralKey,
} from "./identity.ts";
import {
  columnTypesEqual,
  columnsEqual,
  normalizeSchemaSnapshot,
  primaryKeysEqual,
} from "./normalize.ts";
import { summarizeSchemaDiffOperations } from "./summary.ts";
import type {
  AthenaSchemaSnapshot,
  DiffSchemasInput,
  DiffSchemasOptions,
  SchemaColumn,
  SchemaDiff,
  SchemaDiffOperation,
  SchemaForeignKey,
  SchemaIndex,
  SchemaTable,
  SchemaTableIdentity,
  SchemaUniqueConstraint,
} from "./types.ts";
import { validateSchemaSnapshot } from "./validate.ts";

const OPERATION_KIND_ORDER: Readonly<Record<SchemaDiffOperation["kind"], number>> =
  {
    drop_foreign_key: 10,
    drop_index: 20,
    drop_unique_constraint: 30,
    drop_primary_key: 40,
    drop_column: 50,
    drop_table: 60,
    drop_schema: 70,
    create_schema: 80,
    create_table: 90,
    rename_table: 100,
    add_column: 110,
    rename_column: 120,
    alter_column: 130,
    add_primary_key: 140,
    add_unique_constraint: 150,
    add_index: 160,
    add_foreign_key: 170,
    alter_foreign_key: 180,
  };

function tableId(table: SchemaTable): SchemaTableIdentity {
  return { schema: table.schema, name: table.name };
}

function operationSortKey(op: SchemaDiffOperation): string {
  const kindOrder = String(OPERATION_KIND_ORDER[op.kind]).padStart(3, "0");
  switch (op.kind) {
    case "create_schema":
    case "drop_schema":
      return `${kindOrder}\u0000${op.schema}`;
    case "create_table":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}`;
    case "drop_table":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}`;
    case "rename_table":
      return `${kindOrder}\u0000${op.from.schema}\u0000${op.from.name}\u0000${op.to.name}`;
    case "add_column":
    case "drop_column":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.column.name}`;
    case "rename_column":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.from}\u0000${op.to}`;
    case "alter_column":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.column}`;
    case "add_primary_key":
    case "drop_primary_key":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.primaryKey.columns.join(",")}`;
    case "add_unique_constraint":
    case "drop_unique_constraint":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.unique.columns.join(",")}`;
    case "add_foreign_key":
    case "drop_foreign_key":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${foreignKeyMatchKey(op.foreignKey)}`;
    case "alter_foreign_key":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${foreignKeyMatchKey(op.before)}`;
    case "add_index":
    case "drop_index":
      return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${indexStructuralKey(op.index)}`;
    default: {
      const _never: never = op;
      return kindOrder + String(_never);
    }
  }
}

function sortOperations(
  operations: SchemaDiffOperation[]
): SchemaDiffOperation[] {
  return [...operations].sort((a, b) => {
    const ka = operationSortKey(a);
    const kb = operationSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function indexTables(
  snapshot: AthenaSchemaSnapshot
): Map<string, SchemaTable> {
  const map = new Map<string, SchemaTable>();
  for (const ns of snapshot.schemas) {
    for (const table of ns.tables) {
      map.set(tableIdentityKeyParts(table.schema, table.name), table);
    }
  }
  return map;
}

function indexColumns(table: SchemaTable): Map<string, SchemaColumn> {
  const map = new Map<string, SchemaColumn>();
  for (const column of table.columns) {
    map.set(column.name, column);
  }
  return map;
}

function indexUniques(
  table: SchemaTable
): Map<string, SchemaUniqueConstraint> {
  const map = new Map<string, SchemaUniqueConstraint>();
  for (const unique of table.uniqueConstraints) {
    map.set(uniqueStructuralKey(unique), unique);
  }
  return map;
}

function indexForeignKeys(table: SchemaTable): Map<string, SchemaForeignKey> {
  const map = new Map<string, SchemaForeignKey>();
  for (const fk of table.foreignKeys) {
    map.set(foreignKeyMatchKey(fk), fk);
  }
  return map;
}

function indexIndexes(table: SchemaTable): Map<string, SchemaIndex> {
  const map = new Map<string, SchemaIndex>();
  for (const index of table.indexes) {
    map.set(indexStructuralKey(index), index);
  }
  return map;
}

function diffColumns(
  fromTable: SchemaTable,
  toTable: SchemaTable,
  ops: SchemaDiffOperation[]
): void {
  const identity = tableId(toTable);
  const fromCols = indexColumns(fromTable);
  const toCols = indexColumns(toTable);

  for (const [name, fromCol] of fromCols) {
    if (!toCols.has(name)) {
      ops.push({
        kind: "drop_column",
        table: identity,
        column: fromCol,
      });
    }
  }

  for (const [name, toCol] of toCols) {
    const fromCol = fromCols.get(name);
    if (!fromCol) {
      ops.push({
        kind: "add_column",
        table: identity,
        column: toCol,
      });
      continue;
    }
    if (columnsEqual(fromCol, toCol)) {
      continue;
    }

    const changes: {
      type?: { from: SchemaColumn["type"]; to: SchemaColumn["type"] };
      nullable?: { from: boolean; to: boolean };
      default?: { from: string | null; to: string | null };
      isGenerated?: { from: boolean; to: boolean };
    } = {};

    // Include enumValues (and all other type fields) so enum-label-only
    // changes populate the explicit `changes.type` delta for planners.
    if (!columnTypesEqual(fromCol.type, toCol.type)) {
      changes.type = { from: fromCol.type, to: toCol.type };
    }
    if (fromCol.nullable !== toCol.nullable) {
      changes.nullable = { from: fromCol.nullable, to: toCol.nullable };
    }
    if (fromCol.default !== toCol.default) {
      changes.default = { from: fromCol.default, to: toCol.default };
    }
    if (fromCol.isGenerated !== toCol.isGenerated) {
      changes.isGenerated = {
        from: fromCol.isGenerated,
        to: toCol.isGenerated,
      };
    }

    ops.push({
      kind: "alter_column",
      table: identity,
      column: name,
      before: fromCol,
      after: toCol,
      changes,
    });
  }
}

function diffPrimaryKey(
  fromTable: SchemaTable,
  toTable: SchemaTable,
  ops: SchemaDiffOperation[]
): void {
  const identity = tableId(toTable);
  if (primaryKeysEqual(fromTable.primaryKey, toTable.primaryKey)) {
    return;
  }
  if (fromTable.primaryKey) {
    ops.push({
      kind: "drop_primary_key",
      table: identity,
      primaryKey: fromTable.primaryKey,
    });
  }
  if (toTable.primaryKey) {
    ops.push({
      kind: "add_primary_key",
      table: identity,
      primaryKey: toTable.primaryKey,
    });
  }
}

function diffUniques(
  fromTable: SchemaTable,
  toTable: SchemaTable,
  ops: SchemaDiffOperation[]
): void {
  const identity = tableId(toTable);
  const fromMap = indexUniques(fromTable);
  const toMap = indexUniques(toTable);

  for (const [key, unique] of fromMap) {
    if (!toMap.has(key)) {
      ops.push({
        kind: "drop_unique_constraint",
        table: identity,
        unique,
      });
    }
  }
  for (const [key, unique] of toMap) {
    if (!fromMap.has(key)) {
      ops.push({
        kind: "add_unique_constraint",
        table: identity,
        unique,
      });
    }
  }
}

function foreignKeysEqual(a: SchemaForeignKey, b: SchemaForeignKey): boolean {
  return (
    foreignKeyMatchKey(a) === foreignKeyMatchKey(b) &&
    a.onDelete === b.onDelete &&
    a.onUpdate === b.onUpdate
  );
}

function diffForeignKeys(
  fromTable: SchemaTable,
  toTable: SchemaTable,
  ops: SchemaDiffOperation[]
): void {
  const identity = tableId(toTable);
  const fromMap = indexForeignKeys(fromTable);
  const toMap = indexForeignKeys(toTable);

  for (const [key, fromFk] of fromMap) {
    const toFk = toMap.get(key);
    if (!toFk) {
      ops.push({
        kind: "drop_foreign_key",
        table: identity,
        foreignKey: fromFk,
      });
      continue;
    }
    if (!foreignKeysEqual(fromFk, toFk)) {
      ops.push({
        kind: "alter_foreign_key",
        table: identity,
        before: fromFk,
        after: toFk,
      });
    }
  }

  for (const [key, toFk] of toMap) {
    if (!fromMap.has(key)) {
      ops.push({
        kind: "add_foreign_key",
        table: identity,
        foreignKey: toFk,
      });
    }
  }
}

function diffIndexes(
  fromTable: SchemaTable,
  toTable: SchemaTable,
  ops: SchemaDiffOperation[]
): void {
  const identity = tableId(toTable);
  const fromMap = indexIndexes(fromTable);
  const toMap = indexIndexes(toTable);

  for (const [key, index] of fromMap) {
    if (!toMap.has(key)) {
      ops.push({
        kind: "drop_index",
        table: identity,
        index,
      });
    }
  }
  for (const [key, index] of toMap) {
    if (!fromMap.has(key)) {
      ops.push({
        kind: "add_index",
        table: identity,
        index,
      });
    }
  }
}

function diffTable(
  fromTable: SchemaTable,
  toTable: SchemaTable,
  ops: SchemaDiffOperation[]
): void {
  diffColumns(fromTable, toTable, ops);
  diffPrimaryKey(fromTable, toTable, ops);
  diffUniques(fromTable, toTable, ops);
  diffForeignKeys(fromTable, toTable, ops);
  diffIndexes(fromTable, toTable, ops);
}

/**
 * Compare two schema snapshots.
 *
 * Direction: operations transform `from` (actual) → `to` (desired).
 * Pure: does not mutate inputs; does not require a database; never emits SQL.
 *
 * Rename inference is intentionally not automatic (false renames are worse than
 * drop+create). `rename_table` / `rename_column` kinds exist for explicit future use.
 */
export function diffSchemas(
  input: DiffSchemasInput,
  options: DiffSchemasOptions = {}
): SchemaDiff {
  const shouldValidate = options.validate !== false;

  // Deep structural freeze via normalize copies — originals untouched.
  const fromNormalized = normalizeSchemaSnapshot(input.from);
  const toNormalized = normalizeSchemaSnapshot(input.to);

  if (shouldValidate) {
    validateSchemaSnapshot(fromNormalized);
    validateSchemaSnapshot(toNormalized);
  }

  const ops: SchemaDiffOperation[] = [];
  const fromTables = indexTables(fromNormalized);
  const toTables = indexTables(toNormalized);

  const fromSchemas = new Set(fromNormalized.schemas.map((s) => s.name));
  const toSchemas = new Set(toNormalized.schemas.map((s) => s.name));

  for (const name of fromSchemas) {
    if (!toSchemas.has(name)) {
      ops.push({ kind: "drop_schema", schema: name });
    }
  }
  for (const name of toSchemas) {
    if (!fromSchemas.has(name)) {
      ops.push({ kind: "create_schema", schema: name });
    }
  }

  for (const [key, fromTable] of fromTables) {
    if (!toTables.has(key)) {
      ops.push({
        kind: "drop_table",
        table: tableId(fromTable),
        previous: fromTable,
      });
    }
  }

  for (const [key, toTable] of toTables) {
    const fromTable = fromTables.get(key);
    if (!fromTable) {
      ops.push({
        kind: "create_table",
        table: toTable,
      });
      continue;
    }
    diffTable(fromTable, toTable, ops);
  }

  const operations = sortOperations(ops);
  const summary = summarizeSchemaDiffOperations(operations);
  return {
    operations,
    summary,
    isEmpty: operations.length === 0,
  };
}

/** Convenience: true when normalized snapshots are equivalent. */
export function isSchemaDiffEmpty(diff: SchemaDiff): boolean {
  return diff.isEmpty;
}

/**
 * Build an empty Athena schema snapshot (useful for tests / baselines).
 */
export function emptySchemaSnapshot(
  backend: string | null = null
): AthenaSchemaSnapshot {
  return normalizeSchemaSnapshot({
    version: 1,
    backend,
    schemas: [],
  });
}
