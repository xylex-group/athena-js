export type CliLogLevel = "debug" | "info" | "warn" | "error";

export interface CliLogEvent {
  ts: string;
  level: CliLogLevel;
  code?: string;
  message: string;
  command?: string;
  metadata?: Record<string, unknown>;
  cause?: string;
  stack?: string;
}

export interface AthenaCliLogger {
  readonly logPath?: string;
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(
    message: string,
    metadata?: Record<string, unknown>,
    cause?: unknown
  ): void;
  child(metadata: Record<string, unknown>): AthenaCliLogger;
  flush(): Promise<void>;
}
