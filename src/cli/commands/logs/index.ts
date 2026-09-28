import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { AthenaCliError } from "../../errors.ts";
import { CliExitCode } from "../../exit-code.ts";
import {
  exportCliLog,
  findCliLog,
  listCliLogs,
  pruneCliLogs,
  readCliLogFile,
  resolveAthenaHomePaths,
  resolveLatestCompletedLog,
} from "../../logging/index.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import {
  encodeCliJsonSuccess,
  stringifyCliJson,
} from "../../platform/index.ts";
import type { CliCommand, LogsCommand } from "../../types.ts";

export { logsCatalog, logsCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["logs"];

export function usage(): string {
  return formatCatalogTopicUsage("logs");
}

function integerOption(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export function parse(rest: string[]): CliCommand {
  let action: LogsCommand["action"] = "list";
  let errors = false;
  let json = false;
  let limit = 20;
  let invocationId: string | undefined;
  let olderThan: string | undefined;
  let outPath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "logs" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--errors") {
      errors = true;
      continue;
    }
    if (token === "--limit") {
      const next = rest[index + 1];
      if (!next) {
        throw new Error("Missing value for --limit option.");
      }
      limit = integerOption(next, "--limit");
      index += 1;
      continue;
    }
    if (token === "--older-than") {
      const next = rest[index + 1];
      if (!next) {
        throw new Error("Missing value for --older-than option.");
      }
      olderThan = next;
      index += 1;
      continue;
    }
    if (token === "--out") {
      const next = rest[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error("Missing value for --out option.");
      }
      outPath = next;
      index += 1;
      continue;
    }
    if (
      token === "path" ||
      token === "list" ||
      token === "latest" ||
      token === "show" ||
      token === "export" ||
      token === "prune"
    ) {
      action = token;
      if (token === "show" || token === "export") {
        const next = rest[index + 1];
        if (!next || next.startsWith("-")) {
          throw new Error(`Missing invocation id for logs ${token}.`);
        }
        invocationId = next;
        index += 1;
      }
      continue;
    }
    throw unknownOptionError(token ?? "", "logs");
  }

  return {
    action,
    command: "logs",
    errors,
    invocationId,
    json,
    limit,
    olderThan,
    outPath,
  };
}

function wantsJson(ctx: CommandContext, parsed: LogsCommand): boolean {
  return parsed.json || ctx.output === "json" || ctx.output === "ndjson";
}

function missingLogError(invocationId: string): AthenaCliError {
  return new AthenaCliError({
    code: "CLI_LOG_NOT_FOUND",
    exitCode: CliExitCode.Validation,
    message: `No CLI log found for invocation "${invocationId}".`,
  });
}

function emit(
  ctx: CommandContext,
  parsed: LogsCommand,
  data: unknown,
  text: string
): void {
  if (wantsJson(ctx, parsed)) {
    ctx.log(stringifyCliJson(encodeCliJsonSuccess("logs", data)));
    return;
  }
  ctx.log(text);
}

export async function run(
  ctx: CommandContext,
  parsed: LogsCommand
): Promise<void> {
  const env = ctx.runtime.env;
  if (parsed.action === "path") {
    const paths = resolveAthenaHomePaths(env, ctx.cwd);
    const { home, cliLogsRoot } = paths;
    emit(
      ctx,
      parsed,
      { cliLogsRoot, home },
      `Athena home\n  ${home}\nCLI logs\n  ${cliLogsRoot}`
    );
    return;
  }

  if (parsed.action === "list") {
    const summaries = await ctx.trace.span(
      "logs.list",
      { errorsOnly: parsed.errors, limit: parsed.limit },
      () =>
        listCliLogs({
          cwd: ctx.cwd,
          env,
          errorsOnly: parsed.errors,
          limit: parsed.limit,
        })
    );
    emit(
      ctx,
      parsed,
      { logs: summaries },
      summaries.length === 0
        ? "No CLI logs found."
        : summaries
            .map(
              (summary) =>
                `${summary.invocationId}  ${summary.outcome ?? "incomplete"}  ${summary.bytes} bytes  ${summary.path}`
            )
            .join("\n")
    );
    return;
  }

  if (parsed.action === "latest") {
    const path = await resolveLatestCompletedLog({
      cwd: ctx.cwd,
      env,
      excludeInvocationIds: [ctx.logger.invocationId],
      excludePaths: ctx.logger.logPath ? [ctx.logger.logPath] : [],
    });
    if (!path) {
      emit(ctx, parsed, { path: undefined }, "No latest CLI log found.");
      return;
    }
    const result = await readCliLogFile(path);
    const summary = (
      await listCliLogs({ cwd: ctx.cwd, env, limit: 1000 })
    ).find((item) => item.path === path);
    emit(
      ctx,
      parsed,
      { events: result.events, path, summary },
      `${path}\n${result.events.at(-1)?.outcome ?? "incomplete"}`
    );
    return;
  }

  if (parsed.action === "show" || parsed.action === "export") {
    const invocationId = parsed.invocationId;
    if (!invocationId) {
      throw new Error(`Missing invocation id for logs ${parsed.action}.`);
    }
    const source = await findCliLog(invocationId, { cwd: ctx.cwd, env });
    if (!source) {
      throw missingLogError(invocationId);
    }
    if (parsed.action === "show") {
      const result = await readCliLogFile(source);
      emit(
        ctx,
        parsed,
        { events: result.events, malformed: result.malformed, path: source },
        result.events
          .map(
            (event) =>
              `${event.timestamp}  ${event.kind}  ${event.message ?? event.outcome ?? ""}`
          )
          .join("\n")
      );
      return;
    }
    const destination = resolve(
      ctx.cwd,
      parsed.outPath ?? `athena-support-${invocationId}.jsonl`
    );
    await mkdir(dirname(destination), { recursive: true });
    const result = await exportCliLog(source, destination);
    emit(
      ctx,
      parsed,
      { destination, source, ...result },
      `Exported support-safe CLI log\n  ${destination}`
    );
    return;
  }

  const result = await pruneCliLogs({
    activePath: ctx.logger.logPath,
    cwd: ctx.cwd,
    env,
    olderThan: parsed.olderThan,
  });
  emit(
    ctx,
    parsed,
    result,
    `Pruned ${result.count} CLI logs and ${result.bytes} bytes.`
  );
}
