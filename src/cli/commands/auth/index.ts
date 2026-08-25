import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { CliExitCode, setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import {
	encodeCliJsonSuccess,
	exitCodeForError,
	stringifyCliJson,
} from "../../platform/index.ts";
import type {
	AuthAuditCommand,
	AuthCapabilitiesCommand,
	AuthDoctorCommand,
	AuthStatusCommand,
	AuthTracesCommand,
	CliCommand,
} from "../../types.ts";
import {
	buildAuthCapabilityMatrix,
	formatAuthCapabilityMatrix,
} from "./capabilities-report.ts";
import {
	inspectLocalAuthStatus,
	queryLocalAuthAudit,
	queryLocalAuthTraces,
} from "./inspect-local.ts";
import {
	buildAuthStatusReport,
	formatAuthStatusText,
} from "./status-report.ts";

export { authCatalog, authCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["auth"];

export function parse(rest: string[]): CliCommand {
	const head = rest[0];
	if (
		head === undefined ||
		head === "help" ||
		head === "--help" ||
		head === "-h"
	) {
		return { command: "auth" };
	}
	if (head === "status") {
		return parseFlagCommand("auth-status", rest.slice(1));
	}
	if (head === "doctor") {
		return parseFlagCommand("auth-doctor", rest.slice(1));
	}
	if (head === "capabilities") {
		return parseFlagCommand("auth-capabilities", rest.slice(1));
	}
	if (head === "audit") {
		return parseObservability("auth-audit", rest.slice(1));
	}
	if (head === "traces") {
		return parseObservability("auth-traces", rest.slice(1));
	}
	throw unknownOptionError(head, "auth");
}

function parseFlagCommand(
	command: "auth-status" | "auth-doctor" | "auth-capabilities",
	rest: readonly string[],
): CliCommand {
	let json = false;
	let strict = false;
	for (const token of rest) {
		if (token === "--help" || token === "-h") {
			return { command: "help", topic: "auth" };
		}
		if (token === "--json") {
			json = true;
			continue;
		}
		if (token === "--strict" && command === "auth-doctor") {
			strict = true;
			continue;
		}
		throw unknownOptionError(token, command.replace("-", " "));
	}
	if (command === "auth-doctor") {
		return { command, json, strict };
	}
	return { command, json };
}

function parseObservability(
	command: "auth-audit" | "auth-traces",
	rest: readonly string[],
): CliCommand {
	let json = false;
	let errors = false;
	let limit = 20;
	let action: "list" | "show" = "list";
	let target: string | undefined;
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--help" || token === "-h") {
			return { command: "help", topic: "auth" };
		}
		if (token === "--json") {
			json = true;
			continue;
		}
		if (token === "--errors") {
			errors = true;
			continue;
		}
		if (token === "--limit") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --limit option.");
			}
			limit = Number(nextValue);
			if (!Number.isInteger(limit) || limit < 1) {
				throw new Error(`Invalid --limit value "${nextValue}".`);
			}
			index += 1;
			continue;
		}
		if (token === "list" || token === "show") {
			action = token;
			continue;
		}
		if (token && !token.startsWith("-") && !target) {
			action = "show";
			target = token;
			continue;
		}
		throw unknownOptionError(token ?? "", command.replace("-", " "));
	}
	return { command, action, errors, json, limit, target };
}

export function usage(): string {
	return formatCatalogTopicUsage("auth");
}

function wantsJson(ctx: CommandContext, parsed: { json?: boolean }): boolean {
	return ctx.output === "json" || parsed.json === true;
}

export async function run(
	ctx: CommandContext,
	parsed:
		| AuthStatusCommand
		| AuthDoctorCommand
		| AuthCapabilitiesCommand
		| AuthAuditCommand
		| AuthTracesCommand
		| { command: "auth" },
): Promise<void> {
	try {
		if (parsed.command === "auth") {
			ctx.logRaw(usage());
			return;
		}
		const json = wantsJson(ctx, parsed);
		if (parsed.command === "auth-capabilities") {
			const rows = buildAuthCapabilityMatrix();
			if (json) {
				ctx.log(
					stringifyCliJson(
						encodeCliJsonSuccess("auth.capabilities", { rows }),
					),
				);
			} else {
				ctx.logRaw(formatAuthCapabilityMatrix(rows, ctx.capabilities));
			}
			return;
		}

		if (
			parsed.command === "auth-status" ||
			parsed.command === "auth-doctor"
		) {
			const facts = ctx.runtime.inspectAuthStatus
				? await ctx.runtime.inspectAuthStatus({ cwd: ctx.cwd })
				: await inspectLocalAuthStatus({
						configPath: ctx.globals.configPath,
						cwd: ctx.cwd,
					});
			const status = buildAuthStatusReport(facts);
			if (json) {
				ctx.log(
					stringifyCliJson(
						encodeCliJsonSuccess(
							parsed.command === "auth-doctor" ? "auth.doctor" : "auth.status",
							status,
						),
					),
				);
			} else {
				ctx.logRaw(formatAuthStatusText(status, ctx.capabilities));
			}
			if (parsed.command === "auth-doctor" && !status.ok) {
				setCliExitCode(CliExitCode.Validation);
			}
			return;
		}

		if (parsed.command === "auth-audit") {
			const query = ctx.runtime.queryAuthAudit ?? queryLocalAuthAudit;
			const rows = await query({
				action: parsed.action,
				configPath: ctx.globals.configPath,
				cwd: ctx.cwd,
				limit: parsed.limit,
				target: parsed.target,
			});
			if (json) {
				ctx.log(
					stringifyCliJson(encodeCliJsonSuccess("auth.audit", { rows })),
				);
			} else {
				for (const row of rows) {
					ctx.log(`${row.at}  ${row.event}  ${row.actor ?? ""}`.trimEnd());
				}
			}
			return;
		}

		const query = ctx.runtime.queryAuthTraces ?? queryLocalAuthTraces;
		const rows = await query({
			action: parsed.action,
			configPath: ctx.globals.configPath,
			cwd: ctx.cwd,
			errorsOnly: parsed.errors,
			limit: parsed.limit,
			target: parsed.target,
		});
		if (json) {
			ctx.log(
				stringifyCliJson(encodeCliJsonSuccess("auth.traces", { rows })),
			);
		} else {
			for (const row of rows) {
				ctx.log(
					`${row.method} ${row.path}  ${row.statusCode ?? ""} · ${row.totalMs ?? "?"}ms`,
				);
			}
		}
	} catch (error) {
		logCliError(formatGeneratorError(error), ctx.errorLog, ctx.capabilities);
		setCliExitCode(exitCodeForError(error));
	}
}
