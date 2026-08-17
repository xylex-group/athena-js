import type {
  SchemaDiffOperation,
  SchemaDiffSummary,
} from "./types.ts";

const EMPTY_SUMMARY: SchemaDiffSummary = {
  schemasAdded: 0,
  schemasRemoved: 0,
  tablesAdded: 0,
  tablesRemoved: 0,
  tablesRenamed: 0,
  columnsAdded: 0,
  columnsRemoved: 0,
  columnsRenamed: 0,
  columnsChanged: 0,
  primaryKeysAdded: 0,
  primaryKeysRemoved: 0,
  uniquesAdded: 0,
  uniquesRemoved: 0,
  foreignKeysAdded: 0,
  foreignKeysRemoved: 0,
  foreignKeysChanged: 0,
  indexesAdded: 0,
  indexesRemoved: 0,
  totalOperations: 0,
};

/** Derive a lightweight summary from operations (no duplicate mutable state). */
export function summarizeSchemaDiffOperations(
  operations: readonly SchemaDiffOperation[]
): SchemaDiffSummary {
  const summary: {
    -readonly [K in keyof SchemaDiffSummary]: SchemaDiffSummary[K];
  } = { ...EMPTY_SUMMARY, totalOperations: operations.length };

  for (const op of operations) {
    switch (op.kind) {
      case "create_schema":
        summary.schemasAdded += 1;
        break;
      case "drop_schema":
        summary.schemasRemoved += 1;
        break;
      case "create_table":
        summary.tablesAdded += 1;
        break;
      case "drop_table":
        summary.tablesRemoved += 1;
        break;
      case "rename_table":
        summary.tablesRenamed += 1;
        break;
      case "add_column":
        summary.columnsAdded += 1;
        break;
      case "drop_column":
        summary.columnsRemoved += 1;
        break;
      case "rename_column":
        summary.columnsRenamed += 1;
        break;
      case "alter_column":
        summary.columnsChanged += 1;
        break;
      case "add_primary_key":
        summary.primaryKeysAdded += 1;
        break;
      case "drop_primary_key":
        summary.primaryKeysRemoved += 1;
        break;
      case "add_unique_constraint":
        summary.uniquesAdded += 1;
        break;
      case "drop_unique_constraint":
        summary.uniquesRemoved += 1;
        break;
      case "add_foreign_key":
        summary.foreignKeysAdded += 1;
        break;
      case "drop_foreign_key":
        summary.foreignKeysRemoved += 1;
        break;
      case "alter_foreign_key":
        summary.foreignKeysChanged += 1;
        break;
      case "add_index":
        summary.indexesAdded += 1;
        break;
      case "drop_index":
        summary.indexesRemoved += 1;
        break;
      default: {
        const _exhaustive: never = op;
        void _exhaustive;
      }
    }
  }

  return summary;
}
