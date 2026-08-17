export {
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "./definitions.ts";
export type {
  FormValuesOf,
  ModelFormAdapter,
  ModelFormDefaults,
  ModelFormNullishMode,
  ModelFormValues,
  ToModelFormDefaultsOptions,
  ToModelPayloadOptions,
} from "./model-form.ts";
export {
  createModelFormAdapter,
  toModelFormDefaults,
  toModelPayload,
} from "./model-form.ts";
export type {
  ModelSqlDialect,
  ModelSqlFile,
  ModelSqlInput,
  ModelSqlOptions,
  ModelsToSqlFilesOptions,
} from "./model-sql.ts";
export {
  collectModelsFromSqlInput,
  modelsToSql,
  modelsToSqlFiles,
  sqlD1,
  sqlPostgres,
  sqlSqlite,
} from "./model-sql.ts";
export type { PostgresIntrospectionProviderOptions } from "./postgres-provider.ts";
export { createPostgresIntrospectionProvider } from "./postgres-provider.ts";
export type {
  AthenaTableDef,
  FormValuesFromColumns,
  InsertFromColumns,
  RowFromColumns,
  UpdateFromColumns,
} from "./table-builder.ts";
export { table } from "./table-builder.ts";
export type {
  AnyColumnBuilder,
  AthenaColumnBuilder,
  ColumnRuntimeConfig,
} from "./table-columns.ts";
export {
  boolean,
  enumeration,
  json,
  number,
  string,
} from "./table-columns.ts";
export type { AthenaTableSchemaBundle } from "./table-schemas.ts";
export type {
  AthenaClientModelForTableName,
  AthenaClientModelsInput,
  AthenaClientTableName,
  AthenaModelTarget,
  DatabaseDef,
  InsertOf,
  IntrospectionColumn,
  IntrospectionInspectOptions,
  IntrospectionRelation,
  IntrospectionSchema,
  IntrospectionSnapshot,
  IntrospectionTable,
  IntrospectionTypeKind,
  ModelAt,
  ModelColumnKind,
  ModelColumnMetadata,
  ModelDef,
  ModelMetadata,
  ModelRelationKind,
  ModelRelationMetadata,
  RegistryDef,
  RowOf,
  SchemaDef,
  SchemaIntrospectionProvider,
  TenantContext,
  TenantContextValue,
  TenantKeyMap,
  UpdateOf,
} from "./types.ts";

// Canonical schema snapshot + structured schema diff (library API)
export {
  ATHENA_INTERNAL_SCHEMAS,
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  SchemaDiffError,
  columnTypesEqual,
  columnsEqual,
  diffSchemas,
  emptySchemaSnapshot,
  isSchemaDiffEmpty,
  normalizeDefaultExpression,
  normalizeReferentialAction,
  normalizeSchemaColumnType,
  normalizeSchemaSnapshot,
  parseSchemaTypeString,
  primaryKeysEqual,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
  summarizeSchemaDiffOperations,
  tableIdentityKey,
  validateSchemaSnapshot,
} from "./diff/index.ts";
export type {
  AthenaSchemaSnapshot,
  DiffSchemasInput,
  DiffSchemasOptions,
  SchemaColumn,
  SchemaColumnType,
  SchemaDiff,
  SchemaDiffErrorCode,
  SchemaDiffOperation,
  SchemaDiffOperationKind,
  SchemaDiffSummary,
  SchemaForeignKey,
  SchemaIndex,
  SchemaNamespace,
  SchemaPrimaryKey,
  SchemaReferentialAction,
  SchemaSnapshotFromIntrospectionOptions,
  SchemaSnapshotFromModelsOptions,
  SchemaTable,
  SchemaTableIdentity,
  SchemaUniqueConstraint,
} from "./diff/index.ts";
