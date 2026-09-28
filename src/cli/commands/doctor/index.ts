import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { CliExitCode, setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, DoctorCommand } from "../../types.ts";
import { frameBlock } from "../../ui/rail.ts";
import { formatDoctorReport, runCliDoctor } from "./doctor.ts";

export { doctorCatalog, doctorCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["doctor"];

export function parse(rest: string[]): CliCommand {
  let configPath: string | undefined;
  let json = false;
  let plain = false;
  let skipRuntime = false;
  let strict = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "doctor" };
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
    if (token === "--skip-runtime") {
      skipRuntime = true;
      continue;
    }
    if (token === "--config") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --config option.");
      }
      configPath = nextValue;
      index += 1;
      continue;
    }
    throw unknownOptionError(token, "doctor");
  }
  return {
    command: "doctor",
    configPath,
    json,
    plain,
    skipRuntime,
    strict,
  };
}

export function usage(): string {
  return formatCatalogTopicUsage("doctor");
}

export function sessionTitle(): undefined {}

export async function run(
  ctx: CommandContext,
  parsed: DoctorCommand
): Promise<void> {
  const { capabilities, errorLog, log, logRaw, presentation, runtime } = ctx;
  try {
    const executeDoctor = runtime.runCliDoctor ?? runCliDoctor;
    const report = await ctx.trace.span(
      "doctor.inspect",
      {
        configPath: parsed.configPath,
        skipRuntime: parsed.skipRuntime,
        strict: parsed.strict,
      },
      () =>
        executeDoctor({
          configPath: parsed.configPath,
          cwd: runtime.cwd,
          json: parsed.json,
          plain: parsed.plain || presentation.noColor === true,
          skipRuntime: parsed.skipRuntime,
          strict: parsed.strict,
          validateLocal: runtime.validateLocal,
        })
    );
    if (parsed.json) {
      log(JSON.stringify(report, null, 2));
    } else {
      logRaw(
        frameBlock(formatDoctorReport(report, capabilities), capabilities)
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
