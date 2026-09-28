import { argvWantsHelp } from "../argv.ts";
import {
  type CatalogHelpTopic,
  catalogHelpTopic,
} from "../commands-catalog.ts";
import { sanitizeCliArgv } from "../logging/redact.ts";
import { unknownCommandError } from "../parse-helpers.ts";
import type { CliCommand } from "../types.ts";
import type { RegisteredCommand } from "./define-command.ts";
import type { CommandRegistry } from "./registry.ts";

export interface ResolvedCliInput<T = CliCommand> {
  registration: RegisteredCommand;
  sanitizedArgv: string[];
  value: T;
}

function helpTopicFromPath(path: readonly string[]): CatalogHelpTopic {
  const head = path[0];
  if (head == null || head === "") {
    return "root";
  }
  return catalogHelpTopic(head, path.slice(1)) ?? "root";
}

function helpCommand(topic: CatalogHelpTopic): CliCommand {
  return { command: "help", topic };
}

export function parseRegisteredCommandResolved(
  registry: CommandRegistry,
  argv: readonly string[],
  sanitizedArgv: string[] = sanitizeCliArgv(argv)
): ResolvedCliInput {
  const helpRegistration = registry.findByPath(["help"]);
  if (!helpRegistration) {
    throw new Error('The command registry must define a "help" command.');
  }
  if (argv.length === 0) {
    return {
      registration: helpRegistration,
      sanitizedArgv,
      value: helpCommand("root"),
    };
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    const matched = argv[1] ? registry.match(argv.slice(1)) : undefined;
    if (matched) {
      return {
        registration: helpRegistration,
        sanitizedArgv,
        value: helpCommand(helpTopicFromPath(matched.command.path)),
      };
    }
    return {
      registration: helpRegistration,
      sanitizedArgv,
      value: helpCommand("root"),
    };
  }

  const matched = registry.match(argv);
  if (!matched) {
    if (argvWantsHelp(argv)) {
      return {
        registration: helpRegistration,
        sanitizedArgv,
        value: helpCommand(helpTopicFromPath(argv)),
      };
    }
    throw unknownCommandError(argv[0] ?? "");
  }

  if (argvWantsHelp(argv) && matched.command.path[0] !== "help") {
    return {
      registration: helpRegistration,
      sanitizedArgv,
      value: helpCommand(helpTopicFromPath(matched.command.path)),
    };
  }

  const value = matched.command.parse(matched.rest);
  if (value.command === "help" && matched.command.path[0] !== "help") {
    return {
      registration: helpRegistration,
      sanitizedArgv,
      value,
    };
  }

  return {
    registration: matched.command,
    sanitizedArgv,
    value,
  };
}

export function parseRegisteredCommand(
  registry: CommandRegistry,
  argv: readonly string[]
): CliCommand {
  return parseRegisteredCommandResolved(registry, argv).value;
}
