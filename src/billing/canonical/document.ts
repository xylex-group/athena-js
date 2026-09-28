import type {
  BillingInvoiceStatus,
  BillingMoney,
  BillingPaymentStatus,
  BillingProviderName,
  BillingSubscriptionStatus,
} from "../types.ts";

export interface CanonicalMoney {
  currency: string;
  value: string;
}

export interface CanonicalPayment {
  amount: BillingMoney;
  amountRefunded?: BillingMoney | null;
  createdAt?: string | null;
  description?: string | null;
  kind: "payment";
  metadata: unknown;
  paidAt?: string | null;
  provider: BillingProviderName;
  providerCustomerId?: string | null;
  providerPaymentId: string;
  providerPaymentLinkId?: string | null;
  providerProfileId?: string | null;
  providerSubscriptionId?: string | null;
  raw: unknown;
  status: BillingPaymentStatus;
  updatedAt?: string | null;
}

export interface CanonicalSubscription {
  amount?: BillingMoney | null;
  canceledAt?: string | null;
  createdAt?: string | null;
  currency?: string | null;
  description?: string | null;
  interval?: string | null;
  kind: "subscription";
  metadata: unknown;
  nextPaymentDate?: string | null;
  provider: BillingProviderName;
  providerCustomerId: string;
  providerProfileId?: string | null;
  providerSubscriptionId: string;
  raw: unknown;
  status: BillingSubscriptionStatus;
  updatedAt?: string | null;
}

export interface CanonicalInvoice {
  amount?: BillingMoney | null;
  amountPaid?: BillingMoney | null;
  createdAt?: string | null;
  description?: string | null;
  issuedAt?: string | null;
  kind: "invoice";
  metadata: unknown;
  paidAt?: string | null;
  provider: BillingProviderName;
  providerCustomerId?: string | null;
  providerInvoiceId: string;
  providerProfileId?: string | null;
  raw: unknown;
  status: BillingInvoiceStatus;
  updatedAt?: string | null;
}

export type CanonicalBillingDocument =
  | CanonicalPayment
  | CanonicalSubscription
  | CanonicalInvoice;

export function canonicalDocumentSubjectId(
  document: CanonicalBillingDocument
): string {
  if (document.kind === "payment") {
    return document.providerPaymentId;
  }
  if (document.kind === "subscription") {
    return document.providerSubscriptionId;
  }
  return document.providerInvoiceId;
}

export function canonicalDocumentRevision(document: CanonicalBillingDocument): {
  providerUpdatedAt?: Date;
  sequence?: string;
} {
  const stamp =
    document.updatedAt ??
    (document.kind === "payment"
      ? (document.paidAt ?? document.createdAt)
      : document.kind === "subscription"
        ? (document.canceledAt ?? document.createdAt)
        : (document.paidAt ?? document.createdAt));
  return {
    sequence: `${document.kind}:${canonicalDocumentSubjectId(document)}:${documentFingerprint(document)}`,
    ...(stamp ? { providerUpdatedAt: new Date(stamp) } : {}),
  };
}

function documentFingerprint(document: CanonicalBillingDocument): string {
  const amount =
    document.kind === "payment"
      ? `${document.amount.currency}:${document.amount.value}`
      : `${document.amount?.currency ?? ""}:${document.amount?.value ?? ""}`;
  const refunded =
    document.kind === "payment"
      ? `${document.amountRefunded?.currency ?? ""}:${document.amountRefunded?.value ?? ""}`
      : "";
  return [
    document.status,
    amount,
    refunded,
    document.updatedAt ?? "",
    document.kind === "payment"
      ? (document.paidAt ?? "")
      : document.kind === "subscription"
        ? (document.canceledAt ?? "")
        : (document.paidAt ?? ""),
  ].join(":");
}
