import type { BillingReconciliationLimits } from "./types.ts";
import { DEFAULT_BILLING_RECONCILIATION_LIMITS } from "./types.ts";

export function resolveBillingReconciliationLimits(
  input?: Partial<BillingReconciliationLimits>
): BillingReconciliationLimits {
  return {
    maxCustomers:
      input?.maxCustomers ?? DEFAULT_BILLING_RECONCILIATION_LIMITS.maxCustomers,
    maxDurationMs:
      input?.maxDurationMs ??
      DEFAULT_BILLING_RECONCILIATION_LIMITS.maxDurationMs,
    maxPages: input?.maxPages ?? DEFAULT_BILLING_RECONCILIATION_LIMITS.maxPages,
    pageSize: input?.pageSize ?? DEFAULT_BILLING_RECONCILIATION_LIMITS.pageSize,
  };
}

export function reconciliationBudgetExhausted(input: {
  customersScanned: number;
  elapsedMs: number;
  limits: BillingReconciliationLimits;
  pagesProcessed: number;
}): boolean {
  return (
    input.pagesProcessed >= input.limits.maxPages ||
    input.customersScanned >= input.limits.maxCustomers ||
    input.elapsedMs >= input.limits.maxDurationMs
  );
}
