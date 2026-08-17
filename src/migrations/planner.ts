import type {
  AppliedMigration,
  MigrationConflict,
  MigrationFile,
  MigrationPlan,
  MigrationPlanEntry,
} from "./types.ts";

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
      const checksums = new Set(appliedRows.map((row) => row.checksum));
      if (checksums.size > 1 || (local && !checksums.has(local.checksum))) {
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
      appliedEntries.push({ migration: local, status: "applied" });
      continue;
    }

    if (local) {
      pendingEntries.push({ migration: local, status: "pending" });
    }
  }

  return {
    applied: appliedEntries,
    conflicts,
    pending: pendingEntries,
  };
}

export function planHasBlockingConflicts(plan: MigrationPlan): boolean {
  return plan.conflicts.length > 0;
}
