import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureCliErrorId } from "../errors.ts";
import { maybeRunCliLogRetention } from "./inventory.ts";
import { resolveAthenaCliLogPaths } from "./paths.ts";
import {
  redactSecrets,
  redactValue,
  sanitizeCliError,
  serializeCliLogEvent,
} from "./redact.ts";
import type {
  AthenaCliLogger,
  BootstrapHandoffV1,
  CliLogEvent,
  CliLogEventInput,
  CliLogFinishOptions,
  CliLogMode,
} from "./types.ts";

const ERROR_BUFFER_LIMIT = 256;

export interface CreateCliLoggerOptions {
  baseMetadata?: Record<string, unknown>;
  command?: string;
  cwd?: string;
  /** Backwards-compatible alias for `mode: "off"`. */
  disabled?: boolean;
  env?: Record<string, string | undefined>;
  invocationId?: string;
  mode?: CliLogMode;
  now?: Date;
  pid?: number;
  /** Internal option used when adopting pre-runtime bootstrap events. */
  skipStart?: boolean;
  traceId?: string;
}

interface LogSink {
  readonly baseMetadata: Readonly<Record<string, unknown>>;
  bootstrapAdopted: boolean;
  buffer: CliLogEvent[];
  readonly cwd?: string;
  readonly env: Record<string, string | undefined>;
  finalized: boolean;
  firstFailure?: unknown;
  readonly invocationId: string;
  readonly mode: CliLogMode;
  readonly paths: ReturnType<typeof resolveAthenaCliLogPaths>;
  ready?: Promise<void>;
  reportedErrorIds: Set<string>;
  sequence: number;
  readonly startedAt: Date;
  tail: Promise<void>;
  readonly traceId: string;
}

function traceId(): string {
  return randomBytes(16).toString("hex");
}

function isValidTraceId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{32}$/i.test(value) &&
    !/^[0]+$/i.test(value)
  );
}

function isValidInvocationId(value: string | undefined): value is string {
  return value !== undefined && /^[a-z0-9-]{1,96}$/i.test(value);
}

function normalizeMode(
  mode: string | undefined,
  disabled: boolean | undefined
): CliLogMode {
  if (disabled) {
    return "off";
  }
  if (
    mode === "off" ||
    mode === "errors" ||
    mode === "all" ||
    mode === "debug"
  ) {
    return mode;
  }
  return "all";
}

function modeFromEnvironment(
  env: Record<string, string | undefined>,
  options: CreateCliLoggerOptions
): CliLogMode {
  const configured = options.mode ?? env.ATHENA_CLI_LOG;
  if (
    configured !== undefined &&
    configured !== "off" &&
    configured !== "errors" &&
    configured !== "all" &&
    configured !== "debug"
  ) {
    return "all";
  }
  return normalizeMode(configured, options.disabled);
}

function eventTimestamp(): string {
  return new Date().toISOString();
}

function mergeData(
  baseMetadata: Readonly<Record<string, unknown>>,
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!baseMetadata || Object.keys(baseMetadata).length === 0) {
    return data;
  }
  return { ...baseMetadata, ...data };
}

async function writeLatestPointer(sink: LogSink): Promise<void> {
  const pointer = JSON.stringify(
    {
      invocationId: sink.invocationId,
      path: sink.paths.logFile,
      schemaVersion: 1,
      startedAt: sink.startedAt.toISOString(),
      traceId: sink.traceId,
      updatedAt: eventTimestamp(),
      writer: "canonical",
    },
    null,
    2
  );
  const temporary = join(
    sink.paths.cliLogsRoot,
    `.latest-${sink.invocationId}-${randomUUID()}.tmp`
  );
  await writeFile(temporary, `${pointer}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, sink.paths.latestPointer);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "EPERM")
    ) {
      await unlink(sink.paths.latestPointer).catch(() => undefined);
      await rename(temporary, sink.paths.latestPointer);
    } else {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

async function ensureReady(sink: LogSink): Promise<void> {
  if (sink.mode === "off") {
    return;
  }
  if (!sink.ready) {
    sink.ready = (async () => {
      await mkdir(sink.paths.dayDir, { mode: 0o700, recursive: true });
      await writeLatestPointer(sink);
    })();
  }
  await sink.ready;
}

function schedule(sink: LogSink, operation: () => Promise<void>): void {
  sink.tail = sink.tail
    .catch(() => undefined)
    .then(async () => {
      try {
        await operation();
      } catch (error) {
        if (sink.firstFailure === undefined) {
          sink.firstFailure = error;
        }
      }
    });
}

function makeEvent(
  sink: LogSink,
  input: CliLogEventInput,
  sequence: number,
  mode: CliLogMode
): CliLogEvent {
  const event: CliLogEvent = {
    commandId: input.commandId,
    data: mergeData(sink.baseMetadata, input.data),
    durationMs: input.durationMs,
    error:
      input.error === undefined
        ? undefined
        : sanitizeCliError(input.error, { includeStack: mode === "debug" }),
    errorId: input.errorId,
    exitCode: input.exitCode,
    invocationId: sink.invocationId,
    kind: input.kind,
    level: input.level,
    message: input.message ? redactSecrets(input.message) : undefined,
    outcome: input.outcome,
    parentSpanId: input.parentSpanId,
    schemaVersion: 1,
    sequence,
    spanId: input.spanId,
    timestamp: eventTimestamp(),
    traceId: sink.traceId,
    writer: "canonical",
  };
  return redactValue(event) as CliLogEvent;
}

function createSink(
  options: CreateCliLoggerOptions,
  env: Record<string, string | undefined>
): LogSink {
  const now = options.now ?? new Date();
  const invocationId = isValidInvocationId(options.invocationId)
    ? options.invocationId
    : randomUUID();
  const trace = isValidTraceId(options.traceId) ? options.traceId : traceId();
  const mode = modeFromEnvironment(env, options);
  return {
    baseMetadata: Object.freeze(
      (redactValue(options.baseMetadata ?? {}) as Record<string, unknown>) ?? {}
    ),
    bootstrapAdopted: false,
    buffer: [],
    cwd: options.cwd,
    env,
    finalized: false,
    invocationId,
    mode,
    paths: resolveAthenaCliLogPaths({
      command: options.command,
      cwd: options.cwd,
      env,
      invocationId,
      now,
      pid: options.pid,
    }),
    reportedErrorIds: new Set<string>(),
    sequence: 0,
    startedAt: now,
    tail: Promise.resolve(),
    traceId: trace,
  };
}

function makeLogger(
  sink: LogSink,
  baseMetadata: Readonly<Record<string, unknown>>,
  isRoot: boolean
): AthenaCliLogger {
  const enqueue = (event: CliLogEvent): void => {
    if (sink.finalized || sink.mode === "off") {
      return;
    }
    try {
      const sanitized = redactValue(event) as CliLogEvent;
      if (Number.isInteger(sanitized.sequence)) {
        sink.sequence = Math.max(sink.sequence, sanitized.sequence);
      }
      if (sink.mode === "errors") {
        sink.buffer.push(sanitized);
        if (sink.buffer.length > ERROR_BUFFER_LIMIT) {
          sink.buffer.splice(0, sink.buffer.length - ERROR_BUFFER_LIMIT);
        }
        return;
      }
      schedule(sink, async () => {
        await ensureReady(sink);
        await appendFile(
          sink.paths.logFile,
          `${serializeCliLogEvent(sanitized)}\n`,
          { encoding: "utf8", mode: 0o600 }
        );
      });
    } catch (error) {
      if (sink.firstFailure === undefined) {
        sink.firstFailure = error;
      }
    }
  };

  const record = (input: CliLogEventInput): void => {
    if (sink.finalized || sink.mode === "off") {
      return;
    }
    try {
      const errorId =
        input.kind === "error"
          ? (input.errorId ??
            (input.error === undefined
              ? undefined
              : ensureCliErrorId(input.error)))
          : undefined;
      if (errorId && sink.reportedErrorIds.has(errorId)) {
        return;
      }
      const nextSequence = sink.sequence + 1;
      sink.sequence = nextSequence;
      if (errorId) {
        sink.reportedErrorIds.add(errorId);
      }
      const event = makeEvent(
        sink,
        {
          ...input,
          data: mergeData(baseMetadata, input.data),
          errorId,
        },
        nextSequence,
        sink.mode
      );
      enqueue(event);
    } catch (error) {
      if (sink.firstFailure === undefined) {
        sink.firstFailure = error;
      }
    }
  };

  const logger: AthenaCliLogger = {
    adoptBootstrap(handoff: BootstrapHandoffV1) {
      if (sink.bootstrapAdopted) {
        return;
      }
      if (
        handoff.version !== 1 ||
        handoff.invocationId !== sink.invocationId ||
        handoff.traceId !== sink.traceId ||
        !isValidInvocationId(handoff.invocationId) ||
        !isValidTraceId(handoff.traceId) ||
        typeof handoff.startedMonotonicNs !== "string" ||
        !Number.isInteger(handoff.sequence) ||
        handoff.sequence < 0 ||
        !Array.isArray(handoff.events) ||
        handoff.events.length > ERROR_BUFFER_LIMIT ||
        handoff.events.length === 0 ||
        !Array.isArray(handoff.sanitizedArgv) ||
        !handoff.sanitizedArgv.every(
          (argument) => typeof argument === "string"
        ) ||
        !handoff.fallback ||
        typeof handoff.fallback.enabled !== "boolean" ||
        Number.isNaN(Date.parse(handoff.startedAt))
      ) {
        throw new Error("Invalid bootstrap logging handoff.");
      }
      let previousSequence = 0;
      const acceptedEvents: CliLogEvent[] = [];
      for (const event of handoff.events) {
        if (
          event?.schemaVersion !== 1 ||
          event.invocationId !== sink.invocationId ||
          event.traceId !== sink.traceId ||
          !Number.isInteger(event.sequence) ||
          event.sequence <= previousSequence ||
          typeof event.timestamp !== "string" ||
          Number.isNaN(Date.parse(event.timestamp))
        ) {
          throw new Error("Invalid bootstrap logging event.");
        }
        previousSequence = event.sequence;
        acceptedEvents.push({
          ...event,
          writer: "canonical",
        });
      }
      if (handoff.events[0]?.kind !== "invocation.start") {
        throw new Error(
          "Bootstrap logging handoff is missing its start event."
        );
      }
      for (const event of acceptedEvents) {
        if (event.kind === "error" && event.errorId) {
          sink.reportedErrorIds.add(event.errorId);
        }
        enqueue(event);
      }
      if (handoff.sequence < previousSequence) {
        throw new Error("Bootstrap logging sequence is not monotonic.");
      }
      sink.sequence = Math.max(sink.sequence, handoff.sequence);
      sink.bootstrapAdopted = true;
    },
    child(metadata) {
      return makeLogger(
        sink,
        Object.freeze({ ...baseMetadata, ...metadata }),
        false
      );
    },
    debug(message, metadata) {
      record({ data: metadata, kind: "diagnostic", level: "debug", message });
    },
    enqueue,
    error(message, metadata, cause) {
      record({
        data: metadata,
        error: cause,
        kind: "error",
        level: "error",
        message,
      });
    },
    finish(options: CliLogFinishOptions) {
      if (!isRoot || sink.finalized || sink.mode === "off") {
        return;
      }
      sink.finalized = true;
      try {
        const sequence = sink.sequence + 1;
        sink.sequence = sequence;
        const event = makeEvent(
          sink,
          {
            commandId: options.commandId,
            data: {
              ...options.data,
              loggingFailed: sink.firstFailure !== undefined,
            },
            durationMs:
              options.durationMs ??
              Math.max(0, Date.now() - sink.startedAt.getTime()),
            exitCode: options.exitCode,
            kind: "invocation.finish",
            level: options.outcome === "success" ? "info" : "error",
            outcome: options.outcome,
          },
          sequence,
          sink.mode
        );
        if (sink.mode === "errors") {
          if (options.outcome === "success") {
            sink.buffer = [];
            return;
          }
          sink.buffer.push(event);
          if (sink.buffer.length > ERROR_BUFFER_LIMIT) {
            sink.buffer.splice(0, sink.buffer.length - ERROR_BUFFER_LIMIT);
          }
          schedule(sink, async () => {
            await ensureReady(sink);
            const body = `${sink.buffer
              .map((item) => serializeCliLogEvent(item))
              .join("\n")}\n`;
            await appendFile(sink.paths.logFile, body, {
              encoding: "utf8",
              mode: 0o600,
            });
            sink.buffer = [];
          });
          schedule(sink, async () => {
            await writeLatestPointer(sink);
          });
          schedule(sink, async () => {
            await maybeRunCliLogRetention(sink.paths, sink.env, sink.cwd);
          });
          return;
        }
        schedule(sink, async () => {
          await ensureReady(sink);
          await appendFile(
            sink.paths.logFile,
            `${serializeCliLogEvent(event)}\n`,
            { encoding: "utf8", mode: 0o600 }
          );
        });
        schedule(sink, async () => {
          await writeLatestPointer(sink);
        });
        schedule(sink, async () => {
          await maybeRunCliLogRetention(sink.paths, sink.env, sink.cwd);
        });
      } catch (error) {
        if (sink.firstFailure === undefined) {
          sink.firstFailure = error;
        }
      }
    },
    async flush() {
      let pending: Promise<void> | undefined;
      do {
        pending = sink.tail;
        await pending.catch(() => undefined);
      } while (pending !== sink.tail);
    },
    hasReportedError(errorId) {
      return sink.reportedErrorIds.has(errorId);
    },
    info(message, metadata) {
      record({ data: metadata, kind: "diagnostic", level: "info", message });
    },
    invocationId: sink.invocationId,
    get loggingFailed() {
      return sink.firstFailure !== undefined;
    },
    logPath: sink.mode === "off" ? undefined : sink.paths.logFile,
    mode: sink.mode,
    record,
    traceId: sink.traceId,
    warn(message, metadata) {
      record({ data: metadata, kind: "diagnostic", level: "warn", message });
    },
  };

  return logger;
}

export function createCliLogger(
  options: CreateCliLoggerOptions = {}
): AthenaCliLogger {
  const env = options.env ?? process.env;
  const sink = createSink(options, env);
  const logger = makeLogger(sink, sink.baseMetadata, true);
  if (sink.mode !== "off" && !options.skipStart) {
    logger.record({
      data: {
        architecture: process.arch,
        command: options.command,
        nodeVersion: process.version,
        packageVersion: sink.baseMetadata.packageVersion,
        pid: options.pid ?? process.pid,
        platform: process.platform,
      },
      kind: "invocation.start",
      level: "info",
      message: "Athena JS CLI invocation started.",
    });
    const configuredMode = options.mode ?? env.ATHENA_CLI_LOG;
    if (
      configuredMode !== undefined &&
      configuredMode !== "off" &&
      configuredMode !== "errors" &&
      configuredMode !== "all" &&
      configuredMode !== "debug"
    ) {
      logger.warn("Unknown ATHENA_CLI_LOG value; using all.", {
        configuredMode,
      });
    }
  }
  return logger;
}

export async function ensureLogDirectory(logFile: string): Promise<void> {
  await mkdir(dirname(logFile), { mode: 0o700, recursive: true });
}
