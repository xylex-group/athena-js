export const BILLING_WEBHOOK_INGRESS_STAGES = [
  "received",
  "parsed",
  "verified",
  "authoritative_refetch_started",
  "authoritative_refetch_completed",
  "canonicalized",
  "persisted",
  "reconciliation_started",
  "reconciliation_completed",
  "reconciliation_failed",
  "subject_projection_refreshed",
  "entitlements_refreshed",
  "completed",
  "duplicate",
  "rejected",
] as const;

export type BillingWebhookIngressStage =
  (typeof BILLING_WEBHOOK_INGRESS_STAGES)[number];

/** @deprecated Use `reconciliation_failed` or `rejected`. Kept for v8 rows. */
export type BillingWebhookIngressLegacyStage = "failed";

export type BillingWebhookReconciliationOutcome =
  | "completed"
  | "failed"
  | "skipped";

/** Persistable CHECK value on v8 `billing_webhook_ingress_stages` (API name is `rejected`). */
export function persistableWebhookRejectionStage(): "failed" {
  return "failed";
}

export function isBillingWebhookIngressStage(
  value: string
): value is BillingWebhookIngressStage {
  return (BILLING_WEBHOOK_INGRESS_STAGES as readonly string[]).includes(value);
}

export function billingWebhookRegistrationKind(
  operation: string
): "classic" | "next_gen" {
  return operation === "webhook.mollie.events" ? "next_gen" : "classic";
}

export function publicBillingRejectionCode(error: unknown): string {
  if (error != null && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && code.length > 0 && !/secret/i.test(code)) {
      return code;
    }
  }
  return "ATHENA_EVENT_INGRESS_FAILED";
}

export function publicBillingRejectionMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.length === 0 || /secret/i.test(raw)) {
    return publicBillingRejectionCode(error);
  }
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}
