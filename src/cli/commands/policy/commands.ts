import type { CommandContext } from "../../command-context.ts";
import { defineCommand } from "../../platform/define-command.ts";
import type { CliCommand, PolicyDxCommand } from "../../types.ts";
import { parse, run, usage } from "./index.ts";

function adapt(path: readonly string[], prefix: string[] = []) {
	return defineCommand({
		path,
		legacy: path.length === 1 ? "policy" : (`policy-${path[1] ?? "list"}` as CliCommand["command"]),
		parse: (rest) => parse([...prefix, ...rest]),
		run: (ctx: CommandContext, parsed: CliCommand) =>
			run(ctx, parsed as PolicyDxCommand),
		usage,
	});
}

export const policyCommands = [
	adapt(["policy"]),
	adapt(["policy", "list"], ["list"]),
	adapt(["policy", "show"], ["show"]),
	adapt(["policy", "validate"], ["validate"]),
	adapt(["policy", "lint"], ["lint"]),
	adapt(["policy", "coverage"], ["coverage"]),
	adapt(["policy", "explain"], ["explain"]),
	adapt(["policy", "simulate"], ["simulate"]),
	adapt(["policy", "fingerprint"], ["fingerprint"]),
	adapt(["policy", "export"], ["export"]),
];
