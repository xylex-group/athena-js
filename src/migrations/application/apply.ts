import type { AthenaCliUI } from "../../cli/ui/index.ts";
import type { MigrationBackend } from "../backend.ts";
import type {
  AppliedMigrationResult,
  MigrationPlanEntry,
  MigrationTransactionScope,
} from "../types.ts";

export async function applyApplicationMigrations(
  backend: MigrationBackend,
  pending: readonly MigrationPlanEntry[],
  ui: AthenaCliUI,
  transactionScope: MigrationTransactionScope = "migration",
): Promise<AppliedMigrationResult[]> {
  if (transactionScope === "plan") {
    if (!backend.applyMigrations) {
      throw new Error("Migration backend does not support plan transaction scope.");
    }
    const migrations = pending.map((entry) => entry.migration);
    const results = await backend.applyMigrations(migrations);
    results.forEach((result) => {
      ui.success(`✓ ${result.filename} ${result.executionMs} ms`);
    });
    return results;
  }
  const newlyApplied: AppliedMigrationResult[] = [];
  for (const entry of pending) {
    ui.info(`→ ${entry.migration.filename} applying`);
    const result = await backend.applyMigration(entry.migration);
    newlyApplied.push(result);
    ui.success(`✓ ${entry.migration.filename} ${result.executionMs} ms`);
  }
  return newlyApplied;
}
