export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

const levels = ["debug", "info", "success", "warn", "error"] as const;

function shouldPublishLog(current: LogLevel, level: LogLevel): boolean {
  return levels.indexOf(level) >= levels.indexOf(current);
}

function resolveLogLevel(): LogLevel {
  try {
    const env = (
      globalThis as { process?: { env?: { ATHENA_AUTH_LOG_LEVEL?: string } } }
    ).process?.env?.ATHENA_AUTH_LOG_LEVEL;
    if (
      env === "debug" ||
      env === "info" ||
      env === "warn" ||
      env === "error" ||
      env === "success"
    ) {
      return env;
    }
  } catch {
    // ignore non-Node environments
  }
  return "warn";
}

function log(
  level: Exclude<LogLevel, "success">,
  message: string,
  ...args: unknown[]
): void {
  const current = resolveLogLevel();
  if (!shouldPublishLog(current, level === "info" ? "info" : level)) {
    return;
  }

  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  fn(`[athena-auth] ${message}`, ...args);
}

export const logger = {
  debug: (message: string, ...args: unknown[]) =>
    log("debug", message, ...args),
  error: (message: string, ...args: unknown[]) =>
    log("error", message, ...args),
  info: (message: string, ...args: unknown[]) => log("info", message, ...args),
  success: (message: string, ...args: unknown[]) =>
    log("info", message, ...args),
  warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
};
