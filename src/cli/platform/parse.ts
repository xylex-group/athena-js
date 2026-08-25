import { argvWantsHelp } from "../argv.ts";
import { unknownCommandError } from "../parse-helpers.ts";
import type { CliCommand } from "../types.ts";
import type { CommandRegistry } from "./registry.ts";

export function parseRegisteredCommand(
	registry: CommandRegistry,
	argv: readonly string[],
): CliCommand {
	if (argv.length === 0) {
		return { command: "help", topic: "root" };
	}

	if (argv[0] === "--help" || argv[0] === "-h") {
		const matched = argv[1] ? registry.match(argv.slice(1)) : undefined;
		if (matched) {
			const parsed = matched.command.parse(["--help", ...matched.rest]);
			if (parsed.command === "help") {
				return parsed;
			}
		}
		return { command: "help", topic: "root" };
	}

	const matched = registry.match(argv);
	if (!matched) {
		throw unknownCommandError(argv[0] ?? "");
	}

	if (argvWantsHelp(argv) && matched.command.path[0] !== "help") {
		const parsed = matched.command.parse(["--help", ...matched.rest]);
		if (parsed.command === "help") {
			return parsed;
		}
	}

	return matched.command.parse(matched.rest);
}
