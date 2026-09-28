import type { CommandContext } from "../../command-context.ts";
import { defineCommand } from "../../platform/define-command.ts";
import type {
  CliCommand,
  SchemaDiffCommand,
  SchemaSnapshotCommand,
} from "../../types.ts";
import { parse, run, usage } from "./index.ts";

export const schemaCommands = [
  defineCommand({
    legacy: "schema",
    parse: () => ({ command: "schema" }),
    path: ["schema"],
    run: async (ctx) => {
      ctx.logRaw(usage());
    },
    usage,
  }),
  defineCommand({
    legacy: "schema-diff",
    parse: (rest) => parse(["diff", ...rest]),
    path: ["schema", "diff"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as SchemaDiffCommand),
    usage,
  }),
  defineCommand({
    legacy: "schema-snapshot",
    parse: (rest) => parse(["snapshot", ...rest]),
    path: ["schema", "snapshot"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as SchemaSnapshotCommand),
    usage,
  }),
];
