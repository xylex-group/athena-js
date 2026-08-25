/**
 * Athena JS application SQL migrations (Node / CLI tooling only).
 *
 * Do not import from browser or React Native bundles.
 * Runtime clients (`createClient`, etc.) never execute migrations.
 */

export type { MigrationBackend } from "./backend.ts";
export { checksumMigrationSql } from "./checksum.ts";
export {
  DEFAULT_MANAGED_AUTH_MIGRATIONS_DIRECTORY,
  DEFAULT_MIGRATIONS_DIRECTORY,
} from "./constants.ts";
export {
  ensureApplicationMigrationsDirectory,
} from "./ensure-directory.ts";
export {
  ensureAthenaProjectLayout,
  formatManagedAuthDrift,
  inspectManagedAuthMigrations,
  listManagedAuthMigrationArtifacts,
  materializeManagedAuthMigrations,
  MANAGED_AUTH_MIGRATION_HEADER,
} from "./managed-auth.ts";
export type {
  EnsureAthenaProjectLayoutResult,
  ManagedAuthFileInspection,
  ManagedAuthInspection,
  ManagedAuthMigrationArtifact,
  MaterializeManagedAuthMigrationsResult,
} from "./managed-auth.ts";
export type {
  EnsureApplicationMigrationsDirectoryOptions,
  EnsureApplicationMigrationsDirectoryResult,
} from "./ensure-directory.ts";
export {
  discoverMigrations,
  parseMigrationFilename,
} from "./discovery.ts";
export {
  planHasBlockingConflicts,
  planMigrations,
} from "./planner.ts";
export {
  ATHENA_MIGRATION_LOCK_KEY1,
  ATHENA_MIGRATION_LOCK_KEY2,
  applyDatabaseToConnectionString,
  buildPostgresMigrationPoolOptions,
  createPostgresMigrationBackend,
  PostgresMigrationBackend,
} from "./postgres.ts";
export { runMigrations } from "./runner.ts";
export {
  assembleReconciliationReport,
  buildReconciliationReport,
  formatReconciliationReport,
  isHighAutoRepair,
  reconcileVersion,
} from "./reconciliation/index.ts";
export type {
  ArchivedMigrationSource,
  MigrationReconciliationAction,
  ReconciliationClassification,
  ReconciliationConfidence,
  ReconciliationReport,
  VersionReconciliation,
} from "./reconciliation/index.ts";
export {
  formatDirtyMigrationError,
  inspectDirtyMigrationWorktree,
  parseGitPorcelainLine,
} from "./git-worktree.ts";
export {
  freezePreparedMigrations,
  inspectSourceControl,
  parsePorcelainV2,
} from "./source-control/index.ts";
export type {
  DirtyMigrationWorktree,
  DirtyWorktreeEntry,
} from "./git-worktree.ts";
export {
  analyzeMigrationFile,
  compileMigrations,
  DIAGNOSTIC_CODES,
} from "./analysis/index.ts";
export type {
  CompileMigrationsResult,
  MigrationAnalysis,
  MigrationDiagnostic,
} from "./analysis/index.ts";
export {
  applicationRowsFromPlan,
  authRowsFromPlan,
  buildMigrationReportView,
} from "./report.ts";
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
  MigrationPlan,
  MigrationPlanEntry,
  MigrationPlanStatus,
  MigrationRunSummary,
  RunMigrationsOptions,
} from "./types.ts";
export { MigrationError } from "./types.ts";

/**
 * Schema Diff foundation (snapshot IR + structured operations).
 * Does not execute migrations or emit SQL — see `docs/schema-diff.md`.
 */
export {
  ATHENA_INTERNAL_SCHEMAS,
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  SchemaDiffError,
  diffSchemas,
  emptySchemaSnapshot,
  isSchemaDiffEmpty,
  normalizeSchemaSnapshot,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
  validateSchemaSnapshot,
} from "../schema/diff/index.ts";
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
