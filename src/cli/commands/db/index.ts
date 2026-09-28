import { resolve } from "node:path";
import { findGeneratorConfigPath } from "../../../generator/config.ts";
import {
  LocalPostgresRuntime,
  type LocalPostgresRuntimeOptions,
} from "../../../local/runtime.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { createCliUi } from "../../ui/index.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { loadStaticCliProject } from "../../project/load-project.ts";
import type { CliCommand, DbCommand } from "../../types.ts";

export const names: readonly string[] = ["db"];

export function parse(rest: string[]): CliCommand {
  const action = rest[0];
  if (action === undefined || action === "--help" || action === "-h") {
    return { command: "help", topic: "db" };
  }
  if (
    !["start", "stop", "status", "restart", "reset", "logs"].includes(action)
  ) {
    throw new Error(`Unknown db action "${action}".`);
  }
  let configPath: string | undefined;
  let force = false;
  let json = false;
  let writeEnv = false;
  let yes = false;
  for (let index = 1; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--config") {
      const value = rest[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --config option.");
      }
      configPath = value;
      index += 1;
    } else if (token === "--force") {
      force = true;
    } else if (token === "--json") {
      json = true;
    } else if (token === "--write-env") {
      writeEnv = true;
    } else if (token === "--yes") {
      yes = true;
    } else {
      throw unknownOptionError(token, "db");
    }
  }
  return {
    action: action as DbCommand["action"],
    command: "db",
    configPath,
    force,
    json,
    writeEnv,
    yes,
  };
}

export function usage(): string {
  return formatCatalogTopicUsage("db");
}

export async function run(
  ctx: CommandContext,
  parsed: DbCommand
): Promise<void> {
  if (parsed.action === "reset" && !parsed.yes) {
    throw new Error("db reset is destructive; pass --yes to continue.");
  }
  const projectRoot = ctx.runtime.cwd ?? ctx.cwd;
  const needsConfig =
    parsed.action === "start" ||
    parsed.action === "restart" ||
    parsed.action === "status";
  const loaded = needsConfig
    ? await loadStaticCliProject({
        configPath: parsed.configPath,
        cwd: projectRoot,
      })
    : undefined;
  const cleanupConfigPath = parsed.configPath
    ? resolve(projectRoot, parsed.configPath)
    : (findGeneratorConfigPath(projectRoot) ??
      resolve(projectRoot, "athena.config.ts"));
  const createLocalRuntime =
    ctx.runtime.createLocalRuntime ??
    ((options: LocalPostgresRuntimeOptions) => new LocalPostgresRuntime(options));
  const runtime = createLocalRuntime({
    config: loaded?.athena.config.local,
    configPath: loaded?.athena.configPath ?? cleanupConfigPath,
    ...(loaded
      ? {
          migrate: async (databaseUrl: string) => {
            const migrateRunner =
              ctx.runtime.runMigrations ??
              (await import("../../../migrations/runner.ts")).runMigrations;
            await migrateRunner({
              config: loaded.athena.config,
              configPath: loaded.athena.configPath,
              cwd: loaded.cwd,
              databaseUrl,
              mode: "apply",
              ...(parsed.json
                ? {
                    json: false,
                    log: () => {},
                    ui: createCliUi({ plain: true, write: () => {} }),
                  }
                : {}),
            });
          },
        }
      : {}),
    projectRoot,
  });
  if (parsed.action === "start") {
    const state = await runtime.start({
      forceEnv: parsed.force,
      writeEnv: parsed.writeEnv,
    });
    ctx.log(
      parsed.json
        ? JSON.stringify({
            database: state.database,
            port: state.port,
            status: "healthy",
          })
        : `Local PostgreSQL is healthy on ${state.port}.`
    );
    return;
  }
  if (parsed.action === "stop") {
    await runtime.stop();
    ctx.log(
      parsed.json
        ? JSON.stringify({ status: "stopped" })
        : "Local PostgreSQL stopped."
    );
    return;
  }
  if (parsed.action === "restart") {
    const state = await runtime.restart({
      forceEnv: parsed.force,
      writeEnv: parsed.writeEnv,
    });
    ctx.log(
      parsed.json
        ? JSON.stringify({
            database: state.database,
            port: state.port,
            status: "healthy",
          })
        : `Local PostgreSQL is healthy on ${state.port}.`
    );
    return;
  }
  if (parsed.action === "reset") {
    await runtime.reset();
    ctx.log(
      parsed.json
        ? JSON.stringify({ status: "reset" })
        : "Local PostgreSQL reset."
    );
    return;
  }
  if (parsed.action === "logs") {
    ctx.log(formatDbLogsOutput(await runtime.logs(), parsed.json));
    return;
  }
  const report = await runtime.status();
  ctx.log(
    parsed.json
      ? JSON.stringify(report)
      : `${report.status}${report.reason ? `: ${report.reason}` : ""}`
  );
}

export function formatDbLogsOutput(logs: string, json: boolean): string {
  return json ? JSON.stringify({ logs }) : logs;
}
