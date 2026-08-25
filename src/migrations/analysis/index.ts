export {
  ANALYSIS_IR_VERSION,
  PARSER_ID,
  formatObjectRef,
  objectKey,
  offsetToPosition,
} from "./ast.ts";
export type {
  ColumnRef,
  SchemaObjectRef,
  SqlSourceLocation,
  TableRef,
} from "./ast.ts";
export { analyzeMigrationFile } from "./analyzer.ts";
export { emptyPhysicalCatalog, inspectPhysicalCatalog } from "./catalog.ts";
export type { PhysicalCatalog } from "./catalog.ts";
export {
  analyzeAll,
  compileMigrations,
  explainMigration,
  formatPreflightFailure,
} from "./compiler.ts";
export type { CompileMigrationsResult } from "./compiler.ts";
export {
  buildMigrationGraph,
  formatMigrationGraph,
} from "./dependency-graph.ts";
export { DIAGNOSTIC_CODES, formatDiagnostic } from "./diagnostics.ts";
export type { DriftClassification, MigrationDiagnostic } from "./diagnostics.ts";
export { parsePostgresSql } from "./parser.ts";
export {
  applyAnalysis,
  catalogToProjected,
  emptyProjectedSchema,
  fingerprintProjectedSchema,
  schemaHas,
} from "./projected-schema.ts";
export type { ProjectedSchema } from "./projected-schema.ts";
export type { MigrationAnalysis, SemanticDependency } from "./semantic-ir.ts";
export { findProvider, verifyAppliedDrift, verifyMigrationAgainstSchema } from "./verifier.ts";
