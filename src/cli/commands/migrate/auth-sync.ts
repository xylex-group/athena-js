import {
  ensureAthenaProjectLayout,
  inspectManagedAuthMigrations,
  materializeManagedAuthMigrations,
} from "../../../migrations/managed-auth.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { defineCommand } from "../../platform/define-command.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, MigrateAuthSyncCommand } from "../../types.ts";

export function parseMigrateAuthSyncFlags(rest: readonly string[]): CliCommand {
  let configPath: string | undefined;
  let dryRun = false;
  let json = false;
  let plain = false;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "migrate" };
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--plain" || token === "--no-color") {
      plain = true;
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
    if (token === "sync" || token === "materialize") {
      continue;
    }
    throw unknownOptionError(token ?? "", "migrate");
  }

  return {
    command: "migrate-auth-sync",
    configPath,
    dryRun,
    json,
    plain,
  };
}

export async function runMigrateAuthSync(
  ctx: CommandContext,
  parsed: MigrateAuthSyncCommand
): Promise<void> {
  const cwd = process.cwd();
  try {
    await ensureAthenaProjectLayout({ cwd, dryRun: parsed.dryRun });
    const result = await materializeManagedAuthMigrations({
      cwd,
      dryRun: parsed.dryRun,
      overwrite: true,
    });
    const inspection = parsed.dryRun
      ? await inspectManagedAuthMigrations({ cwd })
      : undefined;
    if (parsed.json) {
      ctx.log(
        JSON.stringify(
          {
            command: "migrate-auth-sync",
            directory: result.directory,
            drifted: inspection?.drifted ?? false,
            dryRun: parsed.dryRun,
            restored: result.restored,
            unchanged: result.unchanged,
            unexpected: result.unexpected,
            written: result.written,
          },
          null,
          2
        )
      );
      return;
    }
    const prefix = parsed.dryRun ? "[dry-run] " : "";
    ctx.log(
      `${prefix}Managed Embedded Auth migrations → athena/managed/auth/migrations`
    );
    ctx.log(
      `${prefix}written ${result.written.length} · restored ${result.restored.length} · unchanged ${result.unchanged.length}`
    );
    if (result.unexpected.length > 0) {
      ctx.log(
        `${prefix}unexpected local files (left in place): ${result.unexpected.join(", ")}`
      );
    }
    ctx.log(
      `${prefix}These files are a read-only view. Runtime apply uses package-owned SQL.`
    );
  } catch (error) {
    ctx.reportError(error, {
      commandId: parsed.command,
      phase: "command",
    });
    logCliError(
      formatGeneratorError(error, parsed.configPath),
      ctx.errorLog,
      ctx.capabilities
    );
    setCliExitCode(exitCodeForError(error));
  }
}

export const migrateAuthSyncCommand = defineCommand({
  aliasPaths: [
    ["migrate", "auth", "materialize"],
    ["migrate", "auth"],
  ],
  legacy: "migrate-auth-sync",
  parse: parseMigrateAuthSyncFlags,
  path: ["migrate", "auth", "sync"],
  run: (ctx, parsed) =>
    runMigrateAuthSync(ctx, parsed as MigrateAuthSyncCommand),
  usage: () => formatCatalogTopicUsage("migrate"),
});
