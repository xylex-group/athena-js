import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveAthenaCliLogPaths } from "./paths.ts";
import { redactSecrets, redactValue } from "./redact.ts";
import type { AthenaCliLogger, CliLogEvent, CliLogLevel } from "./types.ts";

export interface CreateCliLoggerOptions {
  command?: string;
  env?: Record<string, string | undefined>;
  /** Disable filesystem writes (unit tests). */
  disabled?: boolean;
  now?: Date;
  pid?: number;
  baseMetadata?: Record<string, unknown>;
}

function serializeCause(cause: unknown): { cause?: string; stack?: string } {
  if (cause instanceof Error) {
    return {
      cause: redactSecrets(cause.message),
      stack: cause.stack ? redactSecrets(cause.stack) : undefined,
    };
  }
  if (cause === undefined) {
    return {};
  }
  return { cause: redactSecrets(String(cause)) };
}

export function createCliLogger(
  options: CreateCliLoggerOptions = {}
): AthenaCliLogger {
  const paths = resolveAthenaCliLogPaths({
    env: options.env,
    now: options.now,
    command: options.command,
    pid: options.pid,
  });
  let ready: Promise<void> | undefined;
  const baseMetadata = options.baseMetadata ?? {};

  const ensureReady = async (): Promise<void> => {
    if (options.disabled) {
      return;
    }
    if (!ready) {
      ready = (async () => {
        await mkdir(paths.dayDir, { recursive: true });
        await writeFile(
          paths.latestPointer,
          JSON.stringify(
            {
              path: paths.logFile,
              command: options.command,
              startedAt: (options.now ?? new Date()).toISOString(),
            },
            null,
            2
          ),
          "utf8"
        );
      })();
    }
    await ready;
  };

  const writeEvent = async (event: CliLogEvent): Promise<void> => {
    if (options.disabled) {
      return;
    }
    await ensureReady();
    await appendFile(paths.logFile, `${JSON.stringify(event)}\n`, "utf8");
  };

  const log = (
    level: CliLogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    cause?: unknown
  ): void => {
    const causal = serializeCause(cause);
    const event: CliLogEvent = {
      ts: new Date().toISOString(),
      level,
      message: redactSecrets(message),
      command: options.command,
      metadata: redactValue({ ...baseMetadata, ...metadata }) as
        | Record<string, unknown>
        | undefined,
      ...causal,
    };
    void writeEvent(event).catch(() => {
      // Logging must never crash the CLI.
    });
  };

  const logger: AthenaCliLogger = {
    logPath: options.disabled ? undefined : paths.logFile,
    debug(message, metadata) {
      log("debug", message, metadata);
    },
    info(message, metadata) {
      log("info", message, metadata);
    },
    warn(message, metadata) {
      log("warn", message, metadata);
    },
    error(message, metadata, cause) {
      log("error", message, metadata, cause);
    },
    child(metadata) {
      return createCliLogger({
        ...options,
        baseMetadata: { ...baseMetadata, ...metadata },
      });
    },
    async flush() {
      await ensureReady();
    },
  };

  return logger;
}

export async function ensureLogDirectory(logFile: string): Promise<void> {
  await mkdir(dirname(logFile), { recursive: true });
}
