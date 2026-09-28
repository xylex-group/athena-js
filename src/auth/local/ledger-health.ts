/**
 * Classify Embedded Auth ledger probe failures.
 *
 * A missing `athena.auth_schema_migrations` table is UNINITIALIZED.
 * Connection, privilege, and malformed-adapter failures are not.
 */

export type AthenaAuthLedgerHealth =
  | "UNINITIALIZED"
  | "UNREACHABLE"
  | "PERMISSION_DENIED"
  | "INVALID_LEDGER"
  | "FUTURE_GENERATION"
  | "DRIFT"
  | "HEALTHY";

export type AthenaAuthLedgerQueryFailure =
  | "UNINITIALIZED"
  | "UNREACHABLE"
  | "PERMISSION_DENIED"
  | "INVALID_LEDGER";

const NETWORK_NODE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) {
      return code.trim();
    }
  }
  return "";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function walkCauses(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    seen.push(current);
    if (
      typeof current !== "object" ||
      current === null ||
      !("cause" in current)
    ) {
      break;
    }
    current = (current as { cause: unknown }).cause;
  }
  return seen;
}

/**
 * Classify an error raised while reading `athena.auth_schema_migrations`.
 */
export function classifyAuthLedgerQueryError(
  error: unknown
): AthenaAuthLedgerQueryFailure {
  for (const node of walkCauses(error)) {
    const code = codeOf(node);
    if (code === "ATHENA_AUTH_DATABASE_RESULT_INVALID") {
      return "INVALID_LEDGER";
    }
    if (code === "ATHENA_AUTH_LEDGER_UNREACHABLE") {
      return "UNREACHABLE";
    }
    if (code === "ATHENA_AUTH_LEDGER_PERMISSION_DENIED") {
      return "PERMISSION_DENIED";
    }
    const sqlState = /^[0-9A-Z]{5}$/i.test(code) ? code.toUpperCase() : "";
    if (sqlState === "42P01" || sqlState === "3F000") {
      return "UNINITIALIZED";
    }
    if (
      sqlState === "42501" ||
      sqlState === "25006" ||
      sqlState === "28P01" ||
      sqlState === "28000"
    ) {
      return "PERMISSION_DENIED";
    }
    if (
      sqlState.startsWith("08") ||
      sqlState === "57P03" ||
      NETWORK_NODE_CODES.has(code)
    ) {
      return "UNREACHABLE";
    }
  }

  const message = messageOf(error);
  if (
    /relation ["']?athena\.auth_schema_migrations["']? does not exist/i.test(
      message
    ) ||
    /relation ["']?auth_schema_migrations["']? does not exist/i.test(message) ||
    /schema ["']?athena["']? does not exist/i.test(message)
  ) {
    return "UNINITIALIZED";
  }
  if (
    /permission denied|insufficient privilege|password authentication failed|not authorized/i.test(
      message
    )
  ) {
    return "PERMISSION_DENIED";
  }
  if (
    /econnrefused|enotfound|etimedout|eai_again|econnreset|connection refused|connection terminated|timeout expired/i.test(
      message
    )
  ) {
    return "UNREACHABLE";
  }

  return "UNREACHABLE";
}

export function healthFromAuthPlan(input: {
  conflictCount: number;
  hasBlockingDrift: boolean;
  entries: ReadonlyArray<{ ledgerState: string }>;
}): AthenaAuthLedgerHealth {
  if (input.entries.some((entry) => entry.ledgerState === "unknown")) {
    return "FUTURE_GENERATION";
  }
  if (input.hasBlockingDrift) {
    return "DRIFT";
  }
  if (
    input.entries.length > 0 &&
    input.entries.every((entry) => entry.ledgerState === "absent")
  ) {
    return "UNINITIALIZED";
  }
  if (input.conflictCount > 0) {
    return "DRIFT";
  }
  return "HEALTHY";
}
