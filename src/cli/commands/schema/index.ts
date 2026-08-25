import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { CliExitCode, setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import {
	encodeCliJsonFailure,
	encodeCliJsonSuccess,
	exitCodeForError,
	stringifyCliJson,
} from "../../platform/index.ts";
import type { CliCommand, SchemaDiffCommand, SchemaSnapshotCommand } from "../../types.ts";

export { schemaCatalog, schemaCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["schema"];

export function parse(rest: string[]): CliCommand {
	const head = rest[0];
	if (
		head === undefined ||
		head === "help" ||
		head === "--help" ||
		head === "-h"
	) {
		return { command: "help", topic: "schema" };
	}
	if (head === "diff") {
		return parseDiffFlags(rest.slice(1));
	}
	if (head === "snapshot") {
		return parseSnapshotFlags(rest.slice(1));
	}
	throw unknownOptionError(head, "schema");
}

function parseDiffFlags(rest: readonly string[]): CliCommand {
	let configPath: string | undefined;
	let fromPath: string | undefined;
	let json = false;
	let migration = false;
	let policyImpact = false;
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--help" || token === "-h") {
			return { command: "help", topic: "schema" };
		}
		if (token === "--json") {
			json = true;
			continue;
		}
		if (token === "--migration") {
			migration = true;
			continue;
		}
		if (token === "--policy-impact") {
			policyImpact = true;
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
		if (token === "--from") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --from option.");
			}
			fromPath = nextValue;
			index += 1;
			continue;
		}
		throw unknownOptionError(token ?? "", "schema diff");
	}
	return {
		command: "schema-diff",
		configPath,
		fromPath,
		json,
		migration,
		policyImpact,
	};
}

function parseSnapshotFlags(rest: readonly string[]): CliCommand {
	let configPath: string | undefined;
	let outPath: string | undefined;
	let json = false;
	let check = false;
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--help" || token === "-h") {
			return { command: "help", topic: "schema" };
		}
		if (token === "--json") {
			json = true;
			continue;
		}
		if (token === "--check") {
			check = true;
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
		if (token === "--out" || token === "--file") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --out option.");
			}
			outPath = nextValue;
			index += 1;
			continue;
		}
		throw unknownOptionError(token ?? "", "schema snapshot");
	}
	return {
		command: "schema-snapshot",
		check,
		configPath,
		json,
		outPath,
	};
}

export function usage(): string {
	return formatCatalogTopicUsage("schema");
}

function wantsJson(
	ctx: CommandContext,
	parsed: { json?: boolean },
): boolean {
	return ctx.output === "json" || parsed.json === true;
}

export async function run(
	ctx: CommandContext,
	parsed: SchemaDiffCommand | SchemaSnapshotCommand,
): Promise<void> {
	const json = wantsJson(ctx, parsed);
	try {
		const { runSchemaDiff, runSchemaSnapshot } = await import("./run.ts");
		if (parsed.command === "schema-diff") {
			const report = await runSchemaDiff({
				configPath: parsed.configPath,
				cwd: ctx.cwd,
				fromPath: parsed.fromPath,
				inspect: ctx.runtime.inspectSchemaSnapshot,
				migration: parsed.migration,
				policyImpact: parsed.policyImpact,
			});
			if (json) {
				ctx.log(
					stringifyCliJson(
						encodeCliJsonSuccess("schema.diff", {
							baselineWritten: report.baselineWritten === true,
							destructiveCount: report.destructiveCount,
							fromPath: report.fromPath,
							ok: report.ok,
							operations: report.diff.operations,
							policyImpact: report.policyImpact,
							proposedMigration: report.proposedMigration,
							summary: report.diff.summary,
						}),
					),
				);
			} else if (parsed.migration && report.proposedMigration) {
				ctx.logRaw(report.proposedMigration);
			} else {
				ctx.logRaw(report.text);
			}
			if (!report.ok) {
				setCliExitCode(CliExitCode.Conflict);
			}
			return;
		}

		const report = await runSchemaSnapshot({
			check: parsed.check,
			configPath: parsed.configPath,
			cwd: ctx.cwd,
			inspect: ctx.runtime.inspectSchemaSnapshot,
			outPath: parsed.outPath,
		});
		if (json) {
			ctx.log(
				stringifyCliJson(
					encodeCliJsonSuccess("schema.snapshot", {
						check: report.check,
						destructiveCount: report.destructiveCount,
						ok: report.ok,
						operations: report.diff?.operations,
						path: report.path,
						summary: report.diff?.summary,
					}),
				),
			);
		} else {
			ctx.logRaw(report.text);
		}
		if (!report.ok) {
			setCliExitCode(CliExitCode.Conflict);
		}
	} catch (error) {
		if (json) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.log(
				stringifyCliJson(
					encodeCliJsonFailure(
						parsed.command === "schema-diff" ? "schema.diff" : "schema.snapshot",
						{
							code:
								error instanceof Error && "code" in error
									? String((error as { code?: string }).code ?? "SCHEMA000")
									: "SCHEMA000",
							message,
						},
					),
				),
			);
		} else {
			logCliError(formatGeneratorError(error), ctx.errorLog, ctx.capabilities);
		}
		setCliExitCode(exitCodeForError(error));
	}
}
