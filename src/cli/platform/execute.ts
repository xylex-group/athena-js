import type { CommandContext } from "../command-context.ts";
import { AthenaCliError, ensureCliErrorId } from "../errors.ts";
import { getCliExitCode } from "../exit-code.ts";
import type { CliCommand } from "../types.ts";
import { exitCodeForError } from "./map-exit.ts";
import type { ResolvedCliInput } from "./parse.ts";
import type { CommandRegistry } from "./registry.ts";
import type { CommandResult } from "./result.ts";

export async function dispatchRegistered(
  _registry: CommandRegistry,
  ctx: CommandContext,
  resolved: ResolvedCliInput
): Promise<void | CommandResult<unknown>> {
  const command = resolved.registration;
  const parsed = resolved.value as CliCommand;

  const startedAt = Date.now();
  ctx.logger.record({
    commandId: command.id,
    data: { parsed },
    kind: "command.start",
    level: "info",
  });

  try {
    const result = await ctx.trace.span(
      `command.${command.id}`,
      { commandId: command.id },
      async () => {
        const result = await command.run(ctx, parsed);
        if (result?.ok === false) {
          throw new AthenaCliError({
            code: result.code ?? "CLI_COMMAND_FAILED",
            exitCode: result.exitCode,
            message: result.message ?? `Command "${command.id}" failed.`,
            metadata:
              result.details === undefined
                ? undefined
                : { details: result.details },
          });
        }
        return result;
      }
    );
    const exitCode = result?.exitCode ?? getCliExitCode() ?? 0;
    const outcome = exitCode === 0 ? "success" : "failure";
    if (result?.warnings?.length) {
      ctx.logger.record({
        commandId: command.id,
        data: { warnings: result.warnings },
        kind: "diagnostic",
        level: "warn",
      });
    }
    ctx.logger.record({
      commandId: command.id,
      durationMs: Math.max(0, Date.now() - startedAt),
      exitCode,
      kind: "command.finish",
      level: outcome === "success" ? "info" : "error",
      outcome,
    });
    return result;
  } catch (error) {
    const errorId = ensureCliErrorId(error);
    ctx.logger.record({
      commandId: command.id,
      data: { errorId },
      durationMs: Math.max(0, Date.now() - startedAt),
      exitCode: exitCodeForError(error),
      kind: "command.finish",
      level: "error",
      outcome: "failure",
    });
    throw error;
  }
}

export function sessionTitleFor(
  registration: ResolvedCliInput["registration"],
  parsed: CliCommand
): string | undefined {
  return registration.sessionTitle?.(parsed);
}
