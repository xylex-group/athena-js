/**
 * Provider facts -> Data catalog code (one class per SQLSTATE family).
 * SQLSTATE and native provider codes are never public codes.
 */
const SQLSTATE = /^[0-9A-Z]{5}$/;

export type AthenaDataErrorCode =
  | "data_backend_unavailable"
  | "data_column_not_found"
  | "data_conflict"
  | "data_constraint_violation"
  | "data_execution_failed"
  | "data_function_not_found"
  | "data_invalid_value"
  | "data_permission_denied"
  | "data_query_cancelled"
  | "data_relation_not_found"
  | "data_schema_not_found";

export function dataErrorCodeForProviderFacts(input: {
  hint?: string;
  message?: string;
  providerCode?: string;
  transportCode?: string;
}): AthenaDataErrorCode {
  const sqlState =
    normalizeSqlState(input.providerCode) ??
    normalizeSqlState(input.hint) ??
    sqlStateFromNamedHint(input.hint);

  if (sqlState === "42P01") {
    return "data_relation_not_found";
  }
  if (sqlState === "3F000") {
    return "data_schema_not_found";
  }
  if (sqlState === "42703") {
    return "data_column_not_found";
  }
  if (sqlState === "42883") {
    return "data_function_not_found";
  }
  if (
    sqlState === "23505" ||
    sqlState === "23503" ||
    sqlState === "40001" ||
    sqlState === "40P01"
  ) {
    return "data_conflict";
  }
  if (
    sqlState === "23502" ||
    sqlState === "23514" ||
    sqlState?.startsWith("22")
  ) {
    return "data_invalid_value";
  }
  if (sqlState?.startsWith("23")) {
    return "data_constraint_violation";
  }
  if (sqlState === "42501") {
    return "data_permission_denied";
  }
  if (sqlState === "57014") {
    return "data_query_cancelled";
  }
  if (
    sqlState?.startsWith("08") ||
    sqlState === "53300" ||
    sqlState === "57P03"
  ) {
    return "data_backend_unavailable";
  }

  const providerCode = input.providerCode?.trim().toUpperCase();
  const haystack =
    `${input.message ?? ""} ${input.hint ?? ""} ${input.transportCode ?? ""}`.toLowerCase();
  if (
    providerCode === "SQLITE_BUSY" ||
    providerCode === "SQLITE_LOCKED" ||
    /(?:busy|locked)/.test(haystack)
  ) {
    return "data_backend_unavailable";
  }
  if (
    providerCode === "SQLITE_INTERRUPT" ||
    /(?:abort|cancel|deadline|timeout|interrupt)/.test(haystack)
  ) {
    return "data_query_cancelled";
  }
  if (
    providerCode?.startsWith("SQLITE_CONSTRAINT") ||
    /(?:constraint|unique|foreign key|not null|check)/.test(haystack)
  ) {
    return "data_constraint_violation";
  }
  if (/(?:no such table|table .* does not exist)/.test(haystack)) {
    return "data_relation_not_found";
  }
  if (
    input.hint === "connection" ||
    input.transportCode === "NETWORK_ERROR" ||
    /(econnrefused|enotfound|econnreset|connection terminated)/.test(haystack)
  ) {
    return "data_backend_unavailable";
  }

  return "data_execution_failed";
}

function normalizeSqlState(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const trimmed = value.trim().toUpperCase();
  return SQLSTATE.test(trimmed) ? trimmed : undefined;
}

function sqlStateFromNamedHint(hint: string | undefined): string | undefined {
  if (!hint) {
    return;
  }
  if (hint.startsWith("unique_violation")) {
    return "23505";
  }
  if (hint.startsWith("foreign_key_violation")) {
    return "23503";
  }
  if (hint.startsWith("not_null_violation")) {
    return "23502";
  }
  if (hint.startsWith("check_violation")) {
    return "23514";
  }
}
