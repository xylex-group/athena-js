import { unknownOptionError } from "../../parse-helpers.ts";
import type { CliCommand, MigrateCommand } from "../../types.ts";

export type MigrateMode = MigrateCommand["mode"];

const READ_MODES = new Set<MigrateMode>([
	"status",
	"plan",
	"check",
	"graph",
	"explain",
	"drift",
	"reconcile",
	"verify",
]);

export function parseMigrateFlags(
	rest: readonly string[],
	mode: MigrateMode,
): CliCommand {
	let configPath: string | undefined;
	let dryRun = false;
	let json = false;
	let plain = false;
	let yes = false;
	let strict = false;
	let allowDirty = false;
	let applyReconcile = false;
	let explainTarget: string | undefined;
	let resolvedMode = mode;

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--help" || token === "-h") {
			if (resolvedMode === "status") {
				return { command: "help", topic: "migrate-status" };
			}
			return { command: "help", topic: "migrate" };
		}

		if (resolvedMode === "explain" && token && !token.startsWith("-") && !explainTarget) {
			explainTarget = token;
			continue;
		}

		if (token === "--dry-run") {
			if (READ_MODES.has(resolvedMode)) {
				throw new Error(`--dry-run cannot be combined with migrate ${resolvedMode}.`);
			}
			dryRun = true;
			if (resolvedMode !== "repair") {
				resolvedMode = "dry-run";
			}
			continue;
		}

		if (token === "--apply") {
			if (resolvedMode !== "reconcile") {
				throw new Error(
					'Unexpected "--apply". Use: athena-js migrate reconcile --apply',
				);
			}
			applyReconcile = true;
			continue;
		}

		if (token === "--yes" || token === "-y") {
			yes = true;
			continue;
		}

		if (token === "--json") {
			json = true;
			continue;
		}

		if (token === "--strict") {
			strict = true;
			continue;
		}

		if (token === "--allow-dirty-migrations" || token === "--allow-dirty") {
			allowDirty = true;
			continue;
		}

		if (token === "--plain" || token === "--no-color") {
			plain = true;
			continue;
		}

		if (token === "--config") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --config option.");
			}
			configPath = nextValue;
			index += 1;
			continue;
		}

		throw unknownOptionError(token ?? "", "migrate");
	}

	if (resolvedMode === "explain" && !explainTarget) {
		return { command: "help", topic: "migrate" };
	}

	return {
		command: "migrate",
		configPath,
		dryRun: resolvedMode === "dry-run" || (resolvedMode === "repair" && dryRun),
		allowDirty,
		applyReconcile,
		explainTarget,
		json,
		mode: resolvedMode,
		plain,
		strict,
		yes,
	};
}
