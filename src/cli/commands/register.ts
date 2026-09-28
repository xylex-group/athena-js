import {
  defineCommand,
  type RegisteredCommand,
} from "../platform/define-command.ts";
import { CommandRegistry } from "../platform/registry.ts";
import type { CliCommand } from "../types.ts";
import * as apiKeyCommand from "./api-key/index.ts";
import { authCommands } from "./auth/commands.ts";
import { billingCommands } from "./billing/commands.ts";
import * as commandsCommand from "./commands/index.ts";
import * as dbCommand from "./db/index.ts";
import { doctorBundleCommand } from "./doctor/bundle.ts";
import * as doctorCommand from "./doctor/index.ts";
import * as envCommand from "./env/index.ts";
import * as generateCommand from "./generate/index.ts";
import * as helpCommand from "./help/index.ts";
import * as initCommand from "./init/index.ts";
import * as logsCommand from "./logs/index.ts";
import { migrateCommands } from "./migrate/commands.ts";
import { policyCommands } from "./policy/commands.ts";
import * as rightsCommand from "./rights/index.ts";
import { schemaCommands } from "./schema/commands.ts";
import * as validateCommand from "./validate/index.ts";
import * as versionCommand from "./version/index.ts";

function adapt(options: {
  path: readonly string[];
  aliases?: readonly string[];
  aliasPaths?: readonly (readonly string[])[];
  secretFlags?: readonly string[];
  legacy: RegisteredCommand["legacy"];
  parse: (rest: string[]) => CliCommand;
  run: RegisteredCommand["run"];
  usage: () => string;
  sessionTitle?: (parsed: CliCommand) => string | undefined;
}): RegisteredCommand {
  return defineCommand(options);
}

export const CLI_REGISTERED_COMMANDS: RegisteredCommand[] = [
  adapt({
    legacy: "db",
    parse: dbCommand.parse,
    path: ["db"],
    run: (ctx, parsed) => dbCommand.run(ctx, parsed as never),
    usage: dbCommand.usage,
  }),
  adapt({
    legacy: "help",
    parse: helpCommand.parse,
    path: ["help"],
    run: (ctx, parsed) => helpCommand.run(ctx, parsed as never),
    usage: helpCommand.usage,
  }),
  adapt({
    aliases: versionCommand.names,
    legacy: "version",
    parse: versionCommand.parse,
    path: ["version"],
    run: (ctx, parsed) => versionCommand.run(ctx, parsed as never),
    usage: versionCommand.usage,
  }),
  adapt({
    legacy: "logs",
    parse: logsCommand.parse,
    path: ["logs"],
    run: (ctx, parsed) => logsCommand.run(ctx, parsed as never),
    usage: logsCommand.usage,
  }),
  adapt({
    aliases: commandsCommand.names,
    legacy: "commands",
    parse: commandsCommand.parse,
    path: ["commands"],
    run: (ctx, parsed) => commandsCommand.run(ctx, parsed as never),
    usage: commandsCommand.usage,
  }),
  adapt({
    legacy: "init",
    parse: initCommand.parse,
    path: ["init"],
    run: (ctx, parsed) => initCommand.run(ctx, parsed as never),
    sessionTitle: (parsed) => initCommand.sessionTitle(parsed as never),
    usage: initCommand.usage,
  }),
  adapt({
    legacy: "generate",
    parse: generateCommand.parse,
    path: ["generate"],
    run: (ctx, parsed) => generateCommand.run(ctx, parsed as never),
    sessionTitle: (parsed) => generateCommand.sessionTitle(parsed as never),
    usage: generateCommand.usage,
  }),
  ...schemaCommands,
  ...policyCommands,
  ...billingCommands,
  ...migrateCommands,
  ...authCommands,
  adapt({
    aliasPaths: [
      ["env", "check"],
      ["env", "validate"],
    ],
    legacy: "env",
    parse: envCommand.parse,
    path: ["env"],
    run: (ctx, parsed) => envCommand.run(ctx, parsed as never),
    usage: envCommand.usage,
  }),
  adapt({
    aliasPaths: [["validate", "local"]],
    legacy: "validate",
    parse: validateCommand.parse,
    path: ["validate"],
    run: (ctx, parsed) => validateCommand.run(ctx, parsed as never),
    usage: validateCommand.usage,
  }),
  adapt({
    legacy: "doctor",
    parse: doctorCommand.parse,
    path: ["doctor"],
    run: (ctx, parsed) => doctorCommand.run(ctx, parsed as never),
    usage: doctorCommand.usage,
  }),
  doctorBundleCommand,
  adapt({
    aliases: ["key"],
    legacy: ["api-key-generate", "api-key-list", "api-key-create"],
    parse: apiKeyCommand.parse,
    path: ["api-key"],
    run: (ctx, parsed) => apiKeyCommand.run(ctx, parsed as never),
    secretFlags: ["--admin-key"],
    sessionTitle: (parsed) => apiKeyCommand.sessionTitle(parsed as never),
    usage: apiKeyCommand.usage,
  }),
  adapt({
    legacy: ["rights-list", "rights-catalog", "rights-create"],
    parse: rightsCommand.parse,
    path: ["rights"],
    run: (ctx, parsed) => rightsCommand.run(ctx, parsed as never),
    sessionTitle: (parsed) => rightsCommand.sessionTitle(parsed as never),
    usage: rightsCommand.usage,
  }),
];

export const CLI_COMMAND_REGISTRY = new CommandRegistry(
  CLI_REGISTERED_COMMANDS
);
