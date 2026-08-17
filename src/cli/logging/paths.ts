import { homedir } from "node:os";
import { join } from "node:path";

export interface AthenaHomePaths {
  home: string;
  logsRoot: string;
  cliLogsRoot: string;
}

/**
 * Resolve Athena home. Precedence:
 * 1. ATHENA_HOME
 * 2. ~/.athena (homedir)
 */
export function resolveAthenaHome(
  env: Record<string, string | undefined> = process.env
): string {
  const override = env.ATHENA_HOME?.trim();
  if (override) {
    return override;
  }
  return join(homedir(), ".athena");
}

export function resolveAthenaCliLogPaths(options: {
  env?: Record<string, string | undefined>;
  now?: Date;
  command?: string;
  pid?: number;
}): {
  home: string;
  dayDir: string;
  logFile: string;
  latestPointer: string;
} {
  const env = options.env ?? process.env;
  const home = resolveAthenaHome(env);
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const time = now
    .toISOString()
    .slice(11, 19)
    .replace(/:/g, "");
  const command = (options.command ?? "cli").replace(/[^\w.-]+/g, "-");
  const pid = options.pid ?? process.pid;
  const dayDir = join(home, "logs", "athena-js", day);
  const logFile = join(dayDir, `${time}-${command}-${pid}.jsonl`);
  const latestPointer = join(home, "logs", "athena-js", "latest.json");
  return { home, dayDir, logFile, latestPointer };
}
