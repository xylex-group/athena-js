import { randomUUID } from "node:crypto";
import { CliExitCode } from "./exit-code.ts";

const cliErrorIds = new WeakMap<object, string>();

export interface AthenaCliErrorOptions {
  cause?: unknown;
  code: string;
  exitCode?: CliExitCode;
  hint?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export class AthenaCliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly metadata?: Record<string, unknown>;
  readonly exitCode: CliExitCode;

  constructor(options: AthenaCliErrorOptions) {
    super(
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "AthenaCliError";
    this.code = options.code;
    this.hint = options.hint;
    this.metadata = options.metadata;
    this.exitCode = options.exitCode ?? CliExitCode.Unexpected;
  }
}

export function ensureCliErrorId(error: unknown): string {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return randomUUID();
  }
  const object = error as object;
  const existing = cliErrorIds.get(object);
  if (existing) {
    return existing;
  }
  const id = randomUUID();
  cliErrorIds.set(object, id);
  return id;
}

export function getCliErrorId(error: unknown): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return;
  }
  return cliErrorIds.get(error as object);
}

export function formatAthenaCliError(
  error: AthenaCliError,
  logPath?: string
): string {
  const lines = [error.message];
  lines.push("", `  ${error.code}`);
  if (error.hint) {
    lines.push(
      "",
      ...error.hint.split("\n").map((line) => (line ? `  ${line}` : ""))
    );
  }
  if (logPath) {
    lines.push("", `  Log  ${logPath}`);
  }
  return lines.join("\n");
}
