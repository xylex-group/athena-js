import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PACKAGE_VERSION } from "../../../sdk-version.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import {
  findCliLog,
  readCliLogFile,
  resolveLatestCompletedLog,
} from "../../logging/index.ts";
import { redactValue, serializeCliLogEvent } from "../../logging/redact.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { defineCommand } from "../../platform/define-command.ts";
import {
  encodeCliJsonSuccess,
  exitCodeForError,
  stringifyCliJson,
} from "../../platform/index.ts";
import type { CliCommand, DoctorBundleCommand } from "../../types.ts";
import { runCliDoctor } from "./doctor.ts";

export function parseDoctorBundle(rest: readonly string[]): CliCommand {
  let json = false;
  let outDir: string | undefined;
  let includeLatestLog = false;
  let invocation: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "doctor" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--include-latest-log") {
      includeLatestLog = true;
      continue;
    }
    if (token === "--invocation") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --invocation option.");
      }
      invocation = nextValue;
      index += 1;
      continue;
    }
    if (token === "--out") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --out option.");
      }
      outDir = nextValue;
      index += 1;
      continue;
    }
    throw unknownOptionError(token ?? "", "doctor bundle");
  }
  return {
    command: "doctor-bundle",
    includeLatestLog,
    invocation,
    json,
    outDir,
  };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
}

async function writeSecureAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function fileContent(body: unknown): string {
  return typeof body === "string"
    ? body.endsWith("\n")
      ? body
      : `${body}\n`
    : `${JSON.stringify(body, null, 2)}\n`;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeHomePrefix(value: string): string {
  const home = homedir().replace(/[\\/]+$/, "");
  if (value === home) {
    return "~";
  }
  if (value.startsWith(`${home}\\`) || value.startsWith(`${home}/`)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}

function normalizePortablePaths(value: unknown, depth = 0): unknown {
  if (depth >= 6 || value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return normalizeHomePrefix(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePortablePaths(item, depth + 1));
  }
  if (typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      normalizePortablePaths(nested, depth + 1),
    ])
  );
}

export async function runDoctorBundle(
  ctx: CommandContext,
  parsed: DoctorBundleCommand
): Promise<void> {
  try {
    const doctor =
      ctx.runtime.runCliDoctor ??
      ((options: Parameters<typeof runCliDoctor>[0]) => runCliDoctor(options));
    const report = await doctor({
      cwd: ctx.cwd,
      json: true,
      plain: true,
      skipRuntime: false,
      strict: false,
    });
    const files: Record<string, unknown> = {
      "cli-version.txt": PACKAGE_VERSION,
      "doctor.json": report,
      "environment-summary.json": {
        cwd: ctx.cwd,
        node: process.version,
        platform: process.platform,
      },
    };
    if (ctx.runtime.inspectAuthStatus) {
      files["auth-status.json"] = await ctx.runtime.inspectAuthStatus({
        cwd: ctx.cwd,
      });
    }
    if (ctx.runtime.runMigrationVerify) {
      files["migration-status.json"] = await ctx.runtime.runMigrationVerify({
        cwd: ctx.cwd,
      });
    }
    let logManifest: Record<string, unknown> | undefined;
    const logPath = parsed.invocation
      ? await findCliLog(parsed.invocation, {
          cwd: ctx.cwd,
          env: ctx.runtime.env,
        })
      : parsed.includeLatestLog
        ? await resolveLatestCompletedLog({
            cwd: ctx.cwd,
            env: ctx.runtime.env,
            excludeInvocationIds: [ctx.logger.invocationId],
            excludePaths: ctx.logger.logPath ? [ctx.logger.logPath] : [],
          })
        : undefined;
    if (logPath) {
      const log = await readCliLogFile(logPath);
      const maxBytes = 1024 * 1024;
      const lines: string[] = [];
      let logBytes = 0;
      let truncated = false;
      for (const event of log.events) {
        const line = serializeCliLogEvent(event);
        const lineBytes =
          Buffer.byteLength(line, "utf8") + (lines.length > 0 ? 1 : 0);
        if (logBytes + lineBytes > maxBytes) {
          truncated = true;
          break;
        }
        lines.push(line);
        logBytes += lineBytes;
      }
      const bounded = lines.join("\n");
      files["cli-log.jsonl"] = bounded;
      const content = fileContent(bounded);
      logManifest = {
        bytes: Buffer.byteLength(content, "utf8"),
        capturedAt: new Date().toISOString(),
        malformed: log.malformed,
        schemaVersion: 1,
        sha256: sha256(content),
        source: logPath,
        truncated,
      };
    } else if (parsed.includeLatestLog || parsed.invocation) {
      ctx.logger.warn("Requested CLI log was not found.", {
        invocation: parsed.invocation,
      });
    }
    const sanitized = normalizePortablePaths(redactValue(files)) as Record<
      string,
      unknown
    >;
    const directory = parsed.outDir
      ? resolve(ctx.cwd, parsed.outDir)
      : join(ctx.cwd, `athena-diagnostics-${stamp()}`);
    await mkdir(directory, { mode: 0o700, recursive: true });
    for (const [name, body] of Object.entries(sanitized)) {
      await writeSecureAtomic(join(directory, name), fileContent(body));
    }
    const safeLogManifest = logManifest
      ? (normalizePortablePaths(redactValue(logManifest)) as Record<
          string,
          unknown
        >)
      : undefined;
    const bundle = {
      ...sanitized,
      ...(safeLogManifest
        ? {
            "cli-log.jsonl": {
              reference: "cli-log.jsonl",
              ...safeLogManifest,
            },
          }
        : {}),
    };
    await writeSecureAtomic(
      join(directory, "bundle.json"),
      `${JSON.stringify(bundle, null, 2)}\n`
    );
    if (logManifest) {
      await writeSecureAtomic(
        join(directory, "bundle-manifest.json"),
        `${JSON.stringify(redactValue(logManifest), null, 2)}\n`
      );
    }
    if (ctx.output === "json" || parsed.json) {
      ctx.log(
        stringifyCliJson(
          encodeCliJsonSuccess("doctor.bundle", {
            directory,
            files: Object.keys(sanitized),
          })
        )
      );
    } else {
      ctx.log(`Wrote diagnostic bundle\n  ${directory}\n`);
      ctx.log("Secrets (passwords, API keys, tokens) are redacted.");
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

export const doctorBundleCommand = defineCommand({
  legacy: "doctor-bundle",
  parse: (rest) => parseDoctorBundle(rest),
  path: ["doctor", "bundle"],
  run: (ctx, parsed) => runDoctorBundle(ctx, parsed as DoctorBundleCommand),
  usage: () => formatCatalogTopicUsage("doctor"),
});
