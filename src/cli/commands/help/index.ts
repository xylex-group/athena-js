import type { CommandContext } from "../../command-context.ts";
import {
	type CatalogHelpTopic,
	catalogHelpTopic,
	formatCatalogTopicUsage,
} from "../../commands-catalog.ts";
import { unknownCommandError } from "../../parse-helpers.ts";
import type { CliCommand, HelpCommand } from "../../types.ts";
import { resolveCliCapabilities } from "../../ui/capabilities.ts";
import { styleHelpText } from "../../ui/help.ts";
import type { CliCapabilities } from "../../ui/types.ts";

export { helpCatalog, helpCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["help"];

export function renderUsage(
	topic: CatalogHelpTopic = "root",
	capabilities?: CliCapabilities,
): string {
	return styleHelpText(
		formatCatalogTopicUsage(topic),
		capabilities ?? resolveCliCapabilities({ plain: true }),
	);
}

export function topicForCommand(
	command: string,
	rest: readonly string[],
): HelpCommand["topic"] | undefined {
	return catalogHelpTopic(command, rest);
}

export function parse(rest: string[]): CliCommand {
	if (rest.length === 0) {
		return { command: "help", topic: "root" };
	}
	const topic = topicForCommand(rest[0] ?? "", rest.slice(1));
	if (topic) {
		return { command: "help", topic };
	}
	throw unknownCommandError(rest[0] ?? "help");
}

export function usage(): string {
	return formatCatalogTopicUsage("root");
}

export function sessionTitle(): undefined {
	return undefined;
}

export async function run(
	ctx: CommandContext,
	parsed: HelpCommand,
): Promise<void> {
	ctx.logRaw(renderUsage(parsed.topic, ctx.capabilities));
}
