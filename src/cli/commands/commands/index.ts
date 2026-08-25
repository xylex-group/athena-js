import type { CommandContext } from "../../command-context.ts";
import {
	type CommandsListFormat,
	formatCatalogTopicUsage,
	formatCommandsCatalog,
} from "../../commands-catalog.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import type { CliCommand, CommandsCommand } from "../../types.ts";

export { commandsCatalog, commandsCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = [
	"--commands",
	"--list-commands",
	"--cmds",
	"-C",
	"commands",
	"list-commands",
	"cmds",
];

function parseCommandsFormat(rest: string[]): CommandsListFormat {
	let format: CommandsListFormat = "full";
	for (const token of rest) {
		if (token === "--help" || token === "-h") {
			continue;
		}
		if (token === "--json") {
			format = "json";
			continue;
		}
		if (token === "--plain") {
			format = "plain";
			continue;
		}
		if (token === "--groups") {
			format = "groups";
			continue;
		}
		throw unknownOptionError(token, "commands");
	}
	return format;
}

export function parse(rest: string[]): CliCommand {
	if (rest.includes("--help") || rest.includes("-h")) {
		return { command: "help", topic: "commands" };
	}
	return {
		command: "commands",
		format: parseCommandsFormat(rest),
	};
}

export function usage(): string {
	return formatCatalogTopicUsage("commands");
}

export function sessionTitle(_parsed: CommandsCommand): undefined {
	return undefined;
}

export async function run(
	ctx: CommandContext,
	parsed: CommandsCommand,
): Promise<void> {
	ctx.logRaw(
		formatCommandsCatalog({
			capabilities: ctx.capabilities,
			format: parsed.format,
		}),
	);
}
