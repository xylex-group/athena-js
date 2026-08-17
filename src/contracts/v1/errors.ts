/**
 * v1 transport error envelope.
 * Applications must not infer semantics from free-form messages alone.
 */

import type { JsonObject } from "./common.ts";

/**
 * Stable machine-readable transport error codes.
 * Distinct from legacy client {@link AthenaErrorCode} (UNIQUE_VIOLATION, …).
 */
export type AthenaTransportErrorCode =
  | "validation_error"
  | "authentication_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "transient"
  | "internal";

export const AthenaTransportErrorCode = {
  AuthenticationRequired: "authentication_required",
  Conflict: "conflict",
  Forbidden: "forbidden",
  Internal: "internal",
  NotFound: "not_found",
  RateLimited: "rate_limited",
  Transient: "transient",
  ValidationError: "validation_error",
} as const satisfies Record<string, AthenaTransportErrorCode>;

/** Nested error body inside the transport envelope. */
export interface AthenaErrorBody {
  code: AthenaTransportErrorCode;
  details?: JsonObject;
  message: string;
  requestId?: string;
  retryable: boolean;
}

/**
 * Canonical public error response envelope.
 *
 * @example
 * ```json
 * {
 *   "error": {
 *     "code": "not_found",
 *     "message": "File not found",
 *     "retryable": false,
 *     "requestId": "req_abc"
 *   }
 * }
 * ```
 */
export interface AthenaErrorResponse {
  error: AthenaErrorBody;
}
