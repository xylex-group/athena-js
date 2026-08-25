import { checksumMigrationSql } from "./checksum.ts";
import { planHasBlockingConflicts } from "./planner.ts";
import type { MigrationConflict, MigrationPlan } from "./types.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";

export type MigrationVerifyResult = "READY" | "NOT_READY";

export interface MigrationVerifyAuthFacts {
	conflictCount: number;
	currentGeneration: number | null;
	expectedGeneration: number;
	hasBlockingDrift: boolean;
	pendingCount: number;
}

export interface MigrationVerifyInput {
	allowDirty?: boolean;
	auth: MigrationVerifyAuthFacts;
	databaseLabel: string;
	dirtyWorktree: boolean;
	plan: Pick<MigrationPlan, "applied" | "conflicts" | "pending">;
	providerLabel: string;
	sdkVersion?: string;
	semanticBlocked: boolean;
}

export interface MigrationVerifyReport {
	application: "ok" | "conflict" | "blocked";
	auth: "ok" | "drift" | "conflict";
	database: string;
	dirtyWorktree: boolean;
	drift: "none" | "application" | "auth" | "worktree";
	embeddedAuth: {
		current: number | null;
		expected: number;
		pending: number;
	};
	ok: boolean;
	pending: number;
	plan: string;
	provider: string;
	reasons: string[];
	result: MigrationVerifyResult;
	sdkVersion: string;
}

function fingerprintPayload(input: MigrationVerifyInput): string {
	const applied = input.plan.applied.map(
		(entry) =>
			`${entry.migration.version}:${entry.migration.checksum}:${entry.migration.filename}`,
	);
	const pending = input.plan.pending.map(
		(entry) =>
			`${entry.migration.version}:${entry.migration.checksum}:${entry.migration.filename}`,
	);
	const conflicts = input.plan.conflicts.map(
		(conflict: MigrationConflict) =>
			`${conflict.version}:${conflict.kind}`,
	);
	return [
		applied.join("|"),
		pending.join("|"),
		conflicts.join("|"),
		`auth:${input.auth.expectedGeneration}:${input.auth.currentGeneration ?? "none"}:${input.auth.pendingCount}:${input.auth.hasBlockingDrift ? "1" : "0"}`,
		`dirty:${input.dirtyWorktree ? "1" : "0"}`,
		`semantic:${input.semanticBlocked ? "1" : "0"}`,
	].join("\n");
}

export function evaluateMigrationReadiness(
	input: MigrationVerifyInput,
): MigrationVerifyReport {
	const reasons: string[] = [];
	let application: MigrationVerifyReport["application"] = "ok";
	if (planHasBlockingConflicts(input.plan as MigrationPlan)) {
		application = "conflict";
		reasons.push("application ledger conflicts");
	} else if (input.semanticBlocked) {
		application = "blocked";
		reasons.push("application schema/preflight blocked");
	}

	let auth: MigrationVerifyReport["auth"] = "ok";
	if (input.auth.hasBlockingDrift) {
		auth = "drift";
		reasons.push("Embedded Auth schema drift");
	} else if (input.auth.conflictCount > 0) {
		auth = "conflict";
		reasons.push("Embedded Auth ledger conflicts");
	}

	if (input.dirtyWorktree && !input.allowDirty) {
		reasons.push("dirty migration worktree");
	}

	let drift: MigrationVerifyReport["drift"] = "none";
	if (application !== "ok") {
		drift = "application";
	} else if (auth !== "ok") {
		drift = "auth";
	} else if (input.dirtyWorktree && !input.allowDirty) {
		drift = "worktree";
	}

	const ok = reasons.length === 0;
	const plan = checksumMigrationSql(fingerprintPayload(input)).slice(0, 12);

	return {
		application,
		auth,
		database: input.databaseLabel,
		dirtyWorktree: input.dirtyWorktree,
		drift,
		embeddedAuth: {
			current: input.auth.currentGeneration,
			expected: input.auth.expectedGeneration,
			pending: input.auth.pendingCount,
		},
		ok,
		pending: input.plan.pending.length,
		plan,
		provider: input.providerLabel,
		reasons,
		result: ok ? "READY" : "NOT_READY",
		sdkVersion: input.sdkVersion ?? PACKAGE_VERSION,
	};
}

export function formatMigrationVerifyText(report: MigrationVerifyReport): string {
	const authStatus =
		report.auth === "ok"
			? "✓"
			: report.auth === "drift"
				? "drift"
				: "conflict";
	const appStatus =
		report.application === "ok"
			? "✓"
			: report.application === "conflict"
				? "conflict"
				: "blocked";
	const lines = [
		"Migration readiness",
		"",
		`Database       ${report.database}`,
		`Provider       ${report.provider}`,
		`Application    ${appStatus}`,
		`Embedded Auth  ${authStatus}  (expected ${report.embeddedAuth.expected}${report.embeddedAuth.current != null ? `, ledger ${report.embeddedAuth.current}` : ""})`,
		`Drift          ${report.drift}`,
		`Pending        ${report.pending}`,
		`Plan           ${report.plan}`,
		`Result         ${report.result}`,
	];
	if (report.reasons.length > 0) {
		lines.push("", "Blocked by:");
		for (const reason of report.reasons) {
			lines.push(`  - ${reason}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

export async function runMigrationVerify(
	options: import("./types.ts").RunMigrationsOptions = {},
): Promise<MigrationVerifyReport> {
	const { prepareApplicationMigrationRun } = await import(
		"./application/prepare.ts"
	);
	const { assertDirectPostgres, databaseLabel, providerLabel } = await import(
		"./application/authority.ts"
	);
	const { blockingSemantic, compileApplicationSemantics } = await import(
		"./application/semantics.ts"
	);
	const { loadAuthPlan } = await import("./embedded-auth/plan.ts");
	const { planMigrations } = await import("./planner.ts");
	const { createPostgresMigrationBackend } = await import("./postgres.ts");
	const { ATHENA_AUTH_SCHEMA_GENERATION } = await import(
		"../auth/contract/index.ts"
	);

	const prepared = await prepareApplicationMigrationRun({
		...options,
		dryRun: true,
		mode: "verify",
	});
	const pg = assertDirectPostgres(prepared.config);
	const backend =
		(await options.createBackend?.({
			connectionString: pg.connectionString,
			database: pg.database,
		})) ??
		(await createPostgresMigrationBackend({
			connectionString: pg.connectionString,
			database: pg.database,
		}));

	try {
		const applied = await backend.listAppliedMigrations();
		const plan = planMigrations({ applied, local: prepared.local });
		const authPlan = await loadAuthPlan(options, pg.connectionString, true);
		const semantic = await compileApplicationSemantics({
			backend,
			cacheDir: prepared.cwd,
			local: prepared.local,
			plan,
			strict: options.strict,
		});
		const appliedAuth = authPlan?.entries.filter(
			(entry) => entry.ledgerState === "applied" || entry.action === "none",
		);
		const currentGeneration =
			appliedAuth && appliedAuth.length > 0
				? Math.max(...appliedAuth.map((entry) => entry.version))
				: null;
		return evaluateMigrationReadiness({
			allowDirty: prepared.allowDirtyMigrations,
			auth: {
				conflictCount: authPlan?.conflictCount ?? 0,
				currentGeneration,
				expectedGeneration: ATHENA_AUTH_SCHEMA_GENERATION,
				hasBlockingDrift: authPlan?.hasBlockingDrift === true,
				pendingCount: authPlan?.pendingCount ?? 0,
			},
			databaseLabel: databaseLabel(prepared.config),
			dirtyWorktree: prepared.gitWorktree.dirty,
			plan,
			providerLabel: providerLabel(prepared.config),
			semanticBlocked: blockingSemantic(semantic),
		});
	} finally {
		await backend.close();
	}
}
