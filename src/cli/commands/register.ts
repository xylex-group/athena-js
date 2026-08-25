import type { CommandContext } from "../command-context.ts";
import {
	defineCommand,
	type RegisteredCommand,
} from "../platform/define-command.ts";
import { CommandRegistry } from "../platform/registry.ts";
import type { CliCommand } from "../types.ts";
import * as apiKeyCommand from "./api-key/index.ts";
import { authCommands } from "./auth/commands.ts";
import * as commandsCommand from "./commands/index.ts";
import { doctorBundleCommand } from "./doctor/bundle.ts";
import * as doctorCommand from "./doctor/index.ts";
import * as envCommand from "./env/index.ts";
import * as generateCommand from "./generate/index.ts";
import * as helpCommand from "./help/index.ts";
import * as initCommand from "./init/index.ts";
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
	legacy: RegisteredCommand["legacy"];
	parse: (rest: string[]) => CliCommand;
	run: (ctx: CommandContext, parsed: CliCommand) => Promise<void>;
	usage: () => string;
	sessionTitle?: (parsed: CliCommand) => string | undefined;
}): RegisteredCommand {
	return defineCommand(options);
}

export const CLI_REGISTERED_COMMANDS: RegisteredCommand[] = [
	adapt({
		path: ["help"],
		legacy: "help",
		parse: helpCommand.parse,
		run: (ctx, parsed) => helpCommand.run(ctx, parsed as never),
		usage: helpCommand.usage,
	}),
	adapt({
		path: ["version"],
		aliases: versionCommand.names,
		legacy: "version",
		parse: versionCommand.parse,
		run: (ctx, parsed) => versionCommand.run(ctx, parsed as never),
		usage: versionCommand.usage,
	}),
	adapt({
		path: ["commands"],
		aliases: commandsCommand.names,
		legacy: "commands",
		parse: commandsCommand.parse,
		run: (ctx, parsed) => commandsCommand.run(ctx, parsed as never),
		usage: commandsCommand.usage,
	}),
	adapt({
		path: ["init"],
		legacy: "init",
		parse: initCommand.parse,
		run: (ctx, parsed) => initCommand.run(ctx, parsed as never),
		usage: initCommand.usage,
		sessionTitle: (parsed) => initCommand.sessionTitle(parsed as never),
	}),
	adapt({
		path: ["generate"],
		legacy: "generate",
		parse: generateCommand.parse,
		run: (ctx, parsed) => generateCommand.run(ctx, parsed as never),
		usage: generateCommand.usage,
		sessionTitle: (parsed) => generateCommand.sessionTitle(parsed as never),
	}),
	...schemaCommands,
	...policyCommands,
	...migrateCommands,
	...authCommands,
	adapt({
		path: ["env"],
		aliasPaths: [
			["env", "check"],
			["env", "validate"],
		],
		legacy: "env",
		parse: envCommand.parse,
		run: (ctx, parsed) => envCommand.run(ctx, parsed as never),
		usage: envCommand.usage,
	}),
	adapt({
		path: ["validate"],
		aliasPaths: [["validate", "local"]],
		legacy: "validate",
		parse: validateCommand.parse,
		run: (ctx, parsed) => validateCommand.run(ctx, parsed as never),
		usage: validateCommand.usage,
	}),
	adapt({
		path: ["doctor"],
		legacy: "doctor",
		parse: doctorCommand.parse,
		run: (ctx, parsed) => doctorCommand.run(ctx, parsed as never),
		usage: doctorCommand.usage,
	}),
	doctorBundleCommand,
	adapt({
		path: ["api-key"],
		aliases: ["key"],
		legacy: ["api-key-generate", "api-key-list", "api-key-create"],
		parse: apiKeyCommand.parse,
		run: (ctx, parsed) => apiKeyCommand.run(ctx, parsed as never),
		usage: apiKeyCommand.usage,
		sessionTitle: (parsed) => apiKeyCommand.sessionTitle(parsed as never),
	}),
	adapt({
		path: ["rights"],
		legacy: ["rights-list", "rights-catalog", "rights-create"],
		parse: rightsCommand.parse,
		run: (ctx, parsed) => rightsCommand.run(ctx, parsed as never),
		usage: rightsCommand.usage,
		sessionTitle: (parsed) => rightsCommand.sessionTitle(parsed as never),
	}),
];

export const CLI_COMMAND_REGISTRY = new CommandRegistry(
	CLI_REGISTERED_COMMANDS,
);
