import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  type resolveAthenaCliLogPaths,
  resolveAthenaHomePaths,
} from "./paths.ts";
import { redactSecrets, serializeCliLogEvent } from "./redact.ts";
import type { CliLogEvent } from "./types.ts";

export interface CliLogSummary {
  bytes: number;
  commandId?: string;
  finishedAt?: string;
  invocationId: string;
  malformed: number;
  outcome?: "success" | "failure" | "cancelled";
  path: string;
  startedAt?: string;
}

export interface CliLogReadResult {
  events: CliLogEvent[];
  malformed: number;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    !(relativePath.startsWith("..") || isAbsolute(relativePath))
  );
}

async function isSafeLogFile(path: string, root: string): Promise<boolean> {
  if (!(isWithinRoot(path, root) && path.endsWith(".jsonl"))) {
    return false;
  }
  try {
    const details = await lstat(path);
    if (!details.isFile()) {
      return false;
    }
    const [rootPath, filePath] = await Promise.all([
      realpath(root),
      realpath(path),
    ]);
    return isWithinRoot(filePath, rootPath);
  } catch {
    return false;
  }
}

function validInvocationId(value: string): boolean {
  return /^[a-z0-9-]{1,96}$/i.test(value);
}

async function writeSecureAtomic(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}-${randomUUID()}.tmp`
  );
  await writeFile(temporary, body, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await rename(temporary, path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "EPERM")
    ) {
      await unlink(path).catch(() => undefined);
      await rename(temporary, path);
      return;
    }
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function repairLatestPointer(options: {
  env: Record<string, string | undefined>;
  cwd?: string;
  paths: ReturnType<typeof resolveAthenaHomePaths>;
}): Promise<void> {
  const pointerPath = join(options.paths.cliLogsRoot, "latest.json");
  try {
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as {
      path?: unknown;
    };
    if (
      typeof pointer.path === "string" &&
      (await isSafeLogFile(pointer.path, options.paths.cliLogsRoot))
    ) {
      const result = await readCliLogFile(pointer.path);
      const summary = summaryFromEvents(pointer.path, 0, result);
      if (summary.finishedAt !== undefined && summary.outcome !== undefined) {
        return;
      }
    }
  } catch {
    // Replace stale or malformed pointers from the surviving completed logs.
  }

  const summaries = (
    await listCliLogs({
      cwd: options.cwd,
      env: options.env,
      limit: 10_000,
    })
  )
    .filter(
      (summary) =>
        summary.finishedAt !== undefined && summary.outcome !== undefined
    )
    .sort((left, right) =>
      (right.finishedAt ?? right.startedAt ?? right.path).localeCompare(
        left.finishedAt ?? left.startedAt ?? left.path
      )
    );
  const latest = summaries[0];
  if (!latest) {
    await unlink(pointerPath).catch(() => undefined);
    return;
  }
  const events = await readCliLogFile(latest.path);
  const start = events.events.find(
    (event) => event.kind === "invocation.start"
  );
  await writeSecureAtomic(
    pointerPath,
    `${JSON.stringify(
      {
        invocationId: start?.invocationId ?? latest.invocationId,
        path: latest.path,
        schemaVersion: 1,
        startedAt: start?.timestamp ?? latest.startedAt,
        traceId: start?.traceId,
        updatedAt: new Date().toISOString(),
        writer: start?.writer ?? "canonical",
      },
      null,
      2
    )}\n`
  );
}

async function logFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let days: Dirent[] = [];
  try {
    days = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return files;
    }
    throw error;
  }
  for (const day of days) {
    if (!(day.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(day.name))) {
      continue;
    }
    const dayPath = join(root, day.name);
    for (const entry of await readdir(dayPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const file = join(dayPath, entry.name);
        if (isWithinRoot(file, root)) {
          files.push(file);
        }
      }
    }
  }
  return files;
}

export async function readCliLogFile(path: string): Promise<CliLogReadResult> {
  const body = await readFile(path, "utf8");
  const events: CliLogEvent[] = [];
  let malformed = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as CliLogEvent);
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

function summaryFromEvents(
  path: string,
  bytes: number,
  result: CliLogReadResult
): CliLogSummary {
  const start = result.events.find(
    (event) => event.kind === "invocation.start"
  );
  const finish = [...result.events]
    .reverse()
    .find((event) => event.kind === "invocation.finish");
  const invocationId =
    typeof start?.invocationId === "string"
      ? start.invocationId
      : (path
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/\.jsonl$/, "") ?? "unknown");
  return {
    bytes,
    commandId: finish?.commandId,
    finishedAt: finish?.timestamp,
    invocationId,
    malformed: result.malformed,
    outcome: finish?.outcome,
    path,
    startedAt: start?.timestamp,
  };
}

export async function listCliLogs(
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    root?: string;
    limit?: number;
    errorsOnly?: boolean;
  } = {}
): Promise<CliLogSummary[]> {
  const root =
    options.root ??
    resolveAthenaHomePaths(options.env, options.cwd).cliLogsRoot;
  const files = await logFiles(root);
  const summaries: CliLogSummary[] = [];
  for (const path of files) {
    try {
      const [result, details] = await Promise.all([
        readCliLogFile(path),
        stat(path),
      ]);
      const summary = summaryFromEvents(path, details.size, result);
      if (!options.errorsOnly || summary.outcome === "failure") {
        summaries.push(summary);
      }
    } catch {
      summaries.push({
        bytes: 0,
        invocationId:
          path
            .split(/[\\/]/)
            .at(-1)
            ?.replace(/\.jsonl$/, "") ?? "unknown",
        malformed: 1,
        path,
      });
    }
  }
  summaries.sort((left, right) => right.path.localeCompare(left.path));
  return summaries.slice(0, Math.max(1, Math.min(options.limit ?? 20, 10_000)));
}

export async function findCliLog(
  invocationId: string,
  options: { env?: Record<string, string | undefined>; cwd?: string } = {}
): Promise<string | undefined> {
  if (!validInvocationId(invocationId)) {
    return;
  }
  const root = resolveAthenaHomePaths(options.env, options.cwd).cliLogsRoot;
  for (const path of await logFiles(root)) {
    const name = path.split(/[\\/]/).at(-1) ?? "";
    if (name.endsWith(`-${invocationId}.jsonl`) && isWithinRoot(path, root)) {
      return path;
    }
  }
}

export async function latestCliLog(
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    root?: string;
    excludePaths?: readonly string[];
    excludeInvocationIds?: readonly string[];
  } = {}
): Promise<string | undefined> {
  return resolveLatestCompletedLog(options);
}

export async function resolveLatestCompletedLog(
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    root?: string;
    excludePaths?: readonly string[];
    excludeInvocationIds?: readonly string[];
  } = {}
): Promise<string | undefined> {
  const root =
    options.root ??
    resolveAthenaHomePaths(options.env, options.cwd).cliLogsRoot;
  const excludedPaths = new Set(
    (options.excludePaths ?? [])
      .filter((path) => path.length > 0)
      .map((path) => resolve(path))
  );
  const excludedInvocationIds = new Set(options.excludeInvocationIds ?? []);
  const isExcluded = (path: string, summary?: CliLogSummary): boolean =>
    excludedPaths.has(resolve(path)) ||
    (summary !== undefined && excludedInvocationIds.has(summary.invocationId));
  const isCompleted = (summary: CliLogSummary): boolean =>
    summary.finishedAt !== undefined && summary.outcome !== undefined;

  try {
    const pointer = JSON.parse(
      await readFile(join(root, "latest.json"), "utf8")
    ) as {
      path?: unknown;
    };
    if (
      typeof pointer.path === "string" &&
      (await isSafeLogFile(pointer.path, root)) &&
      !isExcluded(pointer.path)
    ) {
      const pointerResult = await readCliLogFile(pointer.path);
      const pointerSummary = summaryFromEvents(pointer.path, 0, pointerResult);
      if (
        !isExcluded(pointer.path, pointerSummary) &&
        isCompleted(pointerSummary)
      ) {
        return pointer.path;
      }
    }
  } catch {
    // Fall through to bounded metadata scanning when the pointer is stale.
  }

  const summaries = await listCliLogs({
    cwd: options.cwd,
    env: options.env,
    limit: 10_000,
    root,
  });
  return summaries
    .filter((summary) => !isExcluded(summary.path, summary))
    .filter(isCompleted)
    .sort((left, right) =>
      (right.finishedAt ?? right.startedAt ?? right.path).localeCompare(
        left.finishedAt ?? left.startedAt ?? left.path
      )
    )
    .at(0)?.path;
}

function parseDuration(
  value: string | undefined,
  fallbackDays: number
): number {
  if (!value) {
    return fallbackDays * 24 * 60 * 60 * 1000;
  }
  const match = /^(\d+(?:\.\d+)?)([smhdw])$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid --older-than duration "${value}".`);
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier =
    unit === "s"
      ? 1000
      : unit === "m"
        ? 60 * 1000
        : unit === "h"
          ? 60 * 60 * 1000
          : unit === "w"
            ? 7 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
  const duration = amount * multiplier;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3650 * 24 * 60 * 60 * 1000
  ) {
    throw new Error(`Invalid --older-than duration "${value}".`);
  }
  return duration;
}

function configuredNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

async function writeRetentionState(path: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ lastCleanupDate: new Date().toISOString().slice(0, 10), schemaVersion: 1 })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  try {
    await rename(temporary, path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "EPERM")
    ) {
      await unlink(path).catch(() => undefined);
      await rename(temporary, path);
      return;
    }
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function pruneCliLogs(
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    olderThan?: string;
    activePath?: string;
  } = {}
): Promise<{ bytes: number; count: number }> {
  const env = options.env ?? process.env;
  const paths = resolveAthenaHomePaths(env, options.cwd);
  const maxBytes = configuredNumber(
    env.ATHENA_CLI_LOG_MAX_BYTES,
    100 * 1024 * 1024,
    1,
    1024 * 1024 * 1024
  );
  const cutoff =
    Date.now() -
    parseDuration(
      options.olderThan,
      configuredNumber(env.ATHENA_CLI_LOG_RETENTION_DAYS, 30, 1, 3650)
    );
  const summaries = await listCliLogs({
    cwd: options.cwd,
    env,
    limit: 10_000,
  });
  const candidates = summaries
    .filter(
      (summary) =>
        options.activePath === undefined ||
        resolve(summary.path) !== resolve(options.activePath)
    )
    .filter((summary) => isWithinRoot(summary.path, paths.cliLogsRoot))
    .map((summary) => ({
      ...summary,
      mtime: Date.parse(summary.finishedAt ?? summary.startedAt ?? "") || 0,
    }));
  let totalBytes = candidates.reduce((total, item) => total + item.bytes, 0);
  let removedCount = 0;
  let removedBytes = 0;
  const remove = candidates
    .filter((item) => item.mtime === 0 || item.mtime < cutoff)
    .sort((left, right) => {
      const failed =
        Number(left.outcome === "failure") -
        Number(right.outcome === "failure");
      return failed || left.mtime - right.mtime;
    });
  const planned = [...remove];
  let projectedBytes =
    totalBytes - remove.reduce((total, item) => total + item.bytes, 0);
  if (projectedBytes > maxBytes) {
    const agePaths = new Set(remove.map((item) => resolve(item.path)));
    const remaining = candidates
      .filter((item) => !agePaths.has(resolve(item.path)))
      .sort((left, right) => {
        const failed =
          Number(left.outcome === "failure") -
          Number(right.outcome === "failure");
        return failed || left.mtime - right.mtime;
      });
    for (const item of remaining) {
      if (projectedBytes <= maxBytes) {
        break;
      }
      planned.push(item);
      projectedBytes -= item.bytes;
    }
  }
  const targets = new Set<string>();
  for (const item of planned) {
    if (
      !(
        isWithinRoot(item.path, paths.cliLogsRoot) &&
        item.path.endsWith(".jsonl") &&
        (await isSafeLogFile(item.path, paths.cliLogsRoot))
      ) ||
      targets.has(resolve(item.path))
    ) {
      throw new Error("Invalid log retention deletion target.");
    }
    targets.add(resolve(item.path));
  }
  totalBytes = candidates.reduce((total, item) => total + item.bytes, 0);
  for (const item of planned) {
    try {
      await unlink(item.path);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw error;
      }
      continue;
    }
    totalBytes -= item.bytes;
    removedCount += 1;
    removedBytes += item.bytes;
  }
  await repairLatestPointer({
    cwd: options.cwd,
    env,
    paths,
  });
  await mkdir(paths.cliLogsRoot, { mode: 0o700, recursive: true });
  await writeRetentionState(join(paths.cliLogsRoot, "retention-state.json"));
  return {
    bytes: removedBytes,
    count: removedCount,
  };
}

export async function maybeRunCliLogRetention(
  paths: ReturnType<typeof resolveAthenaCliLogPaths>,
  env: Record<string, string | undefined>,
  cwd?: string
): Promise<void> {
  try {
    const state = JSON.parse(await readFile(paths.retentionState, "utf8")) as {
      lastCleanupDate?: unknown;
    };
    if (state.lastCleanupDate === new Date().toISOString().slice(0, 10)) {
      return;
    }
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      return;
    }
  }
  await pruneCliLogs({ activePath: paths.logFile, cwd, env });
}

export async function exportCliLog(
  sourcePath: string,
  destination: string
): Promise<{ bytes: number; malformed: number; truncated: boolean }> {
  if (resolve(sourcePath) === resolve(destination)) {
    throw new Error("CLI log export destination must differ from its source.");
  }
  const result = await readCliLogFile(sourcePath);
  const maxBytes = 10 * 1024 * 1024;
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const event of result.events) {
    const line = serializeCliLogEvent(event);
    const lineBytes =
      Buffer.byteLength(line, "utf8") + (lines.length > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  const body = lines.join("\n");
  const output = body ? `${redactSecrets(body)}\n` : "";
  await writeSecureAtomic(destination, output);
  return {
    bytes: Buffer.byteLength(output, "utf8"),
    malformed: result.malformed,
    truncated,
  };
}
