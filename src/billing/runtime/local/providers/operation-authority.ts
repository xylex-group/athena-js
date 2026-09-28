import type { BillingOperation } from "../../capabilities.ts";

export interface MollieOperationAuthority {
  permissions: readonly string[];
}

export const MOLLIE_OPERATION_AUTHORITY = {
  "admin.conflicts.list": { permissions: [] },
  "admin.conflicts.resolve": { permissions: [] },
  "admin.connections.materialize": { permissions: [] },
  "admin.bootstrap.retry": { permissions: [] },
  "admin.ingestion.health": { permissions: [] },
  "admin.reconciliation.retry": { permissions: [] },
  "admin.reconciliation.run": { permissions: [] },
  "admin.webhooks.reconcile": { permissions: [] },
  "admin.webhooks.status": { permissions: [] },
  "admin.webhooks.verify": { permissions: [] },
  "checkout.create": { permissions: ["payments.write"] },
  "customers.create": { permissions: ["customers.write"] },
  "customers.delete": { permissions: ["customers.write"] },
  "customers.get": { permissions: ["customers.read"] },
  "customers.list": { permissions: ["customers.read"] },
  "customers.update": { permissions: ["customers.write"] },
  "invoices.get": { permissions: ["sales-invoices.read"] },
  "invoices.list": { permissions: ["sales-invoices.read"] },
  "paymentLinks.create": { permissions: ["payment-links.write"] },
  "paymentLinks.delete": { permissions: ["payment-links.write"] },
  "paymentLinks.get": { permissions: ["payment-links.read"] },
  "paymentLinks.list": { permissions: ["payment-links.read"] },
  "paymentLinks.update": { permissions: ["payment-links.write"] },
  "payments.cancel": { permissions: ["payments.write"] },
  "payments.create": { permissions: ["payments.write"] },
  "payments.get": { permissions: ["payments.read"] },
  "payments.list": { permissions: ["payments.read"] },
  "prices.list": { permissions: [] },
  "products.list": { permissions: [] },
  "relations.list": { permissions: [] },
  "refunds.cancel": { permissions: ["refunds.write"] },
  "refunds.create": { permissions: ["refunds.write"] },
  "refunds.get": { permissions: ["refunds.read"] },
  "refunds.list": { permissions: ["refunds.read"] },
  "self.checkout.create": { permissions: [] },
  "self.checkout.resume": { permissions: [] },
  "self.customer.get": { permissions: [] },
  "self.entitlements": { permissions: [] },
  "self.invoices.get": { permissions: [] },
  "self.invoices.list": { permissions: [] },
  "self.payments.get": { permissions: [] },
  "self.payments.list": { permissions: [] },
  "self.subscription.cancel": { permissions: [] },
  "self.subscription.change": { permissions: [] },
  "self.subscription.enroll": { permissions: [] },
  "self.subscription.get": { permissions: [] },
  "subscriptions.cancel": { permissions: ["subscriptions.write"] },
  "subscriptions.create": { permissions: ["subscriptions.write"] },
  "subscriptions.get": { permissions: ["subscriptions.read"] },
  "subscriptions.list": { permissions: ["subscriptions.read"] },
  "subscriptions.update": { permissions: ["subscriptions.write"] },
  "webhooks.create": { permissions: ["webhooks.write"] },
  "webhooks.delete": { permissions: ["webhooks.write"] },
  "webhooks.get": { permissions: ["webhooks.read"] },
  "webhooks.list": { permissions: ["webhooks.read"] },
  "webhooks.test": { permissions: ["webhooks.write"] },
  "webhooks.update": { permissions: ["webhooks.write"] },
} satisfies Record<BillingOperation, MollieOperationAuthority>;

export function requiredMolliePermissionsFor(
  operation: BillingOperation
): readonly string[] {
  return MOLLIE_OPERATION_AUTHORITY[operation].permissions;
}
