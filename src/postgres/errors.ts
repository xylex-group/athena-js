/**
 * Map node-pg / PostgreSQL driver failures to gateway-shaped status + codes.
 * Keeps raw DriverError off the public surface (hint may include SQLSTATE).
 */

import type { AthenaGatewayTransportErrorCode } from "../gateway/types.ts";

export interface MappedPostgresError {
  code: AthenaGatewayTransportErrorCode;
  hint?: string;
  message: string;
  status: number;
  /** PostgreSQL SQLSTATE when known. */
  sqlState?: string;
}

export interface PostgresDriverErrorLike {
  code?: string;
  column?: string;
  constraint?: string;
  detail?: string;
  message?: string;
  schema?: string;
  table?: string;
}

/** Strip embedded connection URIs from driver messages. */
export function sanitizePostgresMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://***");
}

function asDriverError(error: unknown): PostgresDriverErrorLike {
  if (error && typeof error === "object") {
    return error as PostgresDriverErrorLike;
  }
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function withConstraintHint(
  base: string,
  err: PostgresDriverErrorLike
): string {
  if (err.constraint?.trim()) {
    return `${base} (${err.constraint.trim()})`;
  }
  return base;
}

/**
 * Classify a thrown `pg` error into HTTP-ish status + Athena gateway code.
 */
export function mapPostgresDriverError(error: unknown): MappedPostgresError {
  const err = asDriverError(error);
  const sqlState =
    typeof err.code === "string" && /^[0-9A-Z]{5}$/i.test(err.code)
      ? err.code.toUpperCase()
      : undefined;
  const message = sanitizePostgresMessage(
    err.message?.trim() ||
      (error instanceof Error ? error.message : String(error)) ||
      "PostgreSQL driver error"
  );

  if (!sqlState) {
    // Non-SQLSTATE driver failures (pool exhausted, network before handshake).
    const lower = message.toLowerCase();
    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("econnreset") ||
      lower.includes("connection terminated") ||
      lower.includes("timeout")
    ) {
      return {
        code: "NETWORK_ERROR",
        hint: "connection",
        message,
        status: 503,
      };
    }
    return {
      code: "HTTP_ERROR",
      message,
      status: 400,
    };
  }

  switch (sqlState) {
    case "23505": // unique_violation
      return {
        code: "HTTP_ERROR",
        hint: withConstraintHint("unique_violation", err),
        message,
        sqlState,
        status: 409,
      };
    case "23503": // foreign_key_violation
      return {
        code: "HTTP_ERROR",
        hint: withConstraintHint("foreign_key_violation", err),
        message,
        sqlState,
        status: 409,
      };
    case "23502": // not_null_violation
      return {
        code: "HTTP_ERROR",
        hint: err.column
          ? `not_null_violation (${err.column})`
          : "not_null_violation",
        message,
        sqlState,
        status: 400,
      };
    case "23514": // check_violation
      return {
        code: "HTTP_ERROR",
        hint: withConstraintHint("check_violation", err),
        message,
        sqlState,
        status: 400,
      };
    case "22P02": // invalid_text_representation
    case "22003": // numeric_value_out_of_range
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "22012": // division_by_zero
    case "22023": // invalid_parameter_value
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 400,
      };
    case "42P01": // undefined_table
    case "42703": // undefined_column
    case "42883": // undefined_function
    case "42P02": // undefined_parameter
    case "42704": // undefined_object
    case "42601": // syntax_error
    case "42602": // invalid_name
    case "42701": // duplicate_column
    case "42P07": // duplicate_table
    case "3F000": // invalid_schema_name
    case "3D000": // invalid_catalog_name
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 400,
      };
    case "40001": // serialization_failure
    case "40P01": // deadlock_detected
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 409,
      };
    case "55P03": // lock_not_available
    case "53300": // too_many_connections
    case "53400": // configuration_limit_exceeded
    case "57P03": // cannot_connect_now
    case "08000": // connection_exception
    case "08003": // connection_does_not_exist
    case "08006": // connection_failure
    case "08001": // sqlclient_unable_to_establish_sqlconnection
    case "08004": // sqlserver_rejected_establishment_of_sqlconnection
      return {
        code: "NETWORK_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 503,
      };
    case "28P01": // invalid_password
    case "28000": // invalid_authorization_specification
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 401,
      };
    case "42501": // insufficient_privilege
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 403,
      };
    case "57014": // query_canceled
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 408,
      };
    case "25006": // read_only_sql_transaction
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 403,
      };
    default:
      return {
        code: "HTTP_ERROR",
        hint: sqlState,
        message,
        sqlState,
        status: 400,
      };
  }
}
