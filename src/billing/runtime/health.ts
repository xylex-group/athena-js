import type { BillingAdminIngestionHealth } from "./admin/types.ts";

export interface AthenaBillingHealth {
  readonly canonicalLag: number;
  readonly credentials: "healthy" | "degraded" | "unavailable";
  readonly failedEvents: number;
  readonly lastReconciliation: string | null;
  readonly lastWebhook: string | null;
  readonly pendingConflicts: number;
  readonly providerConnection: "healthy" | "degraded" | "unavailable";
  readonly reconciliation: "healthy" | "degraded" | "unavailable";
  readonly webhookRegistration: "healthy" | "degraded" | "unavailable";
}

export function projectAthenaBillingHealth(
  ingestion: BillingAdminIngestionHealth
): AthenaBillingHealth {
  const healthy = ingestion.healthy === true;
  const connectionOk = ingestion.connectionStatus === "active";
  return {
    canonicalLag: ingestion.reconciliation === "behind" ? 1 : 0,
    credentials: connectionOk ? "healthy" : "degraded",
    failedEvents: ingestion.recent?.rejected ?? 0,
    lastReconciliation: ingestion.lastReconcileAt ?? null,
    lastWebhook:
      ingestion.lastSuccessfulIngressAt ?? ingestion.lastIngressAt ?? null,
    pendingConflicts: ingestion.conflicts,
    providerConnection: connectionOk
      ? "healthy"
      : healthy
        ? "degraded"
        : "unavailable",
    reconciliation:
      ingestion.reconciliation === "caught_up"
        ? "healthy"
        : ingestion.reconciliation === "behind"
          ? "degraded"
          : "unavailable",
    webhookRegistration:
      ingestion.webhookIngestion === "degraded" ? "degraded" : "healthy",
  };
}
