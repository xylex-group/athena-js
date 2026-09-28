import type { AthenaDevtoolsBillingReconciliationInspector } from "../../protocol/billing.ts";

export function produceBillingReconciliation(): AthenaDevtoolsBillingReconciliationInspector {
  return {
    checkpoints: [],
    conflicts: null,
    failedDocuments: null,
    lastRunAt: null,
    providerLatencyMs: null,
    retries: null,
    runs: null,
  };
}
