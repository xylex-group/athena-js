/**
 * Production-grade Athena-managed schema snapshot + structured schema diff.
 *
 * Pipeline:
 *   AthenaModels | Postgres introspection
 *        → AthenaSchemaSnapshot
 *        → normalizeSchemaSnapshot
 *        → diffSchemas({ from: actual, to: desired })
 *        → SchemaDiff (operations + summary)
 *
 * Does not generate SQL, classify risk, plan migrations, or detect drift policy.
 */

export {
  diffSchemas,
  emptySchemaSnapshot,
  isSchemaDiffEmpty,
} from "./diff.ts";
export { SchemaDiffError, type SchemaDiffErrorCode } from "./errors.ts";
export {
  ATHENA_INTERNAL_SCHEMAS,
  type SchemaSnapshotFromIntrospectionOptions,
  schemaSnapshotFromIntrospection,
} from "./from-introspection.ts";
export {
  type SchemaSnapshotFromModelsOptions,
  schemaSnapshotFromModels,
} from "./from-models.ts";
export {
  compareStrings,
  compareTableIdentity,
  foreignKeyMatchKey,
  foreignKeyStructuralKey,
  indexStructuralKey,
  tableIdentityKey,
  tableIdentityKeyParts,
  uniqueStructuralKey,
} from "./identity.ts";
export {
  columnsEqual,
  columnTypesEqual,
  normalizeDefaultExpression,
  normalizeReferentialAction,
  normalizeSchemaColumnType,
  normalizeSchemaSnapshot,
  parseSchemaTypeString,
  primaryKeysEqual,
} from "./normalize.ts";
export { summarizeSchemaDiffOperations } from "./summary.ts";
export {
  type AddColumnOperation,
  type AddForeignKeyOperation,
  type AddIndexOperation,
  type AddPrimaryKeyOperation,
  type AddUniqueConstraintOperation,
  type AlterColumnOperation,
  type AlterForeignKeyOperation,
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  type CreateSchemaOperation,
  type CreateTableOperation,
  type DiffSchemasInput,
  type DiffSchemasOptions,
  type DropColumnOperation,
  type DropForeignKeyOperation,
  type DropIndexOperation,
  type DropPrimaryKeyOperation,
  type DropSchemaOperation,
  type DropTableOperation,
  type DropUniqueConstraintOperation,
  type RenameColumnOperation,
  type RenameTableOperation,
  type SchemaColumn,
  type SchemaColumnChange,
  type SchemaColumnChanges,
  type SchemaColumnGenerationStrategy,
  type SchemaColumnType,
  type SchemaDiff,
  type SchemaDiffOperation,
  type SchemaDiffOperationKind,
  type SchemaDiffSummary,
  type SchemaForeignKey,
  type SchemaIndex,
  type SchemaIndexColumn,
  type SchemaNamespace,
  type SchemaPrimaryKey,
  type SchemaReferentialAction,
  type SchemaTable,
  type SchemaTableIdentity,
  type SchemaUniqueConstraint,
} from "./types.ts";
export { validateSchemaSnapshot } from "./validate.ts";
