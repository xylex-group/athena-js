import type {
  AppliedMigration,
  MigrationConflict,
  MigrationFile,
  MigrationPlan,
  MigrationPlanEntry,
} from "./types.ts";
import {
  IDENTITY_MIGRATION_EXECUTION_TRANSFORM,
  resolveMigrationExecution,
} from "./checksum.ts";

export interface PlanMigrationsInput {
  applied: readonly AppliedMigration[];
  local: readonly MigrationFile[];
}

/**
 * Pure planner: compares local migration files with ledger rows.
 *
 * - applied: local files present in ledger with matching checksum
 * - pending: local files not yet in ledger
 * - conflicts: checksum-mismatch or missing-local (DB ahead / deleted file)
 *
 * Duplicate applied rows for the same version are treated as integrity conflicts
 * when checksums disagree with local or with each other.
 */
export function planMigrations(input: PlanMigrationsInput): MigrationPlan {
  const localByVersion = new Map<number, MigrationFile>();
  for (const file of input.local) {
    localByVersion.set(file.version, file);
  }

  const appliedByVersion = new Map<number, AppliedMigration[]>();
  for (const row of input.applied) {
    const list = appliedByVersion.get(row.version) ?? [];
    list.push(row);
    appliedByVersion.set(row.version, list);
  }

  const conflicts: MigrationConflict[] = [];
  const appliedEntries: MigrationPlanEntry[] = [];
  const pendingEntries: MigrationPlanEntry[] = [];

  const versions = new Set<number>([
    ...localByVersion.keys(),
    ...appliedByVersion.keys(),
  ]);
  const orderedVersions = [...versions].sort((a, b) => a - b);

  for (const version of orderedVersions) {
    const local = localByVersion.get(version);
    const appliedRows = appliedByVersion.get(version) ?? [];

    if (appliedRows.length > 1) {
      const identities = new Set(
        appliedRows.map((row) => migrationExecutionIdentity(row))
      );
      if (
        new Set(appliedRows.map((row) => row.checksum)).size > 1 ||
        identities.size > 1 ||
        (local &&
          (!appliedRows.some((row) => row.checksum === local.checksum) ||
            !appliedRows.some((row) => matchesExecution(row, local))))
      ) {
        conflicts.push({
          applied: appliedRows[0],
          kind: "checksum-mismatch",
          local,
          version,
        });
        continue;
      }
    }

    const applied = appliedRows[0];

    if (applied && !local) {
      conflicts.push({
        applied,
        kind: "missing-local",
        version,
      });
      continue;
    }

    if (applied && local) {
      if (applied.checksum !== local.checksum) {
        conflicts.push({
          applied,
          kind: "checksum-mismatch",
          local,
          version,
        });
        continue;
      }
      if (!matchesExecution(applied, local)) {
        conflicts.push({
          applied,
          kind: "checksum-mismatch",
          local,
          version,
        });
        continue;
      }
      if (applied.name !== local.name) {
        conflicts.push({
          applied,
          kind: "name-mismatch",
          local,
          version,
        });
        continue;
      }
      appliedEntries.push({ migration: local, status: "applied" });
      continue;
    }

    if (local) {
      pendingEntries.push({ migration: local, status: "pending" });
    }
  }

  const maxAppliedVersion = Math.max(
    0,
    ...input.applied.map((row) => row.version),
    ...appliedEntries.map((entry) => entry.migration.version)
  );
  const historical = pendingEntries.filter(
    (entry) => entry.migration.version < maxAppliedVersion
  );
  if (historical.length > 0 && maxAppliedVersion > 0) {
    for (const entry of historical) {
      conflicts.push({
        kind: "historical-insertion",
        local: entry.migration,
        version: entry.migration.version,
      });
    }
  }

  const pending = pendingEntries.filter(
    (entry) =>
      !conflicts.some(
        (conflict) =>
          conflict.kind === "historical-insertion" &&
          conflict.version === entry.migration.version
      )
  );

  return {
    applied: appliedEntries,
    conflicts,
    pending,
  };
}

export function planHasBlockingConflicts(plan: MigrationPlan): boolean {
  return plan.conflicts.length > 0;
}

function migrationExecutionIdentity(row: AppliedMigration): string {
  return [
    row.executionChecksum ?? row.checksum,
    row.executionTransformId ?? IDENTITY_MIGRATION_EXECUTION_TRANSFORM.id,
    row.executionTransformVersion ??
      IDENTITY_MIGRATION_EXECUTION_TRANSFORM.version,
  ].join(":");
}

function matchesExecution(
  applied: AppliedMigration,
  local: MigrationFile
): boolean {
  const execution = resolveMigrationExecution(local);
  if (applied.executionChecksum === undefined) {
    return (
      local.executionSql === undefined &&
      execution.transform.id === IDENTITY_MIGRATION_EXECUTION_TRANSFORM.id &&
      execution.transform.version === IDENTITY_MIGRATION_EXECUTION_TRANSFORM.version
    );
  }
  return (
    applied.executionChecksum === execution.checksum &&
    applied.executionTransformId === execution.transform.id &&
    applied.executionTransformVersion === execution.transform.version
  );
}
