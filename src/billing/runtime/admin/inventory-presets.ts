export const BILLING_INVENTORY_PRESETS = [
  { id: "invoices", table: "billing_invoices", columns: ["id", "provider", "provider_invoice_id", "provider_customer_id", "status", "amount_currency", "amount_value", "amount_paid_value", "issued_at", "ingested_at"], orderBy: "ingested_at", rowKey: "id", scope: "connection", subjectScoped: true },
  { id: "payments", table: "billing_payments", columns: ["id", "provider", "provider_payment_id", "provider_customer_id", "provider_subscription_id", "status", "amount_currency", "amount_value", "paid_at", "ingested_at"], orderBy: "ingested_at", rowKey: "id", scope: "connection", subjectScoped: true },
  { id: "subscriptions", table: "billing_subscriptions", columns: ["id", "provider", "provider_subscription_id", "provider_customer_id", "status", "amount_currency", "amount_value", "interval", "next_payment_date", "ingested_at"], orderBy: "ingested_at", rowKey: "id", scope: "connection", subjectScoped: true },
  { id: "checkouts", table: "billing_checkout_sessions", columns: ["id", "subject_kind", "subject_id", "kind", "status", "price_id", "provider", "connection_id", "provider_payment_id", "provider_subscription_id", "created_at", "expires_at"], orderBy: "created_at", rowKey: "id", scope: "subject" },
  { id: "connections", table: "billing_provider_connections", columns: ["id", "owner_kind", "owner_id", "provider", "mode", "status", "credential_kind", "provider_account_id", "updated_at"], orderBy: "updated_at", rowKey: "id", scope: "owner" },
  { id: "webhookEvents", table: "billing_webhook_events", columns: ["id", "connection_id", "provider", "event_type", "entity_id", "document_kind", "provider_ref", "received_at"], orderBy: "received_at", rowKey: "id", scope: "connection" },
  { id: "projectionEvents", table: "billing_projection_events", columns: ["billing_projection_event_id", "webhook_sink_event_id", "provider", "event_type", "verification_status", "projection_status", "canonical_document_kind", "canonical_document_id", "received_at"], orderBy: "received_at", rowKey: "billing_projection_event_id", scope: "connection" },
  { id: "importRuns", table: "billing_import_runs", columns: ["id", "status", "trigger", "provider", "connection_id", "started_at", "completed_at", "pages_processed", "customers_scanned", "bindings_created", "conflicts", "trace_id"], orderBy: "started_at", rowKey: "id", scope: "connection" },
  { id: "importCandidates", table: "billing_import_candidates", columns: ["id", "provider_customer_id", "connection_id", "subject_kind", "subject_id", "confidence", "decision", "reason", "binding_id", "trace_id", "created_at"], orderBy: "created_at", rowKey: "id", scope: "connection", subjectScoped: true },
  { id: "webhookRegistrations", table: "billing_webhook_registrations", columns: ["id", "provider", "connection_id", "environment", "kind", "url", "status", "event_types", "last_verified_at", "last_delivery_at", "config_hash"], orderBy: "last_verified_at", rowKey: "id", scope: "connection" },
] as const;

export type BillingInventoryPresetId = (typeof BILLING_INVENTORY_PRESETS)[number]["id"];

export function getBillingInventoryPreset(id: unknown) {
  const preset = BILLING_INVENTORY_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error("ATHENA_BILLING_INVENTORY_PRESET_UNSUPPORTED");
  return preset;
}

export function validateBillingInventoryPage(input: { page?: unknown; pageSize?: unknown }) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 10_000) {
    throw new Error("ATHENA_BILLING_INVENTORY_PAGE_INVALID");
  }
  if (!Number.isSafeInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
    throw new Error("ATHENA_BILLING_INVENTORY_PAGE_SIZE_INVALID");
  }
  return { offset: ((page as number) - 1) * (pageSize as number), page: page as number, pageSize: pageSize as number };
}
