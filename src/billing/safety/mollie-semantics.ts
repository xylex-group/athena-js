import type { BillingOperation } from "../runtime/capabilities.ts";
import { BILLING_OPERATION_SAFETY } from "./registry.ts";
import type { BillingOperationSafetyProfile } from "./types.ts";

export type MollieSdkResourceName =
  | "payments"
  | "customers"
  | "refunds"
  | "paymentLinks"
  | "subscriptions"
  | "invoices"
  | "webhooks";

export type MollieOperationResourceName =
  | MollieSdkResourceName
  | "products"
  | "prices"
  | "relations"
  | "checkout"
  | "self"
  | "admin";

export interface MollieOperationSemantics {
  readonly classification: "official-sdk" | "athena-owned";
  readonly method: string;
  readonly profile: BillingOperationSafetyProfile;
  readonly resource: MollieOperationResourceName;
}

const RESOURCE_METHOD: Record<
  BillingOperation,
  { resource: MollieOperationResourceName; method: string }
> = {
  "admin.conflicts.list": { method: "list", resource: "admin" },
  "admin.conflicts.resolve": { method: "resolve", resource: "admin" },
  "admin.connections.materialize": { method: "materialize", resource: "admin" },
  "admin.bootstrap.retry": { method: "retry", resource: "admin" },
  "admin.ingestion.health": { method: "health", resource: "admin" },
  "admin.reconciliation.retry": { method: "retry", resource: "admin" },
  "admin.reconciliation.run": { method: "run", resource: "admin" },
  "admin.webhooks.reconcile": { method: "reconcile", resource: "admin" },
  "admin.webhooks.status": { method: "status", resource: "admin" },
  "admin.webhooks.verify": { method: "verify", resource: "admin" },
  "checkout.create": { method: "create", resource: "checkout" },
  "customers.create": { method: "create", resource: "customers" },
  "customers.delete": { method: "delete", resource: "customers" },
  "customers.get": { method: "get", resource: "customers" },
  "customers.list": { method: "list", resource: "customers" },
  "customers.update": { method: "update", resource: "customers" },
  "invoices.get": { method: "get", resource: "invoices" },
  "invoices.list": { method: "list", resource: "invoices" },
  "paymentLinks.create": { method: "create", resource: "paymentLinks" },
  "paymentLinks.delete": { method: "delete", resource: "paymentLinks" },
  "paymentLinks.get": { method: "get", resource: "paymentLinks" },
  "paymentLinks.list": { method: "list", resource: "paymentLinks" },
  "paymentLinks.update": { method: "update", resource: "paymentLinks" },
  "payments.cancel": { method: "cancel", resource: "payments" },
  "payments.create": { method: "create", resource: "payments" },
  "payments.get": { method: "get", resource: "payments" },
  "payments.list": { method: "list", resource: "payments" },
  "prices.list": { method: "list", resource: "prices" },
  "products.list": { method: "list", resource: "products" },
  "relations.list": { method: "list", resource: "relations" },
  "refunds.cancel": { method: "cancel", resource: "refunds" },
  "refunds.create": { method: "create", resource: "refunds" },
  "refunds.get": { method: "get", resource: "refunds" },
  "refunds.list": { method: "list", resource: "refunds" },
  "self.checkout.create": { method: "create", resource: "self" },
  "self.checkout.resume": { method: "resume", resource: "self" },
  "self.customer.get": { method: "get", resource: "self" },
  "self.entitlements": { method: "entitlements", resource: "self" },
  "self.invoices.get": { method: "get", resource: "self" },
  "self.invoices.list": { method: "list", resource: "self" },
  "self.payments.get": { method: "get", resource: "self" },
  "self.payments.list": { method: "list", resource: "self" },
  "self.subscription.cancel": { method: "cancel", resource: "self" },
  "self.subscription.change": { method: "change", resource: "self" },
  "self.subscription.enroll": { method: "enroll", resource: "self" },
  "self.subscription.get": { method: "get", resource: "self" },
  "subscriptions.cancel": { method: "cancel", resource: "subscriptions" },
  "subscriptions.create": { method: "create", resource: "subscriptions" },
  "subscriptions.get": { method: "get", resource: "subscriptions" },
  "subscriptions.list": { method: "list", resource: "subscriptions" },
  "subscriptions.update": { method: "update", resource: "subscriptions" },
  "webhooks.create": { method: "create", resource: "webhooks" },
  "webhooks.delete": { method: "delete", resource: "webhooks" },
  "webhooks.get": { method: "get", resource: "webhooks" },
  "webhooks.list": { method: "list", resource: "webhooks" },
  "webhooks.test": { method: "test", resource: "webhooks" },
  "webhooks.update": { method: "update", resource: "webhooks" },
};

function semanticsFor(operation: BillingOperation): MollieOperationSemantics {
  const mapping = RESOURCE_METHOD[operation];
  const athenaOwned =
    mapping.resource === "products" ||
    mapping.resource === "prices" ||
    mapping.resource === "relations" ||
    mapping.resource === "checkout" ||
    mapping.resource === "self" ||
    mapping.resource === "admin";
  return {
    classification: athenaOwned ? "athena-owned" : "official-sdk",
    method: mapping.method,
    profile: BILLING_OPERATION_SAFETY[operation],
    resource: mapping.resource,
  };
}

export const MOLLIE_OPERATION_SEMANTICS = {
  "admin.conflicts.list": semanticsFor("admin.conflicts.list"),
  "admin.conflicts.resolve": semanticsFor("admin.conflicts.resolve"),
  "admin.connections.materialize": semanticsFor(
    "admin.connections.materialize"
  ),
  "admin.bootstrap.retry": semanticsFor("admin.bootstrap.retry"),
  "admin.ingestion.health": semanticsFor("admin.ingestion.health"),
  "admin.reconciliation.retry": semanticsFor("admin.reconciliation.retry"),
  "admin.reconciliation.run": semanticsFor("admin.reconciliation.run"),
  "admin.webhooks.reconcile": semanticsFor("admin.webhooks.reconcile"),
  "admin.webhooks.status": semanticsFor("admin.webhooks.status"),
  "admin.webhooks.verify": semanticsFor("admin.webhooks.verify"),
  "checkout.create": semanticsFor("checkout.create"),
  "customers.create": semanticsFor("customers.create"),
  "customers.delete": semanticsFor("customers.delete"),
  "customers.get": semanticsFor("customers.get"),
  "customers.list": semanticsFor("customers.list"),
  "customers.update": semanticsFor("customers.update"),
  "invoices.get": semanticsFor("invoices.get"),
  "invoices.list": semanticsFor("invoices.list"),
  "paymentLinks.create": semanticsFor("paymentLinks.create"),
  "paymentLinks.delete": semanticsFor("paymentLinks.delete"),
  "paymentLinks.get": semanticsFor("paymentLinks.get"),
  "paymentLinks.list": semanticsFor("paymentLinks.list"),
  "paymentLinks.update": semanticsFor("paymentLinks.update"),
  "payments.cancel": semanticsFor("payments.cancel"),
  "payments.create": semanticsFor("payments.create"),
  "payments.get": semanticsFor("payments.get"),
  "payments.list": semanticsFor("payments.list"),
  "prices.list": semanticsFor("prices.list"),
  "products.list": semanticsFor("products.list"),
  "relations.list": semanticsFor("relations.list"),
  "refunds.cancel": semanticsFor("refunds.cancel"),
  "refunds.create": semanticsFor("refunds.create"),
  "refunds.get": semanticsFor("refunds.get"),
  "refunds.list": semanticsFor("refunds.list"),
  "self.checkout.create": semanticsFor("self.checkout.create"),
  "self.checkout.resume": semanticsFor("self.checkout.resume"),
  "self.customer.get": semanticsFor("self.customer.get"),
  "self.entitlements": semanticsFor("self.entitlements"),
  "self.invoices.get": semanticsFor("self.invoices.get"),
  "self.invoices.list": semanticsFor("self.invoices.list"),
  "self.payments.get": semanticsFor("self.payments.get"),
  "self.payments.list": semanticsFor("self.payments.list"),
  "self.subscription.cancel": semanticsFor("self.subscription.cancel"),
  "self.subscription.change": semanticsFor("self.subscription.change"),
  "self.subscription.enroll": semanticsFor("self.subscription.enroll"),
  "self.subscription.get": semanticsFor("self.subscription.get"),
  "subscriptions.cancel": semanticsFor("subscriptions.cancel"),
  "subscriptions.create": semanticsFor("subscriptions.create"),
  "subscriptions.get": semanticsFor("subscriptions.get"),
  "subscriptions.list": semanticsFor("subscriptions.list"),
  "subscriptions.update": semanticsFor("subscriptions.update"),
  "webhooks.create": semanticsFor("webhooks.create"),
  "webhooks.delete": semanticsFor("webhooks.delete"),
  "webhooks.get": semanticsFor("webhooks.get"),
  "webhooks.list": semanticsFor("webhooks.list"),
  "webhooks.test": semanticsFor("webhooks.test"),
  "webhooks.update": semanticsFor("webhooks.update"),
} as const satisfies Record<BillingOperation, MollieOperationSemantics>;
