/**
 * Domain types for Athena JS application SQL migrations.
 * Tooling-only — never imported by browser/runtime client paths.
 */

/** Local migration file discovered under the migrations directory. */
export interface MigrationFile {
  checksum: string;
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
  executionId?: string;
  executionMs: number;
  name: string;
  sourceBlobSha?: string;
  sourceBranch?: string;
  sourceCommit?: string;
  sourceDirty?: boolean;
  sourcePath?: string;
  sourceRepository?: string;
  version: number;
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

export interface MigrationBackend {
  readonly kind: string;
  acquireLock(): Promise<void>;
  applyMigration(migration: MigrationFile): Promise<AppliedMigrationResult>;
  close(): Promise<void>;
  ensureLedger(): Promise<void>;
  inspectCatalog(): Promise<
    import("./analysis/catalog.ts").PhysicalCatalog
  >;
  listAppliedMigrations(): Promise<AppliedMigration[]>;
  listArchivedSources?(): Promise<
    import("./reconciliation/types.ts").ArchivedMigrationSource[]
  >;
  repairLedgerChecksum?(version: number, checksum: string): Promise<void>;
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
  /**
   * When set, overrides config-resolved migrations directory
   * (relative to cwd or absolute).
   */
  configPath?: string;
  cwd?: string;
  /** Defaults to false. When true, never mutates the database. */
  dryRun?: boolean;
  /**
   * Injectable backend factory for tests. When omitted, created from config.
   */
  createBackend?: (context: MigrationBackendContext) => Promise<MigrationBackend>;
  /**
   * Injectable Auth database factory for tests / custom adapters.
   */
  createAuthDatabase?: (
    connectionString: string
  ) => Promise<import("../auth/local/database.ts").AthenaAuthDatabase>;
  /**
   * Injectable discovery for tests.
   */
  discover?: (directory: string) => Promise<MigrationFile[]>;
  log?: (message: string) => void;
  /**
   * Injectable Auth schema migrate for tests. Production apply uses
   * `migrateAthenaAuthSchema` against the same PostgreSQL URL.
   */
  migrateAuthSchema?: () => Promise<void>;
  /** Injectable Auth planner for tests. */
  planAuthSchema?: () => Promise<
    import("../auth/local/schema.ts").AthenaAuthMigrationPlan
  >;
  /** Injectable Auth repair for tests. */
  repairAuthSchema?: (options: { dryRun: boolean }) => Promise<void>;
  mode?: MigrationCommandMode;
  /** Confirm non-interactive repair. */
  yes?: boolean;
  json?: boolean;
  plain?: boolean;
  /** Fail on dynamic SQL / unverifiable constructs. */
  strict?: boolean;
  /** Target for `migrate explain <file-or-version>`. */
  explainTarget?: string;
  /** Apply HIGH-confidence reconcile repairs (never migration SQL). */
  applyReconcile?: boolean;
  /**
   * Apply/repair despite uncommitted migration files or migrate config.
   */
  allowDirtyMigrations?: boolean;
  /** @deprecated Use allowDirtyMigrations */
  allowDirty?: boolean;
  /**
   * Injectable source-control inspector for tests.
   */
  inspectSourceControl?: (
    input: import("./source-control/types.ts").InspectSourceControlInput
  ) => import("./source-control/types.ts").MigrationSourceControlState;
  /** Optional presentation adapter; defaults from flags/TTY. */
  ui?: import("../cli/ui/types.ts").AthenaCliUI;
}

export interface MigrationBackendContext {
  connectionString: string;
  database?: string;
}

export interface MigrationRunSummary {
  appliedCount: number;
  authPlan?: import("../auth/local/schema.ts").AthenaAuthMigrationPlan;
  conflicts: MigrationConflict[];
  diagnostics?: import("../cli/ui/types.ts").Diagnostic[];
  directory: string;
  dryRun: boolean;
  failedCount: number;
  mode: MigrationCommandMode;
  pendingCount: number;
  plan: MigrationPlan;
  providerLabel: string;
  databaseLabel: string;
  skippedCount: number;
  newlyApplied: AppliedMigrationResult[];
  semantic?: import("./analysis/compiler.ts").CompileMigrationsResult;
  gitWorktree?: import("./git-worktree.ts").DirtyMigrationWorktree;
  sourceControl?: import("./source-control/types.ts").MigrationSourceControlState;
  reconciliation?: import("./reconciliation/types.ts").ReconciliationReport;
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
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "MigrationError";
    this.code = code;
  }
}
