export const CANONICAL_BILLING_EVENT_NAMES = [
  "billing.payment.created",
  "billing.payment.pending",
  "billing.payment.paid",
  "billing.payment.failed",
  "billing.payment.canceled",
  "billing.payment.refunded",
  "billing.subscription.created",
  "billing.subscription.active",
  "billing.subscription.canceled",
  "billing.invoice.created",
  "billing.invoice.paid",
] as const;

export type CanonicalBillingEventName =
  (typeof CANONICAL_BILLING_EVENT_NAMES)[number];
