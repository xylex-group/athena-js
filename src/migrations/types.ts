/**
 * Domain types for Athena JS application SQL migrations.
 * Tooling-only — never imported by browser/runtime client paths.
 */

/** Local migration file discovered under the migrations directory. */
export interface MigrationFile {
  checksum: string;
  /**
   * Optional validated execution payload. `sql` remains the authored source of
   * truth for checksums, provenance, and archival.
   */
  executionSql?: string;
  executionTransform?: MigrationExecutionTransform;
  executionId?: string;
  filename: string;
  name: string;
  path: string;
  provenance?: import("./source-control/types.ts").MigrationFileProvenance;
  sourceDirty?: boolean;
  sql: string;
  version: number;
}

/** Row persisted in the application migration ledger. */
export interface AppliedMigration {
  appliedAt: Date;
  checksum: string;
  executionChecksum?: string;
  executionId?: string;
  executionMs: number;
  name: string;
  postSchemaFingerprint?: string;
  preSchemaFingerprint?: string;
  executionTransformId?: string;
  executionTransformVersion?: string;
  executionSql?: string;
  sourceBlobSha?: string;
  sourceBranch?: string;
  sourceCommit?: string;
  sourceDirty?: boolean;
  sourcePath?: string;
  sourceRepository?: string;
  version: number;
}

export interface MigrationExecutionTransform {
  id: string;
  version: string;
}

export type MigrationPlanStatus = "applied" | "pending";

export type MigrationConflictKind =
  | "checksum-mismatch"
  | "missing-local"
  | "name-mismatch"
  | "historical-insertion"
  | "duplicate-version";

export type MigrationDisplayStatus =
  | MigrationPlanStatus
  | MigrationConflictKind;

export interface MigrationPlanEntry {
  migration: MigrationFile;
  status: MigrationPlanStatus;
}

export interface MigrationConflict {
  applied?: AppliedMigration;
  kind: MigrationConflictKind;
  local?: MigrationFile;
  version: number;
}

export interface MigrationPlan {
  applied: MigrationPlanEntry[];
  conflicts: MigrationConflict[];
  pending: MigrationPlanEntry[];
}

/** Result of applying a single migration successfully. */
export interface AppliedMigrationResult extends AppliedMigration {
  filename: string;
}

export type MigrationTransactionScope = "migration" | "plan";

export interface MigrationBackend {
  acquireLock(): Promise<void>;
  applyMigration(migration: MigrationFile): Promise<AppliedMigrationResult>;
  applyMigrations?(
    migrations: readonly MigrationFile[],
  ): Promise<AppliedMigrationResult[]>;
  close(): Promise<void>;
  ensureLedger(): Promise<void>;
  insertReconciliation?(row: {
    action: string;
    classification: string;
    confidence: string;
    evidence: unknown;
    newChecksum?: string;
    oldChecksum?: string;
    physicalFingerprint?: string;
    repositoryCommit?: string;
    version: number;
  }): Promise<void>;
  inspectCatalog(): Promise<import("./analysis/catalog.ts").PhysicalCatalog>;
  readonly kind: string;
  listAppliedMigrations(): Promise<AppliedMigration[]>;
  listArchivedSources?(): Promise<
    import("./reconciliation/types.ts").ArchivedMigrationSource[]
  >;
  releaseLock(): Promise<void>;
}

export type MigrationCommandMode =
  | "apply"
  | "status"
  | "plan"
  | "dry-run"
  | "repair"
  | "check"
  | "graph"
  | "explain"
  | "drift"
  | "reconcile"
  | "verify";

export interface RunMigrationsOptions {
  /** Transaction boundary for application migrations. Defaults to migration. */
  transactionScope?: MigrationTransactionScope;
  /**
   * Explicit SQLite Local executor. When set, `runMigrations` dispatches to
   * `SqliteLocalMigrationBackend` and never translates PostgreSQL SQL.
   */
  sqliteExecutor?: import("../sqlite-local/contracts.ts").AthenaSqliteExecutor;
  /**
   * Optional authored migration files. Required when `sqliteExecutor` is set
   * unless `migrationsDirectory` is provided for discovery.
   */
  sqliteMigrations?: MigrationFile[];
  /** @deprecated Use allowDirtyMigrations */
  allowDirty?: boolean;
  /**
   * Apply/repair despite uncommitted migration files or migrate config.
   */
  allowDirtyMigrations?: boolean;
  /** Apply HIGH-confidence reconcile repairs (never migration SQL). */
  applyReconcile?: boolean;
  /**
   * Static project configuration supplied by an embedding runtime. This
   * allows local database commands to reuse providerless config after they
   * resolve an explicit database URL.
   */
  config?: import("../generator/types.ts").AthenaConfig;
  /**
   * When set, overrides config-resolved migrations directory
   * (relative to cwd or absolute).
   */
  configPath?: string;
  /**
   * Injectable Auth database factory for tests / custom adapters.
   */
  createAuthDatabase?: (
    connectionString: string
  ) => Promise<import("../auth/local/database.ts").AthenaAuthDatabase>;
  /**
   * Injectable backend factory for tests. When omitted, created from config.
   */
  createBackend?: (
    context: MigrationBackendContext
  ) => Promise<MigrationBackend>;
  cwd?: string;
  /**
   * Explicit direct PostgreSQL authority supplied by an embedding tool.
   * When set, it takes precedence over the provider connection in the
   * project configuration.
   */
  databaseUrl?: string;
  /**
   * Injectable discovery for tests.
   */
  discover?: (directory: string) => Promise<MigrationFile[]>;
  /** Defaults to false. When true, never mutates the database. */
  dryRun?: boolean;
  /** Target for `migrate explain <file-or-version>`. */
  explainTarget?: string;
  /**
   * Injectable source-control inspector for tests.
   */
  inspectSourceControl?: (
    input: import("./source-control/types.ts").InspectSourceControlInput
  ) => import("./source-control/types.ts").MigrationSourceControlState;
  json?: boolean;
  log?: (message: string) => void;
  /**
   * Injectable Auth schema migrate for tests. Production apply uses
   * `migrateAthenaAuthSchema` against the same PostgreSQL URL.
   */
  migrateAuthSchema?: () => Promise<void>;
  mode?: MigrationCommandMode;
  plain?: boolean;
  /** Injectable Auth planner for tests. */
  planAuthSchema?: () => Promise<
    import("../auth/local/schema.ts").AthenaAuthMigrationPlan
  >;
  postgresRuntime?: import("../postgres/owned-runtime.ts").AthenaPostgresRuntime;
  /** Injectable Auth repair for tests. */
  repairAuthSchema?: (options: { dryRun: boolean }) => Promise<void>;
  /** Fail on dynamic SQL / unverifiable constructs. */
  strict?: boolean;
  /** Optional presentation adapter; defaults from flags/TTY. */
  ui?: import("../cli/ui/types.ts").AthenaCliUI;
  /** Confirm non-interactive repair. */
  yes?: boolean;
}

export interface MigrationBackendContext {
  connectionString: string;
  database?: string;
  postgresRuntime?: import("../postgres/owned-runtime.ts").AthenaPostgresRuntime;
}

export interface MigrationRunSummary {
  appliedCount: number;
  authPlan?: import("../auth/local/schema.ts").AthenaAuthMigrationPlan;
  conflicts: MigrationConflict[];
  databaseLabel: string;
  diagnostics?: import("../cli/ui/types.ts").Diagnostic[];
  directory: string;
  dryRun: boolean;
  embedded?: readonly import("./embedded-modules-inspect.ts").EmbeddedModuleSection[];
  failedCount: number;
  gitWorktree?: import("./git-worktree.ts").DirtyMigrationWorktree;
  mode: MigrationCommandMode;
  newlyApplied: AppliedMigrationResult[];
  pendingCount: number;
  plan: MigrationPlan;
  providerLabel: string;
  reconciliation?: import("./reconciliation/types.ts").ReconciliationReport;
  semantic?: import("./analysis/compiler.ts").CompileMigrationsResult;
  skippedCount: number;
  sourceControl?: import("./source-control/types.ts").MigrationSourceControlState;
}

export class MigrationError extends Error {
  readonly code:
    | "CONFIG"
    | "DISCOVERY"
    | "INTEGRITY"
    | "HISTORY"
    | "PROVIDER"
    | "EXECUTION"
    | "LOCK"
    | "LEDGER"
    | "SEMANTIC";

  constructor(
    code: MigrationError["code"],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "MigrationError";
    this.code = code;
  }
}
