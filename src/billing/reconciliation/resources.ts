export const BILLING_RECONCILIATION_RESOURCE_KINDS = [
  "customers",
  "payments",
  "subscriptions",
  "invoices",
  "refunds",
  "mandates",
  "webhook_registrations",
] as const;

export type BillingReconciliationResourceKind =
  (typeof BILLING_RECONCILIATION_RESOURCE_KINDS)[number];
