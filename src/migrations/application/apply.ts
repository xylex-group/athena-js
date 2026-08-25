import type { AthenaCliUI } from "../../cli/ui/index.ts";
import type { MigrationBackend } from "../backend.ts";
import type {
	AppliedMigrationResult,
	MigrationPlanEntry,
} from "../types.ts";

export async function applyApplicationMigrations(
	backend: MigrationBackend,
	pending: readonly MigrationPlanEntry[],
	ui: AthenaCliUI,
): Promise<AppliedMigrationResult[]> {
	const newlyApplied: AppliedMigrationResult[] = [];
	for (const entry of pending) {
		ui.info(`→ ${entry.migration.filename} applying`);
		const result = await backend.applyMigration(entry.migration);
		newlyApplied.push(result);
		ui.success(`✓ ${entry.migration.filename} ${result.executionMs} ms`);
	}
	return newlyApplied;
}
