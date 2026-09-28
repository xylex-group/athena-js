import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface AthenaHomePaths {
  cliLogsRoot: string;
  configPath: string;
  diagnosticsRoot: string;
  home: string;
  logsRoot: string;
}

export interface AthenaCliLogPaths extends AthenaHomePaths {
  dayDir: string;
  latestPointer: string;
  logFile: string;
  retentionState: string;
}

function currentWorkingDirectory(): string {
  const proc = globalThis as typeof globalThis & {
    process?: { cwd?: () => string };
  };
  return proc.process?.cwd?.() ?? ".";
}

/**
 * Resolve Athena home without interpreting shell syntax in ATHENA_HOME.
 * Relative overrides are resolved against the caller's working directory.
 */
export function resolveAthenaHome(
  env: Record<string, string | undefined> = process.env,
  cwd = currentWorkingDirectory()
): string {
  const override = env.ATHENA_HOME?.trim();
  if (override) {
    return isAbsolute(override) ? resolve(override) : resolve(cwd, override);
  }
  return resolve(homedir(), ".athena");
}

export function resolveAthenaHomePaths(
  env: Record<string, string | undefined> = process.env,
  cwd = currentWorkingDirectory()
): AthenaHomePaths {
  const home = resolveAthenaHome(env, cwd);
  const logsRoot = join(home, "logs");
  return {
    cliLogsRoot: join(logsRoot, "athena-js"),
    configPath: join(home, "config.json"),
    diagnosticsRoot: join(home, "diagnostics"),
    home,
    logsRoot,
  };
}

function safeInvocationId(invocationId: string): string {
  const normalized = invocationId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return normalized.length > 0 ? normalized.slice(0, 96) : randomUUID();
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "");
}

export function resolveAthenaCliLogPaths(
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    now?: Date;
    command?: string;
    invocationId?: string;
    pid?: number;
  } = {}
): AthenaCliLogPaths {
  const env = options.env ?? process.env;
  const homePaths = resolveAthenaHomePaths(env, options.cwd);
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const invocationId = safeInvocationId(options.invocationId ?? randomUUID());
  const dayDir = join(homePaths.cliLogsRoot, day);
  const logFile = join(
    dayDir,
    `${timestampForFilename(now)}-${invocationId}.jsonl`
  );
  return {
    ...homePaths,
    dayDir,
    latestPointer: join(homePaths.cliLogsRoot, "latest.json"),
    logFile,
    retentionState: join(homePaths.cliLogsRoot, "retention-state.json"),
  };
}
