import { AthenaAuthRuntimeError } from "../auth/local/errors.ts";
import type { AthenaAuthMigrationPlan } from "../auth/local/schema.ts";
import { formatDiagnostic } from "./analysis/diagnostics.ts";
import {
	explainMigration,
	formatMigrationGraph,
	formatPreflightFailure,
} from "./analysis/index.ts";
import { applyApplicationMigrations } from "./application/apply.ts";
import {
	assertDirectPostgres,
	databaseLabel,
	providerLabel,
} from "./application/authority.ts";
import { prepareApplicationMigrationRun } from "./application/prepare.ts";
import { reconcileApplicationMigrations } from "./application/reconcile.ts";
import {
	blockingSemantic,
	compileApplicationSemantics,
} from "./application/semantics.ts";
import type { MigrationBackend } from "./backend.ts";
import { applyEmbeddedAuthMigrations } from "./embedded-auth/apply.ts";
import { applyEmbeddedChatMigrations } from "./embedded-chat/apply.ts";
import { loadAuthPlan } from "./embedded-auth/plan.ts";
import { repairEmbeddedAuthMigrations } from "./embedded-auth/repair.ts";
import {
	formatManagedAuthDrift,
	type ManagedAuthInspection,
} from "./managed-auth.ts";
import { planHasBlockingConflicts, planMigrations } from "./planner.ts";
import { createPostgresMigrationBackend } from "./postgres.ts";
import { isHighAutoRepair } from "./reconciliation/index.ts";
import { formatConflictBlock } from "./reporting/conflicts.ts";
import {
	formatUnknownAuthLedgerError,
	hasUnknownAuthGenerations,
	renderReport,
	unknownAuthLedgerDiagnostics,
} from "./reporting/render.ts";
import {
	formatPlanProvenance,
	formatSourceSafetyWarning,
} from "./source-control/index.ts";
import {
	type AppliedMigrationResult,
	type MigrationCommandMode,
	MigrationError,
	type MigrationPlan,
	type MigrationRunSummary,
	type RunMigrationsOptions,
} from "./types.ts";

function translateRunError(error: unknown): MigrationError {
	if (error instanceof MigrationError) {
		return error;
	}
	if (error instanceof AthenaAuthRuntimeError) {
		return new MigrationError("EXECUTION", error.publicMessage, {
			cause: error,
		});
	}
	return new MigrationError(
		"EXECUTION",
		error instanceof Error ? error.message : String(error),
		{ cause: error },
	);
}

/**
 * Programmatic migration runner (Node/tooling only).
 *
 * Thin coordinator: application ledger and Embedded Auth ledger stay separate.
 */
export async function runMigrations(
	options: RunMigrationsOptions = {},
): Promise<MigrationRunSummary> {
	const prepared = await prepareApplicationMigrationRun(options);
	const {
		cwd,
		ui,
		mode,
		dryRun,
		config,
		directoryDisplay,
		local,
		sourceControl,
		sourceSafety,
		gitWorktree,
		managedAuth,
		mutating,
	} = prepared;
	const applyChatIfEnabled = async (connectionString: string): Promise<void> => {
		await applyEmbeddedChatMigrations(options, connectionString, ui, config.modules);
	};

	let backend: MigrationBackend | undefined;
	let connectionString = "";
	const newlyApplied: AppliedMigrationResult[] = [];
	let plan: MigrationPlan = { applied: [], conflicts: [], pending: [] };
	let authPlan: AthenaAuthMigrationPlan | undefined;

	try {
		const pg = assertDirectPostgres(config);
		connectionString = pg.connectionString;
		backend =
			(await options.createBackend?.({
				connectionString: pg.connectionString,
				database: pg.database,
			})) ??
			(await createPostgresMigrationBackend({
				connectionString: pg.connectionString,
				database: pg.database,
			}));

		await backend.acquireLock();
		if (mode === "apply" || mode === "repair") {
			await backend.ensureLedger();
		}
		const applied = await backend.listAppliedMigrations();
		plan = planMigrations({ applied, local });

		const gitDiagnostics =
			gitWorktree.dirty && !mutating
				? [
						{
							level: "warn" as const,
							code: "ATHENA-MIG-GIT-001",
							message: [
								formatPlanProvenance(sourceControl),
								"",
								formatSourceSafetyWarning(sourceControl, sourceSafety),
							].join("\n"),
						},
					]
				: [];
		if (gitDiagnostics[0]) {
			ui.warn(gitDiagnostics[0].message);
		}

		const summaryBase = {
			databaseLabel: databaseLabel(config),
			directory: directoryDisplay,
			dryRun,
			gitWorktree,
			mode,
			plan,
			providerLabel: providerLabel(config),
			sourceControl,
		};

		if (mode === "repair") {
			authPlan = await loadAuthPlan(options, connectionString, true);
			const repairEntries =
				authPlan?.entries.filter((entry) => entry.action === "repair") ?? [];
			renderReport(
				ui,
				summaryBase,
				authPlan,
				repairEntries.length === 0
					? "No Embedded Auth repairs required."
					: `${repairEntries.length} migration(s) require repair`,
				[],
			);

			if (repairEntries.length === 0) {
				return {
					...summaryBase,
					appliedCount: plan.applied.length,
					authPlan,
					conflicts: plan.conflicts,
					diagnostics: [],
					failedCount: 0,
					newlyApplied: [],
					pendingCount: plan.pending.length,
					skippedCount: 0,
				};
			}

			if (!options.yes && !dryRun) {
				if (!ui.capabilities.isTty || ui.capabilities.mode !== "interactive") {
					throw new MigrationError(
						"CONFIG",
						[
							"migrate repair requires confirmation.",
							"",
							"Re-run with --yes in CI/non-TTY environments:",
							"",
							"  athena-js migrate repair --yes",
						].join("\n"),
					);
				}
				const confirmed = await ui.confirm(
					"Repair drifted Embedded Auth schema now?",
				);
				if (!confirmed) {
					throw new MigrationError("CONFIG", "Repair cancelled.");
				}
			}

			await repairEmbeddedAuthMigrations(options, connectionString, dryRun);
			authPlan = await loadAuthPlan(options, connectionString, true);
			return {
				...summaryBase,
				appliedCount: plan.applied.length,
				authPlan,
				conflicts: plan.conflicts,
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: plan.pending.length,
				skippedCount: dryRun ? repairEntries.length : 0,
			};
		}

		const inspectAuth =
			mode === "status" ||
			mode === "plan" ||
			mode === "apply" ||
			mode === "check" ||
			mode === "drift" ||
			mode === "verify";
		authPlan = await loadAuthPlan(options, connectionString, inspectAuth);

		if (!backend) {
			throw new MigrationError(
				"PROVIDER",
				"Migration backend was not initialized.",
			);
		}

		const semantic = await compileApplicationSemantics({
			backend,
			cacheDir: cwd,
			local,
			plan,
			strict: options.strict,
		});

		if (mode === "reconcile") {
			const reconciliation = await reconcileApplicationMigrations({
				backend,
				cwd,
				directoryDisplay,
				local,
				options,
				semantic,
				ui,
			});
			const eligible = reconciliation.diagnoses.filter(isHighAutoRepair);
			return {
				...summaryBase,
				appliedCount: plan.applied.length,
				authPlan,
				conflicts: plan.conflicts,
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: plan.pending.length,
				reconciliation,
				semantic,
				skippedCount: options.applyReconcile ? 0 : eligible.length,
			};
		}

		if (mode === "graph") {
			ui.info(formatMigrationGraph(semantic.graph));
			return {
				...summaryBase,
				appliedCount: plan.applied.length,
				authPlan,
				conflicts: plan.conflicts,
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: plan.pending.length,
				semantic,
				skippedCount: 0,
			};
		}

		if (mode === "explain") {
			const target = (options.explainTarget ?? "").trim();
			const analysis = semantic.analyses.find(
				(item) =>
					item.filename === target ||
					item.version === Number(target) ||
					item.filename.startsWith(`${target}_`) ||
					item.filename.includes(target),
			);
			if (!analysis) {
				throw new MigrationError(
					"CONFIG",
					`Unknown migration to explain: ${target || "(missing)"}. Use a version or filename.`,
				);
			}
			ui.info(explainMigration(analysis));
			return {
				...summaryBase,
				appliedCount: plan.applied.length,
				authPlan,
				conflicts: plan.conflicts,
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: plan.pending.length,
				semantic,
				skippedCount: 0,
			};
		}

		if (
			mode === "status" ||
			mode === "plan" ||
			mode === "check" ||
			mode === "drift" ||
			mode === "verify"
		) {
			return inspectCombinedLedgers({
				authPlan,
				gitDiagnostics,
				managedAuth,
				mode,
				plan,
				semantic,
				strict: Boolean(options.strict),
				summaryBase,
				ui,
			});
		}

		if (planHasBlockingConflicts(plan)) {
			renderReport(
				ui,
				summaryBase,
				authPlan,
				"Application migration history has conflicts.",
				[{ level: "error", message: formatConflictBlock(plan) }],
			);
			throw new MigrationError("HISTORY", formatConflictBlock(plan));
		}

		if (blockingSemantic(semantic)) {
			const message = formatPreflightFailure(semantic.diagnostics);
			renderReport(ui, summaryBase, authPlan, "Migration preflight failed.", [
				{ level: "error", code: "ATHENA-MIG-DEP-001", message },
			]);
			throw new MigrationError("SEMANTIC", message);
		}

		if (mode === "dry-run") {
			const outcome =
				plan.pending.length === 0
					? "No pending application migrations. No database changes were made."
					: `${plan.pending.length} pending application migration(s). No database changes were made.`;
			renderReport(ui, summaryBase, authPlan, outcome);
			return {
				...summaryBase,
				appliedCount: plan.applied.length,
				authPlan,
				conflicts: plan.conflicts,
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: plan.pending.length,
				semantic,
				skippedCount: plan.pending.length,
			};
		}

		if (authPlan?.hasBlockingDrift) {
			const driftMessage = [
				"Embedded Auth schema drift detected",
				"",
				...authPlan.entries
					.filter((entry) => entry.schemaState === "drift")
					.flatMap((entry) => [
						entry.name,
						"",
						...(entry.drift ?? []).map(
							(item) =>
								`  Missing ${item.kind.replace("missing-", "")}: ${item.object}`,
						),
						"",
					]),
				"Migration history says these migrations were already applied.",
				"",
				"Athena will not silently modify a drifted schema.",
				"",
				"Run:",
				"",
				"  athena-js migrate repair",
			].join("\n");
			renderReport(ui, summaryBase, authPlan, "Embedded Auth schema drift.", [
				{
					level: "error",
					code: "ATHENA_AUTH_SCHEMA_DRIFT",
					message: driftMessage,
				},
			]);
			throw new MigrationError("HISTORY", driftMessage);
		}

		if (local.length === 0 && plan.pending.length === 0) {
			ui.info(`No application SQL files in ${directoryDisplay}.`);
			await applyEmbeddedAuthMigrations(options, connectionString, ui);
			await applyChatIfEnabled(connectionString);
			authPlan = await loadAuthPlan(options, connectionString, true);
			renderReport(
				ui,
				summaryBase,
				authPlan,
				`No application SQL files in ${directoryDisplay}. Embedded Auth is a separate ledger (listed above).`,
			);
			return {
				...summaryBase,
				appliedCount: 0,
				authPlan,
				conflicts: [],
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: 0,
				skippedCount: 0,
			};
		}

		for (const entry of plan.applied) {
			ui.info(`✓ ${entry.migration.filename} already applied`);
		}

		if (plan.pending.length === 0) {
			ui.info("Application migrations are up to date.");
			await applyEmbeddedAuthMigrations(options, connectionString, ui);
			await applyChatIfEnabled(connectionString);
			authPlan = await loadAuthPlan(options, connectionString, true);
			renderReport(
				ui,
				summaryBase,
				authPlan,
				`${plan.applied.length} application migrations current.`,
			);
			return {
				...summaryBase,
				appliedCount: plan.applied.length,
				authPlan,
				conflicts: [],
				diagnostics: [],
				failedCount: 0,
				newlyApplied: [],
				pendingCount: 0,
				skippedCount: 0,
			};
		}

		newlyApplied.push(
			...(await applyApplicationMigrations(backend, plan.pending, ui)),
		);
		await applyEmbeddedAuthMigrations(options, connectionString, ui);
		await applyChatIfEnabled(connectionString);
		authPlan = await loadAuthPlan(options, connectionString, true);

		const outcome = `${newlyApplied.length} migration(s) applied`;
		renderReport(ui, summaryBase, authPlan, outcome);

		return {
			...summaryBase,
			appliedCount: plan.applied.length + newlyApplied.length,
			authPlan,
			conflicts: [],
			diagnostics: [],
			failedCount: 0,
			newlyApplied,
			pendingCount: 0,
			skippedCount: 0,
		};
	} catch (error) {
		throw translateRunError(error);
	} finally {
		if (backend) {
			await backend.close();
		}
	}
}

function managedAuthDiagnostics(
	managedAuth: ManagedAuthInspection,
	level: "warn" | "error",
): NonNullable<MigrationRunSummary["diagnostics"]> {
	if (!managedAuth.drifted) {
		return [];
	}
	return [
		{
			level,
			code: "ATHENA-MIG-AUTH-MANAGED-001",
			message: formatManagedAuthDrift(managedAuth),
		},
	];
}

function inspectCombinedLedgers(input: {
	authPlan: AthenaAuthMigrationPlan | undefined;
	gitDiagnostics: NonNullable<MigrationRunSummary["diagnostics"]>;
	managedAuth: ManagedAuthInspection;
	mode: Extract<
		MigrationCommandMode,
		"status" | "plan" | "check" | "drift" | "verify"
	>;
	plan: MigrationPlan;
	semantic: NonNullable<MigrationRunSummary["semantic"]>;
	strict: boolean;
	summaryBase: Pick<
		MigrationRunSummary,
		| "providerLabel"
		| "databaseLabel"
		| "directory"
		| "plan"
		| "mode"
		| "dryRun"
		| "gitWorktree"
		| "sourceControl"
	>;
	ui: import("../cli/ui/types.ts").AthenaCliUI;
}): MigrationRunSummary {
	const {
		authPlan,
		gitDiagnostics,
		managedAuth,
		mode,
		plan,
		semantic,
		strict,
		summaryBase,
		ui,
	} = input;
	const semanticBlocked = blockingSemantic(semantic);
	const unknownAuth = hasUnknownAuthGenerations(authPlan);
	const outcome = planHasBlockingConflicts(plan)
		? "Application migration history has conflicts."
		: semanticBlocked
			? "Application schema drift / unsatisfied dependencies."
			: authPlan?.hasBlockingDrift
				? "Embedded Auth schema drift detected."
				: unknownAuth || (authPlan?.conflictCount ?? 0) > 0
					? "Embedded Auth ledger has unknown or conflicting generations."
					: plan.pending.length === 0 && (authPlan?.pendingCount ?? 0) === 0
						? "Database is up to date."
						: "Pending migrations remain.";

	const semanticDiagnostics = semantic.diagnostics.map((item) => ({
		level: "error" as const,
		code: item.code,
		message: formatDiagnostic(item),
	}));
	const verification = mode === "check" || mode === "drift" || mode === "verify";
	const managedLevel =
		strict && (mode === "check" || mode === "verify") ? "error" : "warn";
	const combinedDiagnostics = [
		...gitDiagnostics,
		...semanticDiagnostics,
		...unknownAuthLedgerDiagnostics(authPlan, verification ? "error" : "warn"),
		...managedAuthDiagnostics(managedAuth, managedLevel),
	];

	if (mode === "plan" || mode === "check" || mode === "drift") {
		ui.info(formatMigrationGraph(semantic.graph));
	}

	renderReport(ui, summaryBase, authPlan, outcome, combinedDiagnostics);

	if (planHasBlockingConflicts(plan)) {
		throw new MigrationError("HISTORY", formatConflictBlock(plan));
	}
	if (
		semanticBlocked &&
		(mode === "check" || mode === "drift" || mode === "plan")
	) {
		throw new MigrationError(
			"SEMANTIC",
			formatPreflightFailure(semantic.diagnostics),
		);
	}
	if (verification && unknownAuth && authPlan) {
		throw new MigrationError("HISTORY", formatUnknownAuthLedgerError(authPlan));
	}
	if (managedLevel === "error" && managedAuth.drifted) {
		throw new MigrationError("INTEGRITY", formatManagedAuthDrift(managedAuth));
	}

	return {
		...summaryBase,
		appliedCount: plan.applied.length,
		authPlan,
		conflicts: plan.conflicts,
		diagnostics: combinedDiagnostics,
		failedCount: semanticBlocked ? 1 : 0,
		newlyApplied: [],
		pendingCount: plan.pending.length,
		semantic,
		skippedCount: 0,
	};
}
