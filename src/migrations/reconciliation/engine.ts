import { schemaHas, type ProjectedSchema } from "../analysis/projected-schema.ts";
import type { MigrationAnalysis } from "../analysis/semantic-ir.ts";
import type {
  ArchivedMigrationSource,
  LedgerMigrationTruth,
  ReconciliationConfidence,
  ReconciliationReport,
  RepositoryMigrationTruth,
  VersionReconciliation,
} from "./types.ts";

export interface ReconcileVersionInput {
  archive?: ArchivedMigrationSource;
  archiveAnalysis?: MigrationAnalysis;
  laterDependenciesSatisfied: boolean;
  ledger?: LedgerMigrationTruth;
  physical: ProjectedSchema;
  repository?: RepositoryMigrationTruth;
  repositoryAnalysis?: MigrationAnalysis;
}

function physicalMatchesAnalysis(
  physical: ProjectedSchema,
  analysis: MigrationAnalysis | undefined
): boolean {
  if (!analysis) {
    return false;
  }
  const objects = analysis.effects.creates.filter(
    (object) =>
      object.kind === "schema" ||
      object.kind === "table" ||
      object.kind === "column" ||
      object.kind === "function" ||
      object.kind === "index"
  );
  if (objects.length === 0) {
    return false;
  }
  return objects.every((object) => schemaHas(physical, object));
}

function isIdempotent(sql: string): boolean {
  return /IF\s+NOT\s+EXISTS|CREATE\s+OR\s+REPLACE/i.test(sql);
}

function effectsIdentifiable(analysis: MigrationAnalysis | undefined): boolean {
  return Boolean(analysis && analysis.effects.creates.length > 0);
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
    input.repositoryAnalysis
  );
  const physicalMatchesArchive = physicalMatchesAnalysis(
    input.physical,
    input.archiveAnalysis
  );
  const evidence = {
    archiveChecksum: input.archive?.checksum,
    competingArchive: Boolean(
      input.archive &&
        input.repository &&
        input.archive.checksum !== input.repository.checksum
    ),
    laterDependenciesSatisfied: input.laterDependenciesSatisfied,
    physicalMatchesArchive,
    physicalMatchesRepository,
    repositoryCommitted: Boolean(input.repository?.committed),
  };

  if (!input.repository && !input.ledger && !input.archive) {
    return {
      action: { kind: "manual-review", reason: "No evidence for this version." },
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
      confidence: physicalMatchesRepository ? "MEDIUM" : "AMBIGUOUS",
      evidence,
      repository: input.repository,
      version,
    };
  }

  if (input.ledger && !input.repository) {
    if (input.archive && input.archive.checksum === input.ledger.checksum) {
      return {
        action: {
          kind: "restore-local-source",
          source: "database-archive",
          version,
        },
        archive: input.archive,
        autoEligible: physicalMatchesArchive,
        classification: "MISSING_SOURCE",
        confidence: physicalMatchesArchive ? "HIGH" : "MEDIUM",
        evidence,
        ledger: input.ledger,
        version,
      };
    }
    return {
      action: {
        kind: "manual-review",
        reason: "Ledger row has no matching repository file.",
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

  if (repo.checksum === ledger.checksum) {
    if (physicalMatchesRepository) {
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
    return {
      action: {
        kind: "create-forward-repair",
        reason: "History agrees; physical objects expected by this migration are missing.",
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

  if (
    input.archive &&
    input.archive.checksum === ledger.checksum &&
    physicalMatchesArchive &&
    physicalMatchesRepository
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
    physicalMatchesArchive &&
    !physicalMatchesRepository
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
    physicalMatchesRepository &&
    !physicalMatchesArchive &&
    repo.name === ledger.name &&
    repo.committed &&
    input.laterDependenciesSatisfied &&
    (isIdempotent(repo.sql) || effectsIdentifiable(input.repositoryAnalysis)) &&
    !(input.archive && input.archive.checksum === ledger.checksum)
  ) {
    return {
      action: {
        fromChecksum: ledger.checksum,
        kind: "repair-ledger",
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
        reason: "Repository and ledger/archive disagree; physical state is mixed.",
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
  const diverged = diagnoses.filter((item) => item.classification !== "CONSISTENT");
  return {
    autoEligibleCount,
    diagnoses,
    summary:
      diverged.length === 0
        ? "Repository, ledger, and physical schema agree."
        : `${diverged.length} version(s) diverge. ${autoEligibleCount} HIGH-confidence metadata repair(s) eligible.`,
  };
}

export function isHighAutoRepair(
  diagnosis: VersionReconciliation
): boolean {
  return diagnosis.autoEligible && diagnosis.confidence === "HIGH";
}

export type { ReconciliationConfidence };
