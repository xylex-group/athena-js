import type { BillingOperation } from "../runtime/capabilities.ts";

export type BillingMutationClass =
  | "read"
  | "financial_create"
  | "financial_cancel"
  | "non_financial_write";

export type BillingIdempotencyRequirement =
  | "required_caller_owned"
  | "not_applicable";

export type BillingReplayGuarantee = "provider_same_key" | "none";

export type BillingMoneyRequirement = "required" | "not_applicable";

export type BillingAuthorityMode = "provider-trust" | "declared-required";

/**
 * Parent-resource GET (and similar) is profile targeting only.
 * It is never a concurrency, uniqueness, or idempotency lock.
 */
export type BillingPreflightIsConcurrencyGuarantee = false;

export interface BillingOperationSafetyProfile {
  readonly authorityMode: BillingAuthorityMode;
  readonly idempotency: BillingIdempotencyRequirement;
  readonly money: BillingMoneyRequirement;
  readonly mutationClass: BillingMutationClass;
  readonly operation: BillingOperation;
  readonly preflightIsConcurrencyGuarantee: BillingPreflightIsConcurrencyGuarantee;
  readonly replayGuarantee: BillingReplayGuarantee;
}

export type BillingRequestDispatchState =
  | "not_dispatched"
  | "dispatched"
  | "unknown";

export type BillingExecutionCertainty =
  | "definitely_not_executed"
  | "definitely_executed"
  | "outcome_unknown";

export interface BillingRetryDispositionInput {
  idempotencyKeyPresent: boolean;
  kind: string;
  operation: BillingOperation;
  requestDispatchState: BillingRequestDispatchState;
}
