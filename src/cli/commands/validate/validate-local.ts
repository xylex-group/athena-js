/**
 * Local Data Runtime + Embedded Auth (+ passkey) validation for the CLI.
 * Read-only: never applies migrations.
 */
import { createPostgresAuthDatabase } from "../../../auth/local/database.ts";
import type { AthenaAuthMigrationPlan } from "../../../auth/local/schema.ts";
import { planAthenaAuthSchema } from "../../../auth/local/schema.ts";
import { createPasskeyRelyingPartySnapshot } from "../../../auth/passkey/server/relying-party.ts";
import { AthenaConfigurationError } from "../../../config/errors.ts";
import { loadGeneratorConfig } from "../../../generator/config.ts";
import { resolveGeneratorDatabaseAuthority } from "../../../generator/database-authority.ts";
import { discoverMigrations } from "../../../migrations/discovery.ts";
import {
	planHasBlockingConflicts,
	planMigrations,
} from "../../../migrations/planner.ts";
import { createPostgresMigrationBackend } from "../../../migrations/postgres.ts";
import type {
	AppliedMigration,
	MigrationPlan,
} from "../../../migrations/types.ts";
import { resolveCliCapabilities } from "../../ui/capabilities.ts";
import { paint } from "../../ui/colors.ts";
import type { CliCapabilities } from "../../ui/types.ts";

export type ValidationSeverity = "ok" | "warn" | "error" | "skip";

export interface ValidationCheck {
	detail?: string;
	group: "data" | "auth" | "passkey";
	id: string;
	status: ValidationSeverity;
	title: string;
}

export interface ValidationReport {
	checks: ValidationCheck[];
	errorCount: number;
	ok: boolean;
	target?: { database: string; provider: string };
	title: string;
	warnCount: number;
}

export interface ValidateLocalInspect {
	applicationPlan?: () => Promise<MigrationPlan>;
	authPlan?: () => Promise<AthenaAuthMigrationPlan>;
	columns?: (schema: string, table: string) => Promise<readonly string[]>;
	passkey?: () => {
		enabled?: boolean;
		origins?: readonly string[];
		relatedOrigins?: readonly string[];
		rpId?: string | null;
		rpName?: string | null;
	};
	ping?: () => Promise<void>;
	tables?: (schema: string) => Promise<readonly string[]>;
	target?: () => Promise<{
		database: string;
		directory: string;
		provider: string;
	}>;
}

export interface ValidateLocalOptions {
	configPath?: string;
	cwd?: string;
	environment?: "development" | "production";
	inspect?: ValidateLocalInspect;
	json?: boolean;
	plain?: boolean;
	strict?: boolean;
}

function tag(
	status: ValidationSeverity,
	capabilities: CliCapabilities,
): string {
	const raw =
		status === "ok"
			? "ok  "
			: status === "warn"
				? "warn"
				: status === "skip"
					? "skip"
					: "err ";
	const color =
		status === "ok"
			? "green"
			: status === "warn"
				? "yellow"
				: status === "skip"
					? "dim"
					: "red";
	return paint(raw, color, capabilities);
}

export function formatValidationReport(
	report: ValidationReport,
	capabilities: CliCapabilities = resolveCliCapabilities({ plain: true }),
): string {
	const lines: string[] = [paint(report.title, "bold", capabilities), ""];
	if (report.target) {
		lines.push(paint("Target", "bold", capabilities), "");
		lines.push(
			`  ${paint("Provider    ", "dim", capabilities)}${report.target.provider}`,
		);
		lines.push(
			`  ${paint("Database    ", "dim", capabilities)}${report.target.database}`,
		);
		lines.push("");
	}

	let currentGroup: ValidationCheck["group"] | undefined;
	const titles: Record<ValidationCheck["group"], string> = {
		auth: "Embedded Auth",
		data: "Data runtime",
		passkey: "Passkeys",
	};
	for (const check of report.checks) {
		if (check.group !== currentGroup) {
			if (currentGroup) {
				lines.push("");
			}
			currentGroup = check.group;
			lines.push(paint(titles[check.group], "bold", capabilities), "");
		}
		lines.push(`  [${tag(check.status, capabilities)}] ${check.title}`);
		if (check.detail) {
			for (const line of check.detail.split("\n")) {
				lines.push(paint(`         ${line}`, "dim", capabilities));
			}
		}
	}

	lines.push("");
	lines.push(
		paint(
			`  ${report.errorCount} error(s) · ${report.warnCount} warning(s)`,
			"dim",
			capabilities,
		),
	);
	lines.push(report.ok ? "result: OK" : "result: FAILED");
	return lines.join("\n");
}

function push(
	checks: ValidationCheck[],
	check: ValidationCheck,
	strict: boolean,
): void {
	if (strict && check.status === "warn") {
		checks.push({ ...check, status: "error" });
		return;
	}
	checks.push(check);
}

async function defaultInspect(
	options: ValidateLocalOptions,
): Promise<ValidateLocalInspect> {
	const cwd = options.cwd ?? process.cwd();
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
	const provider = authority.provider;
	authority.restoreEnv();
	if (provider.kind !== "postgres" || provider.mode !== "direct") {
		throw new Error(
			`Local validate requires postgres/direct (got ${provider.kind}/${provider.mode}).`,
		);
	}
	const connectionString = provider.connectionString;
	const database =
		provider.database ??
		(() => {
			try {
				const url = new URL(
					connectionString.replace(/^postgresql:/i, "postgres:"),
				);
				return (
					decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres"
				);
			} catch {
				return "postgres";
			}
		})();
	const directory = loaded.config.migrations.directory || "athena/migrations";

	return {
		async applicationPlan() {
			const backend = await createPostgresMigrationBackend({
				connectionString,
				database,
			});
			try {
				const local = await discoverMigrations({ cwd, directory });
				let applied: AppliedMigration[] = [];
				try {
					applied = await backend.listAppliedMigrations();
				} catch {
					applied = [];
				}
				return planMigrations({ applied, local });
			} finally {
				await backend.close();
			}
		},
		async authPlan() {
			const db = await createPostgresAuthDatabase(connectionString);
			try {
				return await planAthenaAuthSchema(db, { inspectSchema: true });
			} finally {
				await db.close?.();
			}
		},
		async columns(schema, table) {
			const db = await createPostgresAuthDatabase(connectionString);
			try {
				const result = await db.query<{ column_name: string }>(
					`SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2`,
					[schema, table],
				);
				return result.rows.map((row) => row.column_name);
			} finally {
				await db.close?.();
			}
		},
		async ping() {
			const db = await createPostgresAuthDatabase(connectionString);
			try {
				await db.query("SELECT 1 AS ok");
			} finally {
				await db.close?.();
			}
		},
		async tables(schema) {
			const db = await createPostgresAuthDatabase(connectionString);
			try {
				const result = await db.query<{ table_name: string }>(
					`SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = $1`,
					[schema],
				);
				return result.rows.map((row) => row.table_name);
			} finally {
				await db.close?.();
			}
		},
		async target() {
			return {
				database,
				directory,
				provider: `postgres/${provider.mode}`,
			};
		},
	};
}

export async function validateLocalRuntime(
	options: ValidateLocalOptions = {},
): Promise<ValidationReport> {
	const strict = Boolean(options.strict);
	const environment =
		options.environment ??
		(process.env.NODE_ENV === "production" ? "production" : "development");
	const checks: ValidationCheck[] = [];
	let inspect: ValidateLocalInspect;
	let target: ValidationReport["target"];

	try {
		inspect = options.inspect ?? (await defaultInspect(options));
		target = await inspect.target?.();
		push(
			checks,
			{
				group: "data",
				id: "data.config",
				status: "ok",
				title: "Generator config",
				detail: target
					? `${target.provider} · ${target.database}`
					: "postgres/direct",
			},
			strict,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		push(
			checks,
			{
				detail: message,
				group: "data",
				id: "data.config",
				status: "error",
				title: "Generator config",
			},
			strict,
		);
		return finalize(checks, target);
	}

	try {
		await inspect.ping?.();
		push(
			checks,
			{
				group: "data",
				id: "data.connect",
				status: "ok",
				title: "Database connection",
			},
			strict,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		push(
			checks,
			{
				detail: message,
				group: "data",
				id: "data.connect",
				status: "error",
				title: "Database connection",
			},
			strict,
		);
		return finalize(checks, target);
	}

	if (inspect.applicationPlan) {
		try {
			const plan = await inspect.applicationPlan();
			if (planHasBlockingConflicts(plan)) {
				push(
					checks,
					{
						detail: `${plan.conflicts.length} history conflict(s). Restore applied files or add a forward migration.`,
						group: "data",
						id: "data.migrations",
						status: "error",
						title: "Application migrations",
					},
					strict,
				);
			} else if (plan.pending.length > 0) {
				push(
					checks,
					{
						detail: `${plan.pending.length} pending. Run athena-js migrate.`,
						group: "data",
						id: "data.migrations",
						status: "warn",
						title: "Application migrations",
					},
					strict,
				);
			} else {
				push(
					checks,
					{
						detail: `${plan.applied.length} applied`,
						group: "data",
						id: "data.migrations",
						status: "ok",
						title: "Application migrations",
					},
					strict,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			push(
				checks,
				{
					detail: message,
					group: "data",
					id: "data.migrations",
					status: "error",
					title: "Application migrations",
				},
				strict,
			);
		}
	}

	let authPlan: AthenaAuthMigrationPlan | undefined;
	if (inspect.authPlan) {
		try {
			authPlan = await inspect.authPlan();
			if (authPlan.conflictCount > 0 || authPlan.hasBlockingDrift) {
				push(
					checks,
					{
						detail: `${authPlan.conflictCount} conflict(s), ${authPlan.driftCount} drift. Use athena-js migrate repair --yes after inspecting.`,
						group: "auth",
						id: "auth.schema",
						status: "error",
						title: "Embedded Auth schema",
					},
					strict,
				);
			} else if (authPlan.pendingCount > 0) {
				push(
					checks,
					{
						detail: `${authPlan.pendingCount} pending / ${authPlan.appliedCount} applied. Run athena-js migrate.`,
						group: "auth",
						id: "auth.schema",
						status: "warn",
						title: "Embedded Auth schema",
					},
					strict,
				);
			} else {
				push(
					checks,
					{
						detail: `${authPlan.appliedCount} applied`,
						group: "auth",
						id: "auth.schema",
						status: "ok",
						title: "Embedded Auth schema",
					},
					strict,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			push(
				checks,
				{
					detail: message,
					group: "auth",
					id: "auth.schema",
					status: "error",
					title: "Embedded Auth schema",
				},
				strict,
			);
		}
	}

	const tables = inspect.tables
		? new Set(
				(await inspect.tables("athena").catch(() => [] as const)).map((name) =>
					name.toLowerCase(),
				),
			)
		: undefined;

	if (tables) {
		if (tables.has("users") && tables.has("sessions")) {
			push(
				checks,
				{
					detail: "athena.users + athena.sessions",
					group: "auth",
					id: "auth.core-tables",
					status: "ok",
					title: "Core Auth tables",
				},
				strict,
			);
		} else {
			push(
				checks,
				{
					detail:
						"Expected athena.users and athena.sessions. Run athena-js migrate.",
					group: "auth",
					id: "auth.core-tables",
					status: tables.size === 0 ? "warn" : "error",
					title: "Core Auth tables",
				},
				strict,
			);
		}

		if (tables.has("verifications")) {
			push(
				checks,
				{
					detail: "Used for passkey challenge consume (DELETE … RETURNING)",
					group: "passkey",
					id: "passkey.challenges",
					status: "ok",
					title: "Challenge store",
				},
				strict,
			);
		} else {
			push(
				checks,
				{
					detail:
						"athena.verifications missing — passkey challenges cannot persist.",
					group: "passkey",
					id: "passkey.challenges",
					status: authPlan && authPlan.pendingCount > 0 ? "warn" : "error",
					title: "Challenge store",
				},
				strict,
			);
		}

		if (tables.has("passkeys")) {
			const columns = new Set(
				(
					(await inspect.columns?.("athena", "passkeys").catch(() => [])) ?? []
				).map((name) => name.toLowerCase()),
			);
			const required = ["credential_id", "counter", "user_id", "public_key"];
			const missingRequired = required.filter((name) => !columns.has(name));
			if (missingRequired.length > 0) {
				push(
					checks,
					{
						detail: `Missing columns: ${missingRequired.join(", ")}`,
						group: "passkey",
						id: "passkey.table",
						status: "error",
						title: "Passkeys table",
					},
					strict,
				);
			} else if (!columns.has("updated_at")) {
				push(
					checks,
					{
						detail:
							"updated_at missing. Run athena-js migrate (Auth generation 22).",
						group: "passkey",
						id: "passkey.table",
						status: "warn",
						title: "Passkeys table",
					},
					strict,
				);
			} else {
				push(
					checks,
					{
						detail: "athena.passkeys with updated_at",
						group: "passkey",
						id: "passkey.table",
						status: "ok",
						title: "Passkeys table",
					},
					strict,
				);
			}
		} else {
			push(
				checks,
				{
					detail:
						"athena.passkeys missing until Embedded Auth migrations apply.",
					group: "passkey",
					id: "passkey.table",
					status: "warn",
					title: "Passkeys table",
				},
				strict,
			);
		}
	}

	const passkey = inspect.passkey?.();
	const envRpId =
		process.env.PASSKEY_RP_ID?.trim() ||
		process.env.ATHENA_PASSKEY_RP_ID?.trim() ||
		null;
	try {
		const snapshot = createPasskeyRelyingPartySnapshot({
			environment,
			passkey: {
				origins: [...(passkey?.origins ?? [])],
				relatedOrigins: [...(passkey?.relatedOrigins ?? [])],
				rpId: passkey?.rpId ?? envRpId,
				rpName: passkey?.rpName ?? null,
			},
			trustedOrigins: [],
		});
		const usingDevDefault =
			snapshot.id === "localhost" && environment !== "production";
		push(
			checks,
			{
				detail: usingDevDefault
					? `rpId=${snapshot.id} (development default). Set passkey.rpId for production.`
					: `rpId=${snapshot.id} · ${snapshot.origins.length} origin(s)`,
				group: "passkey",
				id: "passkey.rp",
				status: usingDevDefault ? "warn" : "ok",
				title: "Relying party",
			},
			strict,
		);
	} catch (error) {
		const message =
			error instanceof AthenaConfigurationError
				? error.message
				: error instanceof Error
					? error.message
					: String(error);
		push(
			checks,
			{
				detail: message,
				group: "passkey",
				id: "passkey.rp",
				status: "error",
				title: "Relying party",
			},
			strict,
		);
	}

	return finalize(checks, target);
}

function finalize(
	checks: ValidationCheck[],
	target: ValidationReport["target"],
): ValidationReport {
	const errorCount = checks.filter((check) => check.status === "error").length;
	const warnCount = checks.filter((check) => check.status === "warn").length;
	return {
		checks,
		errorCount,
		ok: errorCount === 0,
		target,
		title: "Athena JS · validate local",
		warnCount,
	};
}
