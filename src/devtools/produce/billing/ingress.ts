import type { AthenaDevtoolsBillingIngressInspector } from "../../protocol/billing.ts";

export function produceBillingIngress(): AthenaDevtoolsBillingIngressInspector {
  return {
    duplicate: null,
    normalized: null,
    received: null,
    reconciled: null,
    rejected: null,
    stages: [],
    verified: null,
  };
}
