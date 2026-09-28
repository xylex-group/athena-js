import type { CliExitCode } from "../exit-code.ts";

export interface CliDiagnostic {
  code: string;
  details?: Record<string, unknown>;
  hint?: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface CommandResultMeta {
  command: string;
  durationMs: number;
}

export type CommandFailureCategory =
  | "usage"
  | "config"
  | "auth"
  | "network"
  | "domain";

export interface CommandResult<T = unknown> {
  category?: CommandFailureCategory;
  code?: string;
  data?: T;
  details?: unknown;
  exitCode?: CliExitCode;
  message?: string;
  meta?: CommandResultMeta;
  ok?: boolean;
  value?: T;
  warnings?: CliDiagnostic[];
}
