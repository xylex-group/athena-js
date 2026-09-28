import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { CliExitCode, setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, ValidateCommand } from "../../types.ts";
import { frameBlock } from "../../ui/rail.ts";
import {
  formatValidationReport,
  validateLocalRuntime,
} from "./validate-local.ts";

export { validateCatalog, validateCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["validate"];

export function parse(rest: string[]): CliCommand {
  let configPath: string | undefined;
  let json = false;
  let plain = false;
  let strict = false;
  let index = 0;
  if (rest[0] === "local") {
    index = 1;
  }
  while (index < rest.length) {
    const token = rest[index];
    index += 1;
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "validate" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--plain") {
      plain = true;
      continue;
    }
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--config") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --config option.");
      }
      configPath = nextValue;
      index += 1;
      continue;
    }
    throw unknownOptionError(token, "validate");
  }
  return { command: "validate", configPath, json, plain, strict };
}

export function usage(): string {
  return formatCatalogTopicUsage("validate");
}

export function sessionTitle(_parsed: ValidateCommand): undefined {}

export async function run(
  ctx: CommandContext,
  parsed: ValidateCommand
): Promise<void> {
  const { capabilities, errorLog, log, logRaw, presentation, runtime } = ctx;
  try {
    const runValidate = runtime.validateLocal ?? validateLocalRuntime;
    const report = await runValidate({
      configPath: parsed.configPath,
      cwd: runtime.cwd,
      json: parsed.json,
      plain: parsed.plain || presentation.noColor === true,
      strict: parsed.strict,
    });
    if (parsed.json) {
      log(JSON.stringify(report, null, 2));
    } else {
      logRaw(
        frameBlock(formatValidationReport(report, capabilities), capabilities)
      );
    }
    if (!report.ok) {
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
