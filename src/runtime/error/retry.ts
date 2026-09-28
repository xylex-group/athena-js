/**
 * Default retry disposition for a canonical Athena error identity.
 *
 * Billing financial mutations still use the operation-aware safety policy in
 * `src/billing/safety`; this type is not a replacement for that policy.
 */
export type AthenaRetryDisposition =
  | "never"
  | "safe"
  | "reconcile_first"
  | "customer_action_required";

export const AthenaRetryDisposition = {
  CustomerActionRequired: "customer_action_required",
  Never: "never",
  ReconcileFirst: "reconcile_first",
  Safe: "safe",
} as const satisfies Record<string, AthenaRetryDisposition>;
