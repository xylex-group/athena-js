/**
 * Named mappers between legacy SDK error shapes and v1 transport error DTOs.
 */

import type { AthenaErrorCode, NormalizedAthenaError } from "../auxiliaries.ts";
import type { JsonObject } from "../contracts/v1/common.ts";
import type {
  AthenaErrorResponse,
  AthenaTransportErrorCode,
} from "../contracts/v1/errors.ts";

/**
 * Map a legacy client {@link AthenaErrorCode} to a stable transport code.
 */
export function mapAthenaErrorCodeToTransportCode(
  code: AthenaErrorCode | string
): AthenaTransportErrorCode {
  switch (code) {
    case "VALIDATION_FAILED":
      return "validation_error";
    case "AUTH_UNAUTHORIZED":
      return "authentication_required";
    case "AUTH_FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    case "UNIQUE_VIOLATION":
      return "conflict";
    case "RATE_LIMITED":
      return "rate_limited";
    case "TRANSIENT_FAILURE":
    case "NETWORK_UNAVAILABLE":
      return "transient";
    case "HTTP_FAILURE":
    case "UNKNOWN":
      return "internal";
    default:
      return "internal";
  }
}

/**
 * Public transport details must not leak DB schema identifiers (constraint,
 * table). Those stay on NormalizedAthenaError for internal diagnostics only.
 * See ADR 0021 public error envelope.
 */
function detailsFromNormalized(
  error: NormalizedAthenaError
): JsonObject | undefined {
  const details: JsonObject = {};
  if (error.operation) {
    details.operation = error.operation;
  }
  if (typeof error.status === "number") {
    details.status = error.status;
  }
  if (error.category) {
    details.category = error.category;
  }
  if (error.kind) {
    details.kind = error.kind;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

/** Stable public messages for transport codes (no schema identifiers). */
const PUBLIC_MESSAGE_BY_TRANSPORT_CODE: Record<
  AthenaTransportErrorCode,
  string
> = {
  authentication_required: "Authentication required",
  conflict: "Resource conflict",
  forbidden: "Forbidden",
  internal: "Internal error",
  not_found: "Resource not found",
  rate_limited: "Rate limit exceeded",
  transient: "Temporary failure",
  validation_error: "Validation failed",
};

/**
 * Detect database-origin text that often embeds constraint/table tokens
 * (Postgres unique violations, foreign keys, relation missing, etc.).
 */
function looksLikeDatabaseOriginMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("violates unique constraint") ||
    lower.includes("duplicate key value") ||
    lower.includes("violates foreign key constraint") ||
    lower.includes("violates check constraint") ||
    lower.includes("violates not-null constraint") ||
    /constraint\s+["'`]/.test(lower) ||
    /relation\s+["'`]/.test(lower) ||
    /column\s+["'`]/.test(lower)
  );
}

/**
 * Public transport message must not copy raw DB text that embeds schema
 * identifiers (constraint names like users_email_key, table names). Prefer a
 * stable public override when:
 * - normalized category is `database` (definitive; covers syntax/auth text
 *   outside phrase heuristics), or
 * - the message is DB-shaped / embeds known schema tokens.
 * See ADR 0021 public error envelope. (P2 #3669238929)
 */
function publicMessageFromNormalized(
  error: NormalizedAthenaError,
  transportCode: AthenaTransportErrorCode
): string {
  const message = error.message.trim();
  const embedsConstraint =
    typeof error.constraint === "string" &&
    error.constraint.length > 0 &&
    message.includes(error.constraint);
  const embedsTable =
    typeof error.table === "string" &&
    error.table.length > 0 &&
    message.includes(error.table);
  if (
    error.category === "database" ||
    looksLikeDatabaseOriginMessage(message) ||
    embedsConstraint ||
    embedsTable
  ) {
    return PUBLIC_MESSAGE_BY_TRANSPORT_CODE[transportCode];
  }
  return message.length > 0
    ? message
    : PUBLIC_MESSAGE_BY_TRANSPORT_CODE[transportCode];
}

/**
 * Prefer kind/retryable for codes that are ambiguous when mapped code-only
 * (e.g. HTTP_FAILURE covers both non-retryable client failures and 5xx outages).
 */
function mapNormalizedToTransportCode(
  error: NormalizedAthenaError
): AthenaTransportErrorCode {
  if (
    error.code === "HTTP_FAILURE" &&
    (error.kind === "transient" || error.retryable === true)
  ) {
    return "transient";
  }
  return mapAthenaErrorCodeToTransportCode(error.code);
}

/**
 * Map a normalized SDK error to the public {@link AthenaErrorResponse} envelope.
 */
export function mapNormalizedAthenaErrorToErrorResponse(
  error: NormalizedAthenaError,
  options?: { requestId?: string }
): AthenaErrorResponse {
  const details = detailsFromNormalized(error);
  const code = mapNormalizedToTransportCode(error);
  return {
    error: {
      code,
      message: publicMessageFromNormalized(error, code),
      ...(details ? { details } : {}),
      ...(options?.requestId ? { requestId: options.requestId } : {}),
      retryable: error.retryable,
    },
  };
}
