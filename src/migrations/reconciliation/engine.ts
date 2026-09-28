import {
  type ProjectedSchema,
  isPhysicalCatalogObservable,
  schemaHas,
} from "../analysis/projected-schema.ts";
import type { MigrationAnalysis } from "../analysis/semantic-ir.ts";
import {
  IDENTITY_MIGRATION_EXECUTION_TRANSFORM,
  checksumMigrationSql,
  resolveMigrationExecution,
} from "../checksum.ts";
import type {
  ArchivedMigrationSource,
  LedgerMigrationTruth,
  ReconciliationConfidence,
  ReconciliationReport,
  RepositoryMigrationTruth,
  PhysicalMatchEvidence,
  VersionReconciliation,
} from "./types.ts";

function canRestoreArchivedSource(archive: ArchivedMigrationSource): boolean {
  const hasExecutionMetadata =
    archive.executionChecksum !== undefined ||
    archive.executionSql !== undefined ||
    archive.executionTransformId !== undefined ||
    archive.executionTransformVersion !== undefined;
  if (!hasExecutionMetadata) {
    return true;
  }

  return (
    archive.executionTransformId === IDENTITY_MIGRATION_EXECUTION_TRANSFORM.id &&
    archive.executionTransformVersion ===
      IDENTITY_MIGRATION_EXECUTION_TRANSFORM.version &&
    (archive.executionChecksum === undefined ||
      archive.executionChecksum === archive.checksum) &&
    (archive.executionSql === undefined ||
      checksumMigrationSql(archive.executionSql) === archive.checksum)
  );
}

export interface ReconcileVersionInput {
  archive?: ArchivedMigrationSource;
  archiveAnalysis?: MigrationAnalysis;
  archiveExecutionAnalysis?: MigrationAnalysis;
  archiveSelectionAmbiguous?: boolean;
  laterDependenciesSatisfied: boolean;
  ledger?: LedgerMigrationTruth;
  physical: ProjectedSchema;
  repository?: RepositoryMigrationTruth;
  repositoryAnalysis?: MigrationAnalysis;
  repositoryExecutionAnalysis?: MigrationAnalysis;
}

function physicalMatchesAnalysis(
  physical: ProjectedSchema,
  analysis: MigrationAnalysis | undefined
): PhysicalMatchEvidence {
  if (!analysis) {
    return "unknown";
  }
  if (
    analysis.warnings.length > 0 ||
    analysis.effects.modifies.length > 0 ||
    analysis.effects.drops.length > 0 ||
    analysis.effects.creates.length === 0
  ) {
    return "unknown";
  }
  return analysis.effects.creates.every(
    (object) =>
      isPhysicalCatalogObservable(object) && schemaHas(physical, object)
  );
}

function isIdempotent(sql: string): boolean {
  return /IF\s+NOT\s+EXISTS|CREATE\s+OR\s+REPLACE/i.test(sql);
}

function effectsIdentifiable(analysis: MigrationAnalysis | undefined): boolean {
  return Boolean(analysis && analysis.effects.creates.length > 0);
}

function matchesLedgerExecution(
  ledger: LedgerMigrationTruth,
  repository: RepositoryMigrationTruth
): boolean {
  const execution = resolveMigrationExecution(repository);
  if (ledger.executionChecksum === undefined) {
    return (
      repository.executionSql === undefined &&
      execution.transform.id === IDENTITY_MIGRATION_EXECUTION_TRANSFORM.id &&
      execution.transform.version === IDENTITY_MIGRATION_EXECUTION_TRANSFORM.version
    );
  }
  return (
    ledger.executionChecksum === execution.checksum &&
    ledger.executionTransformId === execution.transform.id &&
    ledger.executionTransformVersion === execution.transform.version
  );
}

function matchesArchivedExecution(
  ledger: LedgerMigrationTruth,
  archive: ArchivedMigrationSource
): boolean {
  if (ledger.executionChecksum === undefined) {
    return (
      archive.executionChecksum === undefined &&
      archive.executionSql === undefined &&
      archive.executionTransformId === undefined &&
      archive.executionTransformVersion === undefined
    );
  }
  return (
    archive.executionChecksum === ledger.executionChecksum &&
    archive.executionTransformId === ledger.executionTransformId &&
    archive.executionTransformVersion === ledger.executionTransformVersion
  );
}

export function reconcileVersion(
  input: ReconcileVersionInput
): VersionReconciliation {
  const version =
    input.repository?.version ??
    input.ledger?.version ??
    input.archive?.version ??
    0;
  const physicalMatchesRepository = physicalMatchesAnalysis(
    input.physical,
    input.repositoryExecutionAnalysis ?? input.repositoryAnalysis
  );
  const physicalMatchesArchive = physicalMatchesAnalysis(
    input.physical,
    input.archiveExecutionAnalysis ?? input.archiveAnalysis
  );
  const executionMatchesLedger =
    input.ledger && input.repository
      ? matchesLedgerExecution(input.ledger, input.repository)
      : true;
  const archiveExecutionMatchesLedger =
    input.archive && input.ledger
      ? matchesArchivedExecution(input.ledger, input.archive)
      : true;
  const evidence = {
    archiveChecksum: input.archive?.checksum,
    archiveExecutionMatchesLedger,
    competingArchive: Boolean(
      input.archiveSelectionAmbiguous ||
        (input.archive &&
          input.repository &&
          input.archive.checksum !== input.repository.checksum)
    ),
    executionMatchesLedger,
    laterDependenciesSatisfied: input.laterDependenciesSatisfied,
    physicalMatchesArchive,
    physicalMatchesRepository,
    repositoryCommitted: Boolean(input.repository?.committed),
  };

  if (!(input.repository || input.ledger || input.archive)) {
    return {
      action: {
        kind: "manual-review",
        reason: "No evidence for this version.",
      },
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence,
      version,
    };
  }

  if (input.repository && !input.ledger) {
    return {
      action: {
        kind: "manual-review",
        reason: "Repository has a migration with no ledger row.",
      },
      autoEligible: false,
      classification: "MISSING_LEDGER",
      confidence:
        physicalMatchesRepository === true ? "MEDIUM" : "AMBIGUOUS",
      evidence,
      repository: input.repository,
      version,
    };
  }

  if (input.ledger && !input.repository) {
    if (
      input.archive &&
      input.archive.checksum === input.ledger.checksum &&
      archiveExecutionMatchesLedger &&
      canRestoreArchivedSource(input.archive) &&
      !input.archiveSelectionAmbiguous &&
      input.laterDependenciesSatisfied
    ) {
      return {
        action: {
          kind: "restore-local-source",
          source: "database-archive",
          version,
        },
        archive: input.archive,
        autoEligible: physicalMatchesArchive === true,
        classification: "MISSING_SOURCE",
        confidence:
          physicalMatchesArchive === true ? "HIGH" : "MEDIUM",
        evidence,
        ledger: input.ledger,
        version,
      };
    }
    return {
      action: {
        kind: "manual-review",
        reason:
          input.archive && !canRestoreArchivedSource(input.archive)
            ? "Archived execution metadata cannot be restored automatically."
            : "Ledger row has no matching repository file.",
      },
      autoEligible: false,
      classification: "MISSING_SOURCE",
      confidence: "AMBIGUOUS",
      evidence,
      ledger: input.ledger,
      version,
    };
  }

  const repo = input.repository;
  const ledger = input.ledger;
  if (!(repo && ledger)) {
    return {
      action: { kind: "manual-review", reason: "Incomplete evidence." },
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence,
      version,
    };
  }

  if (!executionMatchesLedger) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Authored SQL agrees, but execution provenance disagrees. Automatic repair is unsafe.",
      },
      archive: input.archive,
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (repo.checksum === ledger.checksum) {
    if (physicalMatchesRepository === true) {
      return {
        action: { kind: "no-op" },
        archive: input.archive,
        autoEligible: false,
        classification: "CONSISTENT",
        confidence: "HIGH",
        evidence,
        ledger,
        repository: repo,
        version,
      };
    }
    if (physicalMatchesRepository === "unknown") {
      return {
        action: {
          kind: "manual-review",
          reason:
            "Physical postconditions include effects that cannot be fully proven from the catalog. Automatic repair is unsafe.",
        },
        archive: input.archive,
        autoEligible: false,
        classification: "MISSING_PHYSICAL_EFFECT",
        confidence: "AMBIGUOUS",
        evidence,
        ledger,
        repository: repo,
        version,
      };
    }
    return {
      action: {
        kind: "create-forward-repair",
        reason:
          "History agrees; physical objects expected by this migration are missing.",
        version,
      },
      archive: input.archive,
      autoEligible: false,
      classification: "PHYSICAL_DRIFT",
      confidence: "HIGH",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (input.archiveSelectionAmbiguous) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Multiple archives exist for this version, but none matches the ledger checksum. Automatic repair is unsafe.",
      },
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (input.archive && !archiveExecutionMatchesLedger) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Authored SQL agrees, but execution provenance disagrees. Automatic repair is unsafe.",
      },
      archive: input.archive,
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (
    input.archive &&
    input.archive.checksum === ledger.checksum &&
    physicalMatchesArchive === true &&
    physicalMatchesRepository === true
  ) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Physical schema satisfies both archived SQL and current repository SQL. Cannot determine which migration was actually executed. Automatic repair is unsafe.",
      },
      archive: input.archive,
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence: { ...evidence, competingArchive: true },
      ledger,
      repository: repo,
      version,
    };
  }

  if (
    input.archive &&
    input.archive.checksum === ledger.checksum &&
    physicalMatchesArchive === true &&
    physicalMatchesRepository === false &&
    input.laterDependenciesSatisfied
  ) {
    return {
      action: {
        kind: "restore-local-source",
        source: "database-archive",
        version,
      },
      archive: input.archive,
      autoEligible: true,
      classification: "SOURCE_DRIFT",
      confidence: "HIGH",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (
    physicalMatchesRepository === "unknown" ||
    (input.archive && physicalMatchesArchive === "unknown")
  ) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Physical postconditions include effects that cannot be fully proven from the catalog. Automatic repair is unsafe.",
      },
      archive: input.archive,
      autoEligible: false,
      classification: "MISSING_PHYSICAL_EFFECT",
      confidence: "AMBIGUOUS",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (repo.name !== ledger.name) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Cannot determine which migration was actually executed. Automatic repair is unsafe.",
      },
      archive: input.archive,
      autoEligible: false,
      classification: "AMBIGUOUS_HISTORY",
      confidence: "AMBIGUOUS",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (
    physicalMatchesRepository === true &&
    repo.name === ledger.name &&
    repo.committed &&
    input.laterDependenciesSatisfied &&
    (isIdempotent(repo.sql) || effectsIdentifiable(input.repositoryAnalysis)) &&
    !(input.archive && input.archive.checksum === ledger.checksum) &&
    (!input.archive || physicalMatchesArchive === false)
  ) {
    return {
      action: {
        fromChecksum: ledger.checksum,
        kind: "record-ledger-drift",
        toChecksum: repo.checksum,
        version,
      },
      archive: input.archive,
      autoEligible: true,
      classification: "LEDGER_SOURCE_DIVERGENCE",
      confidence: "HIGH",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  if (physicalMatchesRepository !== physicalMatchesArchive) {
    return {
      action: {
        kind: "manual-review",
        reason:
          "Repository and ledger/archive disagree; physical state is mixed.",
      },
      archive: input.archive,
      autoEligible: false,
      classification: "THREE_WAY_DIVERGENCE",
      confidence: "AMBIGUOUS",
      evidence,
      ledger,
      repository: repo,
      version,
    };
  }

  return {
    action: {
      kind: "manual-review",
      reason:
        "Cannot determine which migration was actually executed. Automatic repair is unsafe.",
    },
    archive: input.archive,
    autoEligible: false,
    classification: "AMBIGUOUS_HISTORY",
    confidence: "AMBIGUOUS",
    evidence,
    ledger,
    repository: repo,
    version,
  };
}

export function buildReconciliationReport(
  diagnoses: VersionReconciliation[]
): ReconciliationReport {
  const autoEligibleCount = diagnoses.filter(
    (item) => item.autoEligible && item.confidence === "HIGH"
  ).length;
  const diverged = diagnoses.filter(
    (item) => item.classification !== "CONSISTENT"
  );
  return {
    autoEligibleCount,
    diagnoses,
    summary:
      diverged.length === 0
        ? "Repository, ledger, and physical schema agree."
        : `${diverged.length} version(s) diverge. ${autoEligibleCount} HIGH-confidence metadata repair(s) eligible.`,
  };
}

export function isHighAutoRepair(diagnosis: VersionReconciliation): boolean {
  return diagnosis.autoEligible && diagnosis.confidence === "HIGH";
}

export type { ReconciliationConfidence };
