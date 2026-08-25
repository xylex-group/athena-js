import type { CommandContext } from "../../command-context.ts";
import { defineCommand } from "../../platform/define-command.ts";
import type { CliCommand } from "../../types.ts";
import { parse, run, usage } from "./index.ts";

function adapt(
	path: readonly string[],
	legacy: CliCommand["command"],
	prefix: string[] = [],
) {
	return defineCommand({
		path,
		legacy,
		parse: (rest) => parse([...prefix, ...rest]),
		run: (ctx: CommandContext, parsed: CliCommand) => run(ctx, parsed as never),
		usage,
	});
}

export const authCommands = [
	adapt(["auth"], "auth"),
	adapt(["auth", "status"], "auth-status", ["status"]),
	adapt(["auth", "doctor"], "auth-doctor", ["doctor"]),
	adapt(["auth", "capabilities"], "auth-capabilities", ["capabilities"]),
	adapt(["auth", "audit"], "auth-audit", ["audit"]),
	adapt(["auth", "traces"], "auth-traces", ["traces"]),
];
