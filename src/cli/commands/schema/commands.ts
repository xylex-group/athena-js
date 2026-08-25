import type { CommandContext } from "../../command-context.ts";
import { defineCommand } from "../../platform/define-command.ts";
import type { CliCommand, SchemaDiffCommand, SchemaSnapshotCommand } from "../../types.ts";
import { parse, run, usage } from "./index.ts";

export const schemaCommands = [
	defineCommand({
		path: ["schema"],
		legacy: "schema",
		parse: () => ({ command: "schema" }),
		run: async (ctx) => {
			ctx.logRaw(usage());
		},
		usage,
	}),
	defineCommand({
		path: ["schema", "diff"],
		legacy: "schema-diff",
		parse: (rest) => parse(["diff", ...rest]),
		run: (ctx: CommandContext, parsed: CliCommand) =>
			run(ctx, parsed as SchemaDiffCommand),
		usage,
	}),
	defineCommand({
		path: ["schema", "snapshot"],
		legacy: "schema-snapshot",
		parse: (rest) => parse(["snapshot", ...rest]),
		run: (ctx: CommandContext, parsed: CliCommand) =>
			run(ctx, parsed as SchemaSnapshotCommand),
		usage,
	}),
];
