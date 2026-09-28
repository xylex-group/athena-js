import type { BillingReconciliationContext } from "../observability/types.ts";
import { inheritWebhookBillingReconciliationContext } from "./context.ts";

export function billingReconciliationContextFromIngress(input: {
  connectionId: string;
  ingressId: string;
  correlationId?: string;
  provider: string;
  traceId?: string;
}): BillingReconciliationContext {
  return inheritWebhookBillingReconciliationContext({
    causationId: input.ingressId,
    connectionId: input.connectionId,
    correlationId: input.correlationId ?? input.ingressId,
    provider: input.provider,
    traceId: input.traceId ?? input.ingressId,
  });
}
