import { runMigrations } from "../../../migrations/runner.ts";
import { MigrationError } from "../../../migrations/types.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { isDebugEnabled } from "../../debug.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, MigrateCommand } from "../../types.ts";
import { parseMigrateAuthSyncFlags } from "./auth-sync.ts";
import { type MigrateMode, parseMigrateFlags } from "./flags.ts";

export { migrateCatalog, migrateCatalog as catalog } from "./catalog.ts";
export { parseMigrateFlags } from "./flags.ts";

export const names: readonly string[] = ["migrate"];

const MIGRATE_SUBCOMMANDS = new Set<MigrateMode>([
	"status",
	"plan",
	"repair",
	"check",
	"graph",
	"explain",
	"drift",
	"reconcile",
	"verify",
]);

export function parse(rest: string[]): CliCommand {
	const head = rest[0];
	if (head === "auth") {
		const flags =
			rest[1] === "sync" || rest[1] === "materialize"
				? rest.slice(2)
				: rest.slice(1);
		return parseMigrateAuthSyncFlags(flags);
	}
	if (head && MIGRATE_SUBCOMMANDS.has(head as MigrateMode)) {
		return parseMigrateFlags(rest.slice(1), head as MigrateMode);
	}
	return parseMigrateFlags(rest, "apply");
}

export function usage(): string {
	return formatCatalogTopicUsage("migrate");
}

export function migrateStatusUsage(): string {
	return formatCatalogTopicUsage("migrate-status");
}

export function sessionTitle(_parsed: MigrateCommand): undefined {
	return undefined;
}

export async function run(
	ctx: CommandContext,
	parsed: MigrateCommand,
): Promise<void> {
	const { capabilities, errorLog, log, presentation, runtime } = ctx;
	if (parsed.mode === "verify") {
		const { runMigrateVerify } = await import("./verify.ts");
		await runMigrateVerify(ctx, parsed);
		return;
	}
	const runMigrate = runtime.runMigrations ?? runMigrations;
	try {
		if (isDebugEnabled()) {
			errorLog(
				`[athena-js] migrate starting (mode=${parsed.mode} dryRun=${parsed.dryRun}${parsed.configPath ? ` config=${parsed.configPath}` : ""})`,
			);
		}
		await runMigrate({
			configPath: parsed.configPath,
			allowDirty: parsed.allowDirty,
			allowDirtyMigrations: parsed.allowDirty,
			applyReconcile: parsed.applyReconcile,
			dryRun: parsed.dryRun || parsed.mode === "dry-run",
			explainTarget: parsed.explainTarget,
			json: parsed.json,
			log,
			mode: parsed.mode,
			plain: parsed.plain || presentation.noColor === true,
			strict: parsed.strict,
			yes: parsed.yes,
		});
	} catch (error) {
		if (error instanceof MigrationError) {
			logCliError(error, errorLog, capabilities);
		} else {
			logCliError(
				formatGeneratorError(error, parsed.configPath),
				errorLog,
				capabilities,
			);
		}
		setCliExitCode(exitCodeForError(error));
	}
}
