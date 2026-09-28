import type { CanonicalBillingDocument } from "../../../../canonical/document.ts";
import { projectMollieInvoice } from "./projection/invoice.ts";
import { projectMollieSubscription } from "./projection/subscription.ts";
import { projectMolliePayment } from "./projection.ts";

export function projectMollieResourceToCanonical(
  resource: unknown,
  kind: "payment" | "subscription" | "invoice"
): CanonicalBillingDocument {
  if (kind === "subscription") {
    const projected = projectMollieSubscription(resource);
    return {
      amount: projected.amount,
      canceledAt: projected.canceledAt,
      createdAt: projected.createdAt,
      currency: projected.currency,
      description: projected.description,
      interval: projected.interval,
      kind: "subscription",
      metadata: projected.metadata,
      nextPaymentDate: projected.nextPaymentDate,
      provider: projected.provider,
      providerCustomerId: projected.providerCustomerId,
      providerProfileId: projected.providerProfileId,
      providerSubscriptionId: projected.providerSubscriptionId,
      raw: projected.raw,
      status: projected.status,
    };
  }
  if (kind === "invoice") {
    const projected = projectMollieInvoice(resource);
    return {
      amount: projected.amount,
      amountPaid: projected.amountPaid,
      createdAt: projected.createdAt,
      description: projected.description,
      issuedAt: projected.issuedAt,
      kind: "invoice",
      metadata: projected.metadata,
      paidAt: projected.paidAt,
      provider: projected.provider,
      providerCustomerId: projected.providerCustomerId,
      providerInvoiceId: projected.providerInvoiceId,
      providerProfileId: projected.providerProfileId,
      raw: projected.raw,
      status: projected.status,
    };
  }
  const projected = projectMolliePayment(resource);
  return {
    amount: projected.amount,
    amountRefunded: projected.amountRefunded,
    createdAt: projected.createdAt,
    description: projected.description,
    kind: "payment",
    metadata: projected.metadata,
    paidAt: projected.paidAt,
    provider: projected.provider,
    providerCustomerId: projected.providerCustomerId,
    providerPaymentId: projected.providerPaymentId,
    providerPaymentLinkId: projected.providerPaymentLinkId,
    providerProfileId: projected.providerProfileId,
    providerSubscriptionId: projected.providerSubscriptionId,
    raw: projected.raw,
    status: projected.status,
  };
}
