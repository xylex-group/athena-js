import type { MigrationExecutionTransform } from "../types.ts";

export type ReconciliationClassification =
  | "CONSISTENT"
  | "SOURCE_DRIFT"
  | "LEDGER_DRIFT"
  | "PHYSICAL_DRIFT"
  | "SOURCE_LEDGER_DIVERGENCE"
  | "LEDGER_SOURCE_DIVERGENCE"
  | "LEDGER_PHYSICAL_DIVERGENCE"
  | "SOURCE_PHYSICAL_DIVERGENCE"
  | "THREE_WAY_DIVERGENCE"
  | "HISTORICAL_INSERTION"
  | "MISSING_SOURCE"
  | "MISSING_LEDGER"
  | "MISSING_PHYSICAL_EFFECT"
  | "AMBIGUOUS_HISTORY";

export type ReconciliationConfidence = "HIGH" | "MEDIUM" | "AMBIGUOUS";

export type PhysicalMatchEvidence = boolean | "unknown";

export type MigrationReconciliationAction =
  | {
      fromChecksum: string;
      kind: "record-ledger-drift";
      toChecksum: string;
      version: number;
    }
  | {
      kind: "restore-local-source";
      source: "database-archive" | "git-history";
      version: number;
    }
  | {
      kind: "create-forward-repair";
      reason: string;
      version: number;
    }
  | { kind: "no-op" }
  | { kind: "manual-review"; reason: string };

export interface ArchivedMigrationSource {
  checksum: string;
  executionChecksum?: string;
  executionId?: string;
  executionSql?: string;
  executionTransformId?: string;
  executionTransformVersion?: string;
  sourceBlobSha?: string;
  sourceCommit?: string;
  sourcePath?: string;
  sql: string;
  version: number;
}

export interface RepositoryMigrationTruth {
  checksum: string;
  committed: boolean;
  executionSql?: string;
  executionTransform?: MigrationExecutionTransform;
  filename: string;
  gitBlobSha?: string;
  name: string;
  path: string;
  sql: string;
  version: number;
}

export interface LedgerMigrationTruth {
  checksum: string;
  executionChecksum?: string;
  executionTransformId?: string;
  executionTransformVersion?: string;
  name: string;
  postSchemaFingerprint?: string;
  sourceBlobSha?: string;
  sourceCommit?: string;
  sourceDirty?: boolean;
  version: number;
}

export interface ReconciliationEvidence {
  archiveChecksum?: string;
  archiveExecutionMatchesLedger: boolean;
  competingArchive: boolean;
  executionMatchesLedger: boolean;
  laterDependenciesSatisfied: boolean;
  physicalMatchesArchive: PhysicalMatchEvidence;
  physicalMatchesRepository: PhysicalMatchEvidence;
  repositoryCommitted: boolean;
}

export interface VersionReconciliation {
  action: MigrationReconciliationAction;
  archive?: ArchivedMigrationSource;
  autoEligible: boolean;
  classification: ReconciliationClassification;
  confidence: ReconciliationConfidence;
  evidence: ReconciliationEvidence;
  ledger?: LedgerMigrationTruth;
  repository?: RepositoryMigrationTruth;
  version: number;
}

export interface ReconciliationReport {
  autoEligibleCount: number;
  diagnoses: VersionReconciliation[];
  summary: string;
}
