import type { CommandContext } from "../command-context.ts";
import type { CliCommand } from "../types.ts";
import type { CommandRegistry } from "./registry.ts";

export async function dispatchRegistered(
	registry: CommandRegistry,
	ctx: CommandContext,
	parsed: CliCommand,
): Promise<void> {
	const command = registry.findByLegacy(parsed.command);
	if (!command) {
		throw new Error(`No registered command for "${parsed.command}".`);
	}
	await command.run(ctx, parsed);
}

export function sessionTitleFor(
	registry: CommandRegistry,
	parsed: CliCommand,
): string | undefined {
	return registry.findByLegacy(parsed.command)?.sessionTitle?.(parsed);
}
