import { type AthenaCliUI, createCliUi } from "../../cli/ui/index.ts";
import { loadGeneratorConfig } from "../../generator/config.ts";
import { resolveGeneratorDatabaseAuthority } from "../../generator/database-authority.ts";
import type { NormalizedAthenaGeneratorConfig } from "../../generator/types.ts";
import { discoverMigrations } from "../discovery.ts";
import {
	ensureAthenaProjectLayout,
	formatManagedAuthDrift,
	inspectManagedAuthMigrations,
	materializeManagedAuthMigrations,
	type ManagedAuthInspection,
} from "../managed-auth.ts";
import {
	applyWouldBeRefused,
	classifySourceSafety,
	formatOverridePrompt,
	formatSourceSafetyError,
	formatSourceSafetyWarning,
	freezePreparedMigrations,
	inspectSourceControl,
	preparedToMigrationFile,
} from "../source-control/index.ts";
import type { DirtyMigrationWorktree } from "../git-worktree.ts";
import type {
	MigrationSourceControlState,
	MigrationSourceSafety,
} from "../source-control/types.ts";
import {
	type MigrationCommandMode,
	MigrationError,
	type MigrationFile,
	type RunMigrationsOptions,
} from "../types.ts";
import {
	relativeDirectoryDisplay,
	resolveMigrationsDirectory,
} from "./authority.ts";

export interface PreparedApplicationMigrationRun {
	allowDirtyMigrations: boolean;
	config: NormalizedAthenaGeneratorConfig;
	cwd: string;
	directoryDisplay: string;
	dryRun: boolean;
	gitWorktree: DirtyMigrationWorktree;
	local: MigrationFile[];
	managedAuth: ManagedAuthInspection;
	mode: MigrationCommandMode;
	mutating: boolean;
	sourceControl: MigrationSourceControlState;
	sourceSafety: MigrationSourceSafety;
	ui: AthenaCliUI;
}

function resolveUi(options: RunMigrationsOptions): AthenaCliUI {
	if (options.ui) {
		return options.ui;
	}
	return createCliUi({
		json: options.json,
		plain: options.plain,
		write: options.log,
	});
}

export async function prepareApplicationMigrationRun(
	options: RunMigrationsOptions,
): Promise<PreparedApplicationMigrationRun> {
	const cwd = options.cwd ?? process.cwd();
	const ui = resolveUi(options);
	const mode: MigrationCommandMode =
		options.mode ?? (options.dryRun ? "dry-run" : "apply");
	const dryRun =
		mode === "dry-run" ||
		mode === "plan" ||
		mode === "verify" ||
		Boolean(options.dryRun);

	const loaded = await loadGeneratorConfig({
		configPath: options.configPath,
		cwd,
	});
	const authority = resolveGeneratorDatabaseAuthority({
		applyProjectEnv: false,
		cwd,
		loaded,
		mode: "direct",
	});
	const config = {
		...loaded.config,
		provider: authority.provider,
	};
	authority.restoreEnv();
	const absoluteDirectory = resolveMigrationsDirectory(config, cwd);
	const directoryDisplay = relativeDirectoryDisplay(cwd, absoluteDirectory);
	const layout = await ensureAthenaProjectLayout({
		applicationDirectory: absoluteDirectory,
		cwd,
		dryRun,
	});
	if (layout.createdApplicationMigrations && !dryRun) {
		ui.note(`Created application migrations directory ${directoryDisplay}`);
	}
	const mutating = mode === "apply" || mode === "repair";
	if (!dryRun) {
		const materialized = await materializeManagedAuthMigrations({
			cwd,
			overwrite: mutating,
		});
		if (
			mutating &&
			(materialized.written.length > 0 || materialized.restored.length > 0)
		) {
			ui.note(
				"Materialized Embedded Auth migrations in athena/managed/auth/migrations",
			);
		}
	}
	const managedAuth = await inspectManagedAuthMigrations({ cwd });
	if (managedAuth.drifted) {
		ui.warn(formatManagedAuthDrift(managedAuth));
	}

	const discover =
		options.discover ??
		((directory: string) => discoverMigrations({ cwd, directory }));

	const discovered = await discover(
		absoluteDirectory.startsWith(cwd)
			? relativeDirectoryDisplay(cwd, absoluteDirectory)
			: absoluteDirectory,
	);

	const resolvedConfigPath =
		options.configPath ??
		(loaded.configPath.startsWith("[") ? undefined : loaded.configPath);
	const sourceControl = (options.inspectSourceControl ?? inspectSourceControl)({
		configPath: resolvedConfigPath,
		cwd,
		migrationsDirectory: relativeDirectoryDisplay(cwd, absoluteDirectory),
	});
	const sourceSafety = classifySourceSafety(sourceControl);
	const allowDirtyMigrations = Boolean(
		options.allowDirtyMigrations ?? options.allowDirty,
	);
	if (mutating && applyWouldBeRefused(sourceSafety) && !allowDirtyMigrations) {
		throw new MigrationError(
			"INTEGRITY",
			formatSourceSafetyError(sourceControl, sourceSafety),
		);
	}
	if (mutating && applyWouldBeRefused(sourceSafety) && allowDirtyMigrations) {
		if (!options.yes) {
			if (!ui.capabilities.isTty || ui.capabilities.mode !== "interactive") {
				throw new MigrationError(
					"CONFIG",
					[
						formatSourceSafetyWarning(sourceControl, sourceSafety),
						"",
						"Non-interactive override requires:",
						"",
						"  athena-js migrate --allow-dirty-migrations --yes",
					].join("\n"),
				);
			}
			const confirmed = await ui.confirm(formatOverridePrompt(sourceControl));
			if (!confirmed) {
				throw new MigrationError("CONFIG", "Dirty migration apply cancelled.");
			}
		}
	}

	const prepared = freezePreparedMigrations(discovered, sourceControl);
	const local = prepared.map(preparedToMigrationFile);
	const gitWorktree = {
		dirty: applyWouldBeRefused(sourceSafety),
		entries: sourceControl.changedFiles
			.filter((item) => item.affectsMigrations)
			.map((item) => ({
				code:
					item.kind === "untracked"
						? "??"
						: item.kind === "deleted"
							? "D"
							: item.kind === "renamed"
								? "R"
								: item.kind === "added"
									? "A"
									: "M",
				origPath: item.origPath,
				path: item.path,
			})),
		inGitWorktree: sourceControl.available,
	};

	return {
		allowDirtyMigrations,
		config,
		cwd,
		directoryDisplay,
		dryRun,
		gitWorktree,
		local,
		managedAuth,
		mode,
		mutating,
		sourceControl,
		sourceSafety,
		ui,
	};
}
