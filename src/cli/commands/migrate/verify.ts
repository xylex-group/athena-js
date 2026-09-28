import {
  formatMigrationVerifyText,
  runMigrationVerify as runMigrationVerifyLive,
} from "../../../migrations/verify.ts";
import type { CommandContext } from "../../command-context.ts";
import { CliExitCode, setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import {
  encodeCliJsonSuccess,
  exitCodeForError,
  stringifyCliJson,
} from "../../platform/index.ts";
import type { MigrateCommand } from "../../types.ts";
import { defineMigrateCommand } from "./define.ts";

export async function runMigrateVerify(
  ctx: CommandContext,
  parsed: MigrateCommand
): Promise<void> {
  const json = ctx.output === "json" || parsed.json === true;
  try {
    const runVerify = ctx.runtime.runMigrationVerify ?? runMigrationVerifyLive;
    const report = await runVerify({
      allowDirty: parsed.allowDirty,
      allowDirtyMigrations: parsed.allowDirty,
      configPath: parsed.configPath,
      cwd: ctx.cwd,
      json,
      plain: parsed.plain,
      strict: parsed.strict,
    });
    if (json) {
      ctx.log(stringifyCliJson(encodeCliJsonSuccess("migrate.verify", report)));
    } else {
      ctx.logRaw(formatMigrationVerifyText(report));
    }
    if (!report.ok) {
      setCliExitCode(CliExitCode.Conflict);
    }
  } catch (error) {
    ctx.reportError(error, {
      commandId: parsed.command,
      phase: "command",
    });
    logCliError(formatGeneratorError(error), ctx.errorLog, ctx.capabilities);
    setCliExitCode(exitCodeForError(error));
  }
}

export const migrateVerifyCommand = defineMigrateCommand({
  mode: "verify",
  path: ["migrate", "verify"],
});
