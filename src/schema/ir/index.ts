export { canonicalizeAthenaSchemaIr } from "./canonicalize.ts";
export type {
  SchemaColumn,
  SchemaColumnGenerationStrategy,
} from "./column.ts";
export {
  isAthenaSchemaIr,
  type SchemaIrFromIntrospectionOptions,
  type SchemaIrFromModelsOptions,
  schemaIrFromIntrospection,
  schemaIrFromModels,
  schemaIrFromSnapshot,
  schemaIrFromTable,
  schemaSnapshotFromIr,
} from "./compatibility.ts";
export type {
  SchemaCheckConstraint,
  SchemaConstraint,
  SchemaForeignKeyConstraint,
  SchemaPrimaryKeyConstraint,
  SchemaReferentialAction,
  SchemaUniqueConstraint,
} from "./constraint.ts";
export type { SchemaDatabase } from "./database.ts";
export { type AthenaSchemaIr, emptyAthenaSchemaIr } from "./document.ts";
export { fingerprintAthenaSchemaIr } from "./fingerprint.ts";
export {
  asSchemaObjectId,
  physicalIdentityKey,
  type SchemaNameTriple,
  type SchemaObjectId,
  type SchemaObjectIdentity,
  schemaNameTriple,
  schemaObjectIdentity,
} from "./identity.ts";
export type { SchemaIndex, SchemaIndexColumn } from "./indexes.ts";
export type {
  SchemaIrProvenance,
  SchemaIrProvenanceSource,
  SchemaMetadata,
} from "./metadata.ts";
export type { SchemaEnum, SchemaNamespace } from "./namespace.ts";
export type {
  SchemaRelation,
  SchemaRelationCardinality,
  SchemaRelationThrough,
} from "./relation.ts";
export type { SchemaTable } from "./table.ts";
export type {
  NativeTypeDescriptor,
  PostgresIntervalQualifier,
  SchemaEnumType,
  SchemaNativeOnlyType,
  SchemaScalarType,
  SchemaType,
} from "./type.ts";
export { SchemaIrError, validateAthenaSchemaIr } from "./validate.ts";
export {
  ATHENA_SCHEMA_IR_KIND,
  ATHENA_SCHEMA_IR_VERSION,
  type AthenaSchemaIrKind,
  type AthenaSchemaIrVersion,
} from "./version.ts";
