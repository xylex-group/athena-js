import { expandEqualsArgv, peelPresentationFlags } from "./argv.ts";
import type { CommandContext } from "./command-context.ts";
import { renderUsage } from "./commands/help/index.ts";
import { CLI_COMMAND_REGISTRY } from "./commands/register.ts";
import { AthenaCliError } from "./errors.ts";
import { setCliExitCode } from "./exit-code.ts";
import { formatGeneratorError, logCliError } from "./format-error.ts";
import { parseCommand } from "./parse-command.ts";
import {
	dispatchRegistered,
	encodeCliJsonFailure,
	exitCodeForError,
	peelGlobalFlags,
	sessionTitleFor,
	stringifyCliJson,
} from "./platform/index.ts";
import type { CliRuntime, HelpCommand } from "./types.ts";
import { resolveCliCapabilities } from "./ui/capabilities.ts";
import { colorizeTaggedLine } from "./ui/help.ts";
import { railBar, railEnd, railStart, usesRail } from "./ui/rail.ts";
import type { CliCapabilities } from "./ui/types.ts";

export {
	type CatalogHelpTopic,
	CLI_COMMAND_CATALOG,
	type CliCatalogFlag,
	type CliCommandEntry,
	type CommandsListFormat,
	catalogHelpTopic,
	catalogOptionFlags,
	catalogOptionHelpHint,
	catalogRootCommands,
	catalogSubcommands,
	formatCommandsCatalog,
	formatExpectedCommandsLine,
	listCliCommands,
} from "./commands-catalog.ts";
export { CliExitCode } from "./exit-code.ts";
export { logCliError } from "./format-error.ts";
export { parseCommand } from "./parse-command.ts";
export {
	CLI_JSON_SCHEMA_VERSION,
	defineCommand,
	type CliJsonEnvelope,
	type CommandResult,
	type RegisteredCommand,
} from "./platform/index.ts";
export type { CliRuntime } from "./types.ts";

export function usage(
	topic: HelpCommand["topic"] = "root",
	capabilities?: CliCapabilities,
): string {
	return renderUsage(topic, capabilities);
}

function resolveCwd(explicit?: string): string {
	if (explicit && explicit.length > 0) {
		return explicit;
	}
	const proc = (globalThis as { process?: { cwd?: () => string } }).process;
	return proc?.cwd?.() ?? ".";
}

/**
 * CLI entrypoint used by `bin/athena-js.js`.
 *
 * Generator failures are logged with diagnostics (code, remote, cause chain)
 * and exit with a stable {@link CliExitCode} instead of only throwing a bare message.
 */
export async function runCLI(
	argv: string[],
	runtime: CliRuntime = {},
): Promise<void> {
	const { argv: peeled, presentation } = peelPresentationFlags(argv);
	const { globals } = peelGlobalFlags(expandEqualsArgv(peeled));
	const json = globals.output === "json" || globals.output === "ndjson";
	const capabilities = resolveCliCapabilities({
		forceColor: presentation.forceColor,
		isTty: runtime.isTty ?? (runtime.log !== undefined ? false : undefined),
		json,
		noColor: presentation.noColor,
		plain: globals.plain || presentation.noColor,
		quiet: globals.verbosity === "quiet",
		verbose:
			globals.verbosity === "verbose" || globals.verbosity === "debug",
	});
	const logRaw = runtime.log ?? console.log;
	const errorLog = runtime.errorLog ?? console.error;
	let sessionActive = false;
	const log = (message: string) => {
		if (json || !sessionActive) {
			logRaw(json ? message : colorizeTaggedLine(message, capabilities));
			return;
		}
		for (const part of message.split("\n")) {
			logRaw(railBar(colorizeTaggedLine(part, capabilities), capabilities));
		}
	};
	const beginSession = (title: string) => {
		if (json || !usesRail(capabilities)) {
			return;
		}
		sessionActive = true;
		logRaw(railStart(title, capabilities));
	};
	const endSession = () => {
		if (!sessionActive) {
			return;
		}
		sessionActive = false;
		logRaw(railEnd("", capabilities));
	};

	let parsed: ReturnType<typeof parseCommand>;
	try {
		parsed = parseCommand(argv);
	} catch (error) {
		setCliExitCode(exitCodeForError(error));
		if (json) {
			const code = error instanceof AthenaCliError ? error.code : "CLI001";
			const message =
				error instanceof Error ? error.message : "Unknown CLI error.";
			logRaw(
				stringifyCliJson(
					encodeCliJsonFailure("athena-js", {
						code,
						message,
						hint: error instanceof AthenaCliError ? error.hint : undefined,
						details:
							error instanceof AthenaCliError ? error.metadata : undefined,
					}),
				),
			);
			return;
		}
		logCliError(formatGeneratorError(error), errorLog, capabilities);
		return;
	}

	const sessionTitle = sessionTitleFor(CLI_COMMAND_REGISTRY, parsed);
	if (sessionTitle) {
		beginSession(sessionTitle);
	}

	const cwd = resolveCwd(globals.cwd ?? runtime.cwd);
	const ctx: CommandContext = {
		capabilities,
		cwd,
		errorLog,
		globals,
		log,
		logRaw,
		output: globals.output,
		presentation,
		runtime: {
			...runtime,
			cwd,
		},
		verbosity: globals.verbosity,
	};

	try {
		await dispatchRegistered(CLI_COMMAND_REGISTRY, ctx, parsed);
	} finally {
		endSession();
	}
}
