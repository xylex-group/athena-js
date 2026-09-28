/**
 * Athena JS application SQL migrations (Node / CLI tooling only).
 *
 * Do not import from browser or React Native bundles.
 * Runtime clients (`createClient`, etc.) never execute migrations.
 */

export type {
  AthenaSchemaSnapshot,
  DiffSchemasInput,
  DiffSchemasOptions,
  SchemaColumn,
  SchemaDiff,
  SchemaDiffOperation,
  SchemaDiffSummary,
  SchemaForeignKey,
  SchemaIndex,
  SchemaNamespace,
  SchemaTable,
  SchemaTableIdentity,
} from "../schema/diff/index.ts";
/**
 * Schema Diff foundation (snapshot IR + structured operations).
 * Does not execute migrations or emit SQL — see `docs/schema-diff.md`.
 */
export {
  ATHENA_INTERNAL_SCHEMAS,
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  diffSchemas,
  emptySchemaSnapshot,
  isSchemaDiffEmpty,
  normalizeSchemaSnapshot,
  SchemaDiffError,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
  validateSchemaSnapshot,
} from "../schema/diff/index.ts";
export type {
  CompileMigrationsResult,
  MigrationAnalysis,
  MigrationDiagnostic,
} from "./analysis/index.ts";
export {
  toCanonicalAnalysis,
  toCanonicalDiagnostic,
  toCanonicalMigration,
  toCanonicalReceipt,
} from "./canonical.ts";
export type {
  CanonicalMigrationAnalysisV1,
  CanonicalMigrationBackend,
  CanonicalMigrationDefinitionV1,
  CanonicalMigrationReceiptV1,
  CanonicalMigrationPlanV1,
  CanonicalTransactionScope,
} from "./canonical.ts";
export {
  analyzeMigrationFile,
  compileMigrations,
  DIAGNOSTIC_CODES,
} from "./analysis/index.ts";
export type { MigrationBackend } from "./backend.ts";
export {
  checksumMigrationSql,
  IDENTITY_MIGRATION_EXECUTION_TRANSFORM,
  resolveMigrationExecution,
} from "./checksum.ts";
export {
  DEFAULT_MANAGED_AUTH_MIGRATIONS_DIRECTORY,
  DEFAULT_MIGRATIONS_DIRECTORY,
} from "./constants.ts";
export {
  discoverMigrations,
  parseMigrationFilename,
} from "./discovery.ts";
export type {
  EnsureApplicationMigrationsDirectoryOptions,
  EnsureApplicationMigrationsDirectoryResult,
} from "./ensure-directory.ts";
export { ensureApplicationMigrationsDirectory } from "./ensure-directory.ts";
export type {
  DirtyMigrationWorktree,
  DirtyWorktreeEntry,
} from "./git-worktree.ts";
export {
  formatDirtyMigrationError,
  inspectDirtyMigrationWorktree,
  parseGitPorcelainLine,
} from "./git-worktree.ts";
export type {
  EnsureAthenaProjectLayoutResult,
  ManagedAuthFileInspection,
  ManagedAuthInspection,
  ManagedAuthMigrationArtifact,
  MaterializeManagedAuthMigrationsResult,
} from "./managed-auth.ts";
export {
  ensureAthenaProjectLayout,
  formatManagedAuthDrift,
  inspectManagedAuthMigrations,
  listManagedAuthMigrationArtifacts,
  MANAGED_AUTH_MIGRATION_HEADER,
  materializeManagedAuthMigrations,
} from "./managed-auth.ts";
export {
  planHasBlockingConflicts,
  planMigrations,
} from "./planner.ts";
export type { EmbeddedModuleSection } from "./embedded-modules-inspect.ts";
export {
  ATHENA_MIGRATION_LOCK_KEY1,
  ATHENA_MIGRATION_LOCK_KEY2,
  applyDatabaseToConnectionString,
  buildPostgresMigrationPoolOptions,
  createPostgresMigrationBackend,
  PostgresMigrationBackend,
} from "./postgres.ts";
export type {
  ArchivedMigrationSource,
  MigrationReconciliationAction,
  ReconciliationClassification,
  ReconciliationConfidence,
  ReconciliationReport,
  VersionReconciliation,
} from "./reconciliation/index.ts";
export {
  assembleReconciliationReport,
  buildReconciliationReport,
  formatReconciliationReport,
  isHighAutoRepair,
  reconcileVersion,
} from "./reconciliation/index.ts";
export {
  applicationRowsFromPlan,
  authRowsFromPlan,
  buildMigrationReportView,
} from "./report.ts";
export { runMigrations } from "./runner.ts";
export {
  createSqliteMigrationBackend,
  runSqliteMigrations,
  SqliteLocalMigrationBackend,
} from "./sqlite.ts";
export {
  freezePreparedMigrations,
  inspectSourceControl,
  parsePorcelainV2,
} from "./source-control/index.ts";
export {
  assertMigrationSqlAllowsOuterTransaction,
  findTransactionControlStatement,
  stripSqlCommentsAndLiterals,
} from "./sql-guards.ts";
export type {
  AppliedMigration,
  AppliedMigrationResult,
  MigrationBackendContext,
  MigrationCommandMode,
  MigrationConflict,
  MigrationConflictKind,
  MigrationDisplayStatus,
  MigrationFile,
  MigrationExecutionTransform,
  MigrationPlan,
  MigrationPlanEntry,
  MigrationPlanStatus,
  MigrationRunSummary,
  RunMigrationsOptions,
  MigrationTransactionScope,
} from "./types.ts";
export { MigrationError } from "./types.ts";
