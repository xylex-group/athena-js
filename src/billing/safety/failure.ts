import type { BillingProviderErrorKind } from "../errors.ts";
import type { BillingRetryDisposition } from "../errors.ts";
import type { BillingReconciliationHint } from "../reconciliation/hints.ts";
import type { BillingOperation } from "../runtime/capabilities.ts";
import type { BillingExecutionCertainty } from "./types.ts";

export interface BillingExecutionFailure {
	transport: {
		kind: BillingProviderErrorKind;
		provider?: string;
		status?: number;
		operation: BillingOperation;
	};
	certainty: BillingExecutionCertainty;
	retry: BillingRetryDisposition;
	reconciliation?: BillingReconciliationHint;
}

export const createBillingExecutionFailure = (
	input: BillingExecutionFailure,
): BillingExecutionFailure => ({
	certainty: input.certainty,
	reconciliation: input.reconciliation,
	retry: input.retry,
	transport: input.transport,
});
