import type { CommandContext } from "../../command-context.ts";
import { defineCommand, type RegisteredCommand } from "../../platform/define-command.ts";
import type { CliCommand, MigrateCommand } from "../../types.ts";
import { type MigrateMode, parseMigrateFlags } from "./flags.ts";
import { run as runMigrate, usage, migrateStatusUsage } from "./index.ts";

export function defineMigrateCommand(options: {
	path: readonly string[];
	mode: MigrateMode;
}): RegisteredCommand {
	return defineCommand({
		path: options.path,
		legacy: "migrate",
		parse: (rest) => parseMigrateFlags(rest, options.mode),
		run: (ctx: CommandContext, parsed: CliCommand) =>
			runMigrate(ctx, parsed as MigrateCommand),
		usage: options.mode === "status" ? migrateStatusUsage : usage,
	});
}
