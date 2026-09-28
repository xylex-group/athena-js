export type CliLogLevel = "debug" | "info" | "warn" | "error";

export type CliLogMode = "off" | "errors" | "all" | "debug";

export type CliLogKind =
  | "invocation.start"
  | "invocation.finish"
  | "parse.start"
  | "parse.finish"
  | "command.start"
  | "command.finish"
  | "call.start"
  | "call.finish"
  | "stdout"
  | "stderr"
  | "diagnostic"
  | "error"
  | "process.signal"
  | "logger.failure";

export type CliLogOutcome = "success" | "failure" | "cancelled";

export interface SanitizedCliError {
  cause?: SanitizedCliError;
  code?: string;
  message: string;
  metadata?: Record<string, unknown>;
  name: string;
  stack?: string;
}

export interface CliLogEvent {
  commandId?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  error?: SanitizedCliError;
  errorId?: string;
  exitCode?: number;
  invocationId: string;
  kind: CliLogKind;
  level: CliLogLevel;
  message?: string;
  outcome?: CliLogOutcome;
  parentSpanId?: string;
  schemaVersion: 1;
  sequence: number;
  spanId?: string;
  timestamp: string;
  traceId: string;
  writer?: "bootstrap" | "canonical";
}

export interface BootstrapHandoffV1 {
  events: CliLogEvent[];
  fallback: {
    enabled: boolean;
    logRoot?: string;
  };
  invocationId: string;
  sanitizedArgv: string[];
  sequence: number;
  startedAt: string;
  startedMonotonicNs: string;
  traceId: string;
  version: 1;
}

export interface CliLogEventInput {
  commandId?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  error?: unknown;
  errorId?: string;
  exitCode?: number;
  kind: CliLogKind;
  level: CliLogLevel;
  message?: string;
  outcome?: CliLogOutcome;
  parentSpanId?: string;
  spanId?: string;
}

export interface CliLogFinishOptions {
  commandId?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  exitCode: number;
  outcome: CliLogOutcome;
}

export interface CliTraceContext {
  readonly invocationId: string;
  span<T>(
    name: string,
    metadata: Record<string, unknown> | undefined,
    operation: () => Promise<T> | T
  ): Promise<T>;
  readonly traceId: string;
}

export interface AthenaCliLogger {
  adoptBootstrap?(handoff: BootstrapHandoffV1): void;
  child(metadata: Record<string, unknown>): AthenaCliLogger;
  debug(message: string, metadata?: Record<string, unknown>): void;
  enqueue(event: CliLogEvent): void;
  error(
    message: string,
    metadata?: Record<string, unknown>,
    cause?: unknown
  ): void;
  finish(options: CliLogFinishOptions): void;
  flush(): Promise<void>;
  hasReportedError?(errorId: string): boolean;
  info(message: string, metadata?: Record<string, unknown>): void;
  readonly invocationId: string;
  readonly loggingFailed: boolean;
  readonly logPath?: string;
  readonly mode: CliLogMode;
  record(input: CliLogEventInput): void;
  readonly traceId: string;
  warn(message: string, metadata?: Record<string, unknown>): void;
}
