import {
  classifyAthenaError,
  createAthenaErrorInstance,
  failureFromUnknown,
  type AthenaErrorInstance,
  type AthenaErrorIR,
  type AthenaProviderFailureIR,
} from "../runtime/error/index.ts";

export type AthenaSqliteErrorCode =
  | "cancelled"
  | "constraint"
  | "relation-not-found"
  | "syntax"
  | "busy"
  | "closed"
  | "unknown-provider"
  | "unsupported"
  | "unknown";

const MESSAGES: Record<AthenaSqliteErrorCode, string> = {
  cancelled: "SQLite Local operation was cancelled.",
  constraint: "SQLite Local constraint failed.",
  "relation-not-found": "SQLite Local table does not exist.",
  syntax: "SQLite Local rejected the statement.",
  busy: "SQLite Local database is busy.",
  closed: "SQLite Local executor is closed.",
  "unknown-provider": "SQLite Local provider failed.",
  unsupported: "SQLite Local operation is unsupported.",
  unknown: "SQLite Local operation failed.",
};

type SqliteDataError = AthenaErrorIR<string, "data">;

function providerCodeFor(
  code: AthenaSqliteErrorCode,
  cause: unknown,
): string {
  if (cause && typeof cause === "object") {
    const providerCode = (cause as { code?: unknown }).code;
    if (typeof providerCode === "string" && providerCode.length > 0) {
      return providerCode;
    }
  }
  switch (code) {
    case "busy":
      return "SQLITE_BUSY";
    case "cancelled":
      return "SQLITE_INTERRUPT";
    case "constraint":
      return "SQLITE_CONSTRAINT";
    default:
      return "SQLITE_ERROR";
  }
}

function canonicalInstance(
  code: AthenaSqliteErrorCode,
  cause: unknown,
): AthenaErrorInstance<SqliteDataError> {
  const occurrence =
    cause ?? new Error(MESSAGES[code]);
  const baseFailure = failureFromUnknown("provider", occurrence);
  const failure: AthenaProviderFailureIR = {
    ...baseFailure,
    provider: "sqlite",
    providerCode: providerCodeFor(code, cause),
    source: "provider",
  };
  const error = classifyAthenaError({
    domain: "data",
    failure,
  }) as SqliteDataError;
  return createAthenaErrorInstance(error, { cause: occurrence });
}

export class SqliteLocalError
  extends Error
  implements AthenaErrorInstance<SqliteDataError>
{
  readonly code: AthenaSqliteErrorCode;
  readonly error: SqliteDataError;
  readonly cause?: unknown;
  readonly details?: unknown;
  readonly canonical: boolean;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    code: AthenaSqliteErrorCode,
    cause?: unknown,
    canonical = true,
  ) {
    const instance = canonicalInstance(code, cause);
    super(canonical ? instance.message : MESSAGES[code]);
    this.name = "SqliteLocalError";
    this.code = code;
    this.error = instance.error;
    this.cause = cause;
    this.details = instance.details;
    this.canonical = canonical;
    this.retryable = canonical
      ? instance.error.retry === "safe"
      : code === "busy";
    this.status = canonical
      ? instance.error.status
      : code === "busy"
        ? 503
        : code === "cancelled"
          ? 499
          : 500;
  }

  toDetails(): {
    code: string;
    errorNumber?: number;
    message: string;
    status: number;
    retryable: boolean;
  } {
    if (this.canonical) {
      return {
        code: this.error.code,
        errorNumber: this.error.errorNumber,
        message: this.message,
        retryable: this.retryable,
        status: this.status,
      };
    }
    return {
      code: `SQLITE_LOCAL_${this.code.toUpperCase()}`,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
    };
  }
}

function text(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as { code?: unknown; message?: unknown; name?: unknown };
  return `${String(record.code ?? "")} ${String(record.name ?? "")} ${String(record.message ?? "")}`.toLowerCase();
}

export function normalizeSqliteError(error: unknown): SqliteLocalError {
  if (error instanceof SqliteLocalError) return error;
  const value = text(error);
  if (/abort|cancel|deadline|timeout|interrupt/.test(value)) {
    return new SqliteLocalError("cancelled", error);
  }
  if (/constraint|unique|foreign key|not null|check/.test(value)) {
    return new SqliteLocalError("constraint", error);
  }
  if (/no such table|table .* does not exist/.test(value)) {
    return new SqliteLocalError("relation-not-found", error);
  }
  if (/syntax|malformed|near .* syntax|no such column/.test(value)) {
    return new SqliteLocalError("syntax", error);
  }
  if (/busy|locked/.test(value)) return new SqliteLocalError("busy", error);
  if (/closed|finalized|disposed/.test(value)) {
    return new SqliteLocalError("closed", error);
  }
  if (/unsupported|not implemented/.test(value)) {
    return new SqliteLocalError("unsupported", error);
  }
  if (error && typeof error === "object" && "provider" in error) {
    return new SqliteLocalError("unknown-provider", error);
  }
  return new SqliteLocalError("unknown", error);
}
