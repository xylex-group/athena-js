import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { CliExitCode, setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, EnvCommand } from "../../types.ts";
import { frameBlock } from "../../ui/rail.ts";
import {
  type EnvCheckMode,
  formatEnvCheckReport,
  validateProjectEnv,
} from "./project-env.ts";

export { envCatalog, envCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["env"];

export function parse(rest: string[]): CliCommand {
  let mode: EnvCheckMode = "auto";
  let strict = false;
  let json = false;
  const files: string[] = [];

  let index = 0;
  if (rest[0] === "check" || rest[0] === "validate") {
    index = 1;
  } else if (rest[0] === "help") {
    return { command: "help", topic: "env" };
  }

  while (index < rest.length) {
    const token = rest[index];
    index += 1;
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "env" };
    }
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--mode") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error(
          "Missing value for --mode option. Expected auto, direct, or gateway."
        );
      }
      if (
        nextValue !== "auto" &&
        nextValue !== "direct" &&
        nextValue !== "gateway"
      ) {
        throw new Error(
          `Invalid --mode value "${nextValue}". Expected auto, direct, or gateway.`
        );
      }
      mode = nextValue;
      index += 1;
      continue;
    }
    if (token === "--file" || token === "-f") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --file option.");
      }
      files.push(nextValue);
      index += 1;
      continue;
    }
    throw unknownOptionError(token, "env");
  }

  return {
    command: "env",
    files,
    json,
    mode,
    strict,
  };
}

export function usage(): string {
  return formatCatalogTopicUsage("env");
}

export function sessionTitle(_parsed: EnvCommand): undefined {}

export async function run(
  ctx: CommandContext,
  parsed: EnvCommand
): Promise<void> {
  const { capabilities, errorLog, log, logRaw, runtime } = ctx;
  try {
    const result = validateProjectEnv({
      cwd: runtime.cwd,
      files: parsed.files.length > 0 ? parsed.files : undefined,
      mode: parsed.mode,
      strict: parsed.strict,
    });
    if (parsed.json) {
      log(JSON.stringify(result, null, 2));
    } else {
      logRaw(
        frameBlock(formatEnvCheckReport(result, capabilities), capabilities)
      );
    }
    if (result.errorCount > 0) {
      setCliExitCode(CliExitCode.Validation);
    }
  } catch (error) {
    ctx.reportError(error, {
      commandId: parsed.command,
      phase: "command",
    });
    logCliError(formatGeneratorError(error), errorLog, capabilities);
    setCliExitCode(exitCodeForError(error));
  }
}
