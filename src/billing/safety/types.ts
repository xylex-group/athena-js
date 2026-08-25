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
	readonly operation: BillingOperation;
	readonly mutationClass: BillingMutationClass;
	readonly idempotency: BillingIdempotencyRequirement;
	readonly replayGuarantee: BillingReplayGuarantee;
	readonly money: BillingMoneyRequirement;
	readonly authorityMode: BillingAuthorityMode;
	readonly preflightIsConcurrencyGuarantee: BillingPreflightIsConcurrencyGuarantee;
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
	operation: BillingOperation;
	kind: string;
	idempotencyKeyPresent: boolean;
	requestDispatchState: BillingRequestDispatchState;
}
