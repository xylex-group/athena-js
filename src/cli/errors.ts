export interface AthenaCliErrorOptions {
  code: string;
  message: string;
  hint?: string;
  cause?: unknown;
  metadata?: Record<string, unknown>;
}

export class AthenaCliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly metadata?: Record<string, unknown>;

  constructor(options: AthenaCliErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AthenaCliError";
    this.code = options.code;
    this.hint = options.hint;
    this.metadata = options.metadata;
  }
}

export function formatAthenaCliError(
  error: AthenaCliError,
  logPath?: string
): string {
  const lines = [
    error.message,
    "",
    error.code,
  ];
  if (error.hint) {
    lines.push("", error.hint);
  }
  if (logPath) {
    lines.push("", `Log: ${logPath}`);
  }
  return lines.join("\n");
}
