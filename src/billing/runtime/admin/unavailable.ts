import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingAdminPort } from "./types.ts";

export function createUnavailableBillingAdminPort(): BillingAdminPort {
  const fail = (operation: string) => (): Promise<never> => {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "runtime_unavailable",
    });
  };
  return {
    bootstrap: { retry: fail("admin.bootstrap.retry") },
    conflicts: {
      list: fail("admin.conflicts.list"),
      resolve: fail("admin.conflicts.resolve"),
    },
    connections: { materialize: fail("admin.connections.materialize") },
    ingestion: { health: fail("admin.ingestion.health") },
    reconciliation: {
      retry: fail("admin.reconciliation.retry"),
      run: fail("admin.reconciliation.run"),
    },
    webhooks: {
      reconcile: fail("admin.webhooks.reconcile"),
      status: fail("admin.webhooks.status"),
      verify: fail("admin.webhooks.verify"),
    },
  };
}
