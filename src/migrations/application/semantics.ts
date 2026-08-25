import {
	type CompileMigrationsResult,
	compileMigrations,
} from "../analysis/index.ts";
import type { MigrationBackend } from "../backend.ts";

export async function compileApplicationSemantics(input: {
	backend: MigrationBackend;
	cacheDir?: string;
	local: readonly import("../types.ts").MigrationFile[];
	plan: import("../types.ts").MigrationPlan;
	strict?: boolean;
}): Promise<CompileMigrationsResult> {
	const catalog = await input.backend.inspectCatalog();
	return compileMigrations({
		appliedVersions: new Set(
			input.plan.applied.map((entry) => entry.migration.version),
		),
		cacheDir: input.cacheDir,
		catalog,
		files: input.local,
		strict: input.strict,
	});
}

export function blockingSemantic(result: CompileMigrationsResult): boolean {
	return result.diagnostics.some(
		(item) => item.classification !== "dynamic_sql",
	);
}
