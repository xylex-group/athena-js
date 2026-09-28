/**
 * Semantic kinds owned by the Athena Error Spine.
 *
 * This is intentionally separate from the legacy gateway-normalization kind
 * in `auxiliaries.ts`.
 */
export type AthenaErrorKind =
  | "authentication"
  | "authorization"
  | "conflict"
  | "customer_action_required"
  | "internal"
  | "not_found"
  | "rate_limited"
  | "unsupported"
  | "unavailable"
  | "validation"
  | "unknown";

export const AthenaErrorKind = {
  Authentication: "authentication",
  Authorization: "authorization",
  Conflict: "conflict",
  CustomerActionRequired: "customer_action_required",
  Internal: "internal",
  NotFound: "not_found",
  RateLimited: "rate_limited",
  Unavailable: "unavailable",
  Unknown: "unknown",
  Unsupported: "unsupported",
  Validation: "validation",
} as const satisfies Record<string, AthenaErrorKind>;
