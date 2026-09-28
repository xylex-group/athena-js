import type { AthenaClientInternals } from "../../../runtime/client-internals.ts";
import { createBillingSqlExecutorFromManager } from "../../import/database.ts";
import {
  type BillingWebhookIngressObservability,
  createLazyBillingWebhookIngressObservability,
} from "./health.ts";

export function billingWebhookIngressObservabilityFromInternals(
  internals: AthenaClientInternals | undefined
): BillingWebhookIngressObservability {
  return createLazyBillingWebhookIngressObservability(async () => {
    const manager = internals?.postgresRuntime
      ? await internals.postgresRuntime.getPoolManager()
      : undefined;
    if (!manager) {
      return;
    }
    return createBillingSqlExecutorFromManager(manager);
  });
}
