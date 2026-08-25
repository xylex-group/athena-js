import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_VERSION } from "../../../sdk-version.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { redactValue } from "../../logging/redact.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { defineCommand } from "../../platform/define-command.ts";
import {
	encodeCliJsonSuccess,
	exitCodeForError,
	stringifyCliJson,
} from "../../platform/index.ts";
import type { CliCommand, DoctorBundleCommand } from "../../types.ts";
import { runCliDoctor } from "./doctor.ts";

export function parseDoctorBundle(rest: readonly string[]): CliCommand {
	let json = false;
	let outDir: string | undefined;
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--help" || token === "-h") {
			return { command: "help", topic: "doctor" };
		}
		if (token === "--json") {
			json = true;
			continue;
		}
		if (token === "--out") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --out option.");
			}
			outDir = nextValue;
			index += 1;
			continue;
		}
		throw unknownOptionError(token ?? "", "doctor bundle");
	}
	return { command: "doctor-bundle", json, outDir };
}

function stamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
}

export async function runDoctorBundle(
	ctx: CommandContext,
	parsed: DoctorBundleCommand,
): Promise<void> {
	try {
		const doctor =
			ctx.runtime.runCliDoctor ??
			((options: Parameters<typeof runCliDoctor>[0]) => runCliDoctor(options));
		const report = await doctor({
			cwd: ctx.cwd,
			json: true,
			plain: true,
			skipRuntime: false,
			strict: false,
		});
		const files: Record<string, unknown> = {
			"cli-version.txt": PACKAGE_VERSION,
			"doctor.json": report,
			"environment-summary.json": {
				cwd: ctx.cwd,
				node: process.version,
				platform: process.platform,
			},
		};
		if (ctx.runtime.inspectAuthStatus) {
			files["auth-status.json"] = await ctx.runtime.inspectAuthStatus({
				cwd: ctx.cwd,
			});
		}
		if (ctx.runtime.runMigrationVerify) {
			files["migration-status.json"] = await ctx.runtime.runMigrationVerify({
				cwd: ctx.cwd,
			});
		}
		const sanitized = redactValue(files) as Record<string, unknown>;
		const directory = parsed.outDir
			? parsed.outDir
			: join(ctx.cwd, `athena-diagnostics-${stamp()}`);
		mkdirSync(directory, { recursive: true });
		for (const [name, body] of Object.entries(sanitized)) {
			const content =
				typeof body === "string" ? `${body}\n` : `${JSON.stringify(body, null, 2)}\n`;
			writeFileSync(join(directory, name), content, "utf8");
		}
		writeFileSync(
			join(directory, "bundle.json"),
			`${JSON.stringify(sanitized, null, 2)}\n`,
			"utf8",
		);
		if (ctx.output === "json" || parsed.json) {
			ctx.log(
				stringifyCliJson(
					encodeCliJsonSuccess("doctor.bundle", {
						directory,
						files: Object.keys(sanitized),
					}),
				),
			);
		} else {
			ctx.log(`Wrote diagnostic bundle\n  ${directory}\n`);
			ctx.log("Secrets (passwords, API keys, tokens) are redacted.");
		}
	} catch (error) {
		logCliError(formatGeneratorError(error), ctx.errorLog, ctx.capabilities);
		setCliExitCode(exitCodeForError(error));
	}
}

export const doctorBundleCommand = defineCommand({
	path: ["doctor", "bundle"],
	legacy: "doctor-bundle",
	parse: (rest) => parseDoctorBundle(rest),
	run: (ctx, parsed) =>
		runDoctorBundle(ctx, parsed as DoctorBundleCommand),
	usage: () => formatCatalogTopicUsage("doctor"),
});
