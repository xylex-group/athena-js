export { analyzeMigrationFile } from "./analyzer.ts";
export type {
  ColumnRef,
  SchemaObjectRef,
  SqlSourceLocation,
  TableRef,
} from "./ast.ts";
export {
  ANALYSIS_IR_VERSION,
  ANALYZER_ID,
  ANALYZER_SEMANTICS_VERSION,
  formatObjectRef,
  objectKey,
  offsetToPosition,
  PARSER_ID,
} from "./ast.ts";
export { ANALYSIS_CACHE_FILENAME, cacheKey } from "./cache.ts";
export type { PhysicalCatalog } from "./catalog.ts";
export { emptyPhysicalCatalog, inspectPhysicalCatalog } from "./catalog.ts";
export type { CompileMigrationsResult } from "./compiler.ts";
export {
  analyzeAll,
  compileMigrations,
  explainMigration,
  formatPreflightFailure,
} from "./compiler.ts";
export {
  buildMigrationGraph,
  formatMigrationGraph,
} from "./dependency-graph.ts";
export type {
  DriftClassification,
  MigrationDiagnostic,
} from "./diagnostics.ts";
export { DIAGNOSTIC_CODES, formatDiagnostic } from "./diagnostics.ts";
export { parsePostgresSql } from "./parser.ts";
export type { ProjectedSchema } from "./projected-schema.ts";
export {
  applyAnalysis,
  catalogToProjected,
  emptyProjectedSchema,
  fingerprintProjectedSchema,
  mergeProjectedSchemas,
  PHYSICAL_CATALOG_CAPABILITIES,
  schemaHas,
} from "./projected-schema.ts";
export type {
  SchemaProvider,
  SchemaProviderSource,
} from "./schema-provider.ts";
export type { MigrationAnalysis, SemanticDependency } from "./semantic-ir.ts";
export {
  findProvider,
  verifyAppliedDrift,
  verifyMigrationAgainstSchema,
} from "./verifier.ts";
