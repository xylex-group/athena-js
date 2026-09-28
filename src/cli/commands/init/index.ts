import { ensureGeneratorConfigFile } from "../../../generator/config-file.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { isDebugEnabled } from "../../debug.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, InitCommand } from "../../types.ts";

export { initCatalog, initCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["init"];

export function parse(rest: string[]): CliCommand {
  let configPath: string | undefined;
  let dryRun = false;
  let force = false;
  let mode: InitCommand["mode"] = "auto";
  let discoverSchemas = true;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "init" };
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--force") {
      force = true;
      continue;
    }

    if (token === "--no-discover-schemas") {
      discoverSchemas = false;
      continue;
    }

    if (token === "--mode") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error(
          "Missing value for --mode option. Expected direct or gateway."
        );
      }
      if (
        nextValue !== "direct" &&
        nextValue !== "gateway" &&
        nextValue !== "auto"
      ) {
        throw new Error(
          `Invalid --mode value "${nextValue}". Expected direct, gateway, or auto.`
        );
      }
      mode = nextValue;
      index += 1;
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

    throw unknownOptionError(token, "init");
  }

  return {
    command: "init",
    configPath,
    discoverSchemas,
    dryRun,
    force,
    mode,
  };
}

export function usage(): string {
  return formatCatalogTopicUsage("init");
}

export function sessionTitle(parsed: InitCommand): string {
  return parsed.dryRun ? "athena-js init · dry-run" : "athena-js init";
}

export async function run(
  ctx: CommandContext,
  parsed: InitCommand
): Promise<void> {
  const { capabilities, errorLog, log, runtime } = ctx;
  const ensureConfig = runtime.ensureConfig ?? ensureGeneratorConfigFile;
  try {
    if (isDebugEnabled()) {
      errorLog(
        `[athena-js] init starting (dryRun=${parsed.dryRun} force=${parsed.force} mode=${parsed.mode}${parsed.configPath ? ` config=${parsed.configPath}` : ""})`
      );
    }
    const result = await ctx.trace.span(
      "config.ensure",
      {
        configPath: parsed.configPath,
        discoverSchemas: parsed.discoverSchemas,
        dryRun: parsed.dryRun,
        mode: parsed.mode,
      },
      () =>
        ensureConfig({
          configPath: parsed.configPath,
          discoverSchemas: parsed.discoverSchemas,
          dryRun: parsed.dryRun,
          force: parsed.force,
          mode: parsed.mode,
        })
    );
    const prefix = parsed.dryRun ? "[dry-run] " : "";
    const provenance = result.schemaProvenance ?? "configured";
    log(
      `${prefix}Config ${result.action}: ${result.path} (mode=${result.mode} schemas=${result.schemas.join(",") || "-"} provenance=${provenance})`
    );
    if (result.reason) {
      log(`${prefix}reason: ${result.reason}`);
    }
    for (const change of result.changes) {
      if (
        provenance === "fallback" &&
        !change.startsWith("created-") &&
        !change.startsWith("force-")
      ) {
        log(`${prefix}${change}`);
      } else {
        log(`${prefix}- ${change}`);
      }
    }
    if (parsed.dryRun && result.content && result.action !== "unchanged") {
      log(`${prefix}--- planned content ---`);
      log(result.content);
    }
  } catch (error) {
    ctx.reportError(error, {
      commandId: parsed.command,
      phase: "command",
    });
    const formatted = formatGeneratorError(error, parsed.configPath);
    logCliError(formatted, errorLog, capabilities);
    setCliExitCode(exitCodeForError(error));
  }
}
