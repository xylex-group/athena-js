export type BillingCanonicalPaymentStatus =
  | "created"
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type BillingCanonicalSubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "cancel_scheduled"
  | "cancelled";

export function canonicalizeBillingPaymentStatus(input: {
  providerStatus: string;
}): BillingCanonicalPaymentStatus {
  const raw = input.providerStatus.trim().toLowerCase();
  switch (raw) {
    case "created":
      return "created";
    case "open":
      return "pending";
    case "pending":
      return "pending";
    case "authorized":
      return "authorized";
    case "paid":
      return "paid";
    case "failed":
    case "expired":
      return "failed";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "partially_refunded":
      return "partially_refunded";
    default:
      return "pending";
  }
}

export function canonicalizeBillingSubscriptionStatus(input: {
  providerStatus: string;
}): BillingCanonicalSubscriptionStatus {
  const raw = input.providerStatus.trim().toLowerCase();
  switch (raw) {
    case "pending":
    case "trialing":
      return "pending";
    case "active":
      return "active";
    case "past_due":
    case "suspended":
      return "past_due";
    case "cancel_scheduled":
    case "paused":
      return "cancel_scheduled";
    case "canceled":
    case "cancelled":
    case "completed":
      return "cancelled";
    default:
      return "pending";
  }
}
