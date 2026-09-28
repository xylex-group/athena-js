import type { CommandContext } from "../command-context.ts";
import type { CliCommand } from "../types.ts";
import type { CommandResult } from "./result.ts";

export interface RegisteredCommand {
  /**
   * Alternate first-token spellings (`key` for `api-key`, `-v` for version).
   * Full-path aliases use {@link aliasPaths}.
   */
  aliases?: readonly string[];
  /** Extra full paths (`["env", "validate"]` for `env check`). */
  aliasPaths?: readonly (readonly string[])[];
  /** Dotted id used in the JSON protocol (`migrate.plan`). */
  id: string;
  legacy: CliCommand["command"] | readonly CliCommand["command"][];
  parse: (rest: string[]) => CliCommand;
  /** Canonical invocation path (`["migrate", "plan"]`). */
  path: readonly string[];
  run: (
    ctx: CommandContext,
    parsed: CliCommand
  ) => Promise<void | CommandResult<unknown>>;
  /** Credential-bearing flags whose following values must be sanitized. */
  secretFlags?: readonly string[];
  sessionTitle?: (parsed: CliCommand) => string | undefined;
  usage: () => string;
}

export interface DefineCommandOptions {
  aliases?: readonly string[];
  aliasPaths?: readonly (readonly string[])[];
  id?: string;
  legacy: RegisteredCommand["legacy"];
  parse: RegisteredCommand["parse"];
  path: readonly string[];
  run: RegisteredCommand["run"];
  secretFlags?: readonly string[];
  sessionTitle?: RegisteredCommand["sessionTitle"];
  usage: RegisteredCommand["usage"];
}

export function commandIdFromPath(path: readonly string[]): string {
  return path.join(".");
}

export function defineCommand(
  options: DefineCommandOptions
): RegisteredCommand {
  return {
    aliases: options.aliases,
    aliasPaths: options.aliasPaths,
    id: options.id ?? commandIdFromPath(options.path),
    legacy: options.legacy,
    parse: options.parse,
    path: options.path,
    run: options.run,
    secretFlags: options.secretFlags,
    sessionTitle: options.sessionTitle,
    usage: options.usage,
  };
}

export function legacyIds(command: RegisteredCommand): CliCommand["command"][] {
  const { legacy } = command;
  if (typeof legacy === "string") {
    return [legacy];
  }
  return [...legacy];
}
