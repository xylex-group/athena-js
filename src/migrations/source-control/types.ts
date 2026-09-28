export type MigrationWorktreeChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface MigrationWorktreeChange {
  affectsMigrations: boolean;
  kind: MigrationWorktreeChangeKind;
  origPath?: string;
  path: string;
}

export interface MigrationSourceControlState {
  available: boolean;
  branch?: string;
  changedFiles: MigrationWorktreeChange[];
  detached: boolean;
  headCommit?: string;
  migrationDirectory: string;
  repositoryRoot?: string;
}

export type MigrationSourceSafety =
  | "verified-clean"
  | "dirty"
  | "untracked"
  | "conflicted"
  | "vcs-unavailable"
  | "not-a-repository"
  | "commit-unresolved";

export interface MigrationFileProvenance {
  branch?: string;
  dirty: boolean;
  gitBlobSha?: string;
  headCommit: string;
  relativePath: string;
  repositoryRoot: string;
  tracked: boolean;
  vcs: "git";
}

export interface MigrationSourceProvenance {
  executionId: string;
  safety: MigrationSourceSafety;
  sourceDirty: boolean;
  worktree: MigrationSourceControlState;
}

export interface PreparedMigration {
  checksum: string;
  executionSql?: string;
  executionTransform?: import("../types.ts").MigrationExecutionTransform;
  filename: string;
  name: string;
  provenance?: MigrationFileProvenance;
  source: MigrationSourceProvenance;
  sourcePath: string;
  sql: string;
  version: number;
}

export interface InspectSourceControlInput {
  configPath?: string;
  cwd: string;
  migrationsDirectory: string;
}
