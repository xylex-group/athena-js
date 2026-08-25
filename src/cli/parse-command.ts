import {
	expandEqualsArgv,
	peelPresentationFlags,
} from "./argv.ts";
import { CLI_COMMAND_REGISTRY } from "./commands/register.ts";
import { applyGlobalsToCommand, parseRegisteredCommand, peelGlobalFlags } from "./platform/index.ts";
import type { CliCommand } from "./types.ts";

export function parseCommand(rawArgv: string[]): CliCommand {
	const { argv: peeled } = peelPresentationFlags(rawArgv);
	const argv = expandEqualsArgv(peeled);
	const { argv: withoutGlobals, globals } = peelGlobalFlags(argv);
	const parsed = parseRegisteredCommand(CLI_COMMAND_REGISTRY, withoutGlobals);
	return applyGlobalsToCommand(parsed, globals);
}
