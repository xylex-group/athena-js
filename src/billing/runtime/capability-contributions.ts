import { parseAthenaCapabilityKey } from "../../capabilities/key.ts";
import { capabilityContribution } from "../../capabilities/contribution.ts";
import type { AthenaCapabilityContribution } from "../../capabilities/resolver.ts";
import type { AthenaCapabilityKey } from "../../capabilities/key.ts";
import type { BillingCapabilities, BillingOperation } from "./capabilities.ts";

const BILLING_OPERATION_KEYS: Partial<
  Record<BillingOperation, AthenaCapabilityKey>
> = {
  "payments.list": parseAthenaCapabilityKey("billing.operation.payments.list"),
  "payments.create": parseAthenaCapabilityKey("billing.operation.payments.create"),
  "payments.get": parseAthenaCapabilityKey("billing.operation.payments.get"),
  "payments.cancel": parseAthenaCapabilityKey("billing.operation.payments.cancel"),
  "customers.list": parseAthenaCapabilityKey("billing.operation.customers.list"),
  "customers.create": parseAthenaCapabilityKey("billing.operation.customers.create"),
  "customers.get": parseAthenaCapabilityKey("billing.operation.customers.get"),
  "customers.update": parseAthenaCapabilityKey("billing.operation.customers.update"),
  "customers.delete": parseAthenaCapabilityKey("billing.operation.customers.delete"),
  "refunds.list": parseAthenaCapabilityKey("billing.operation.refunds.list"),
  "refunds.create": parseAthenaCapabilityKey("billing.operation.refunds.create"),
  "refunds.get": parseAthenaCapabilityKey("billing.operation.refunds.get"),
  "refunds.cancel": parseAthenaCapabilityKey("billing.operation.refunds.cancel"),
  "paymentLinks.list": parseAthenaCapabilityKey("billing.operation.payment-links.list"),
  "paymentLinks.create": parseAthenaCapabilityKey("billing.operation.payment-links.create"),
  "paymentLinks.get": parseAthenaCapabilityKey("billing.operation.payment-links.get"),
  "paymentLinks.update": parseAthenaCapabilityKey("billing.operation.payment-links.update"),
  "paymentLinks.delete": parseAthenaCapabilityKey("billing.operation.payment-links.delete"),
  "subscriptions.list": parseAthenaCapabilityKey("billing.operation.subscriptions.list"),
  "subscriptions.create": parseAthenaCapabilityKey("billing.operation.subscriptions.create"),
  "subscriptions.get": parseAthenaCapabilityKey("billing.operation.subscriptions.get"),
  "subscriptions.update": parseAthenaCapabilityKey("billing.operation.subscriptions.update"),
  "subscriptions.cancel": parseAthenaCapabilityKey("billing.operation.subscriptions.cancel"),
  "invoices.list": parseAthenaCapabilityKey("billing.operation.invoices.list"),
  "invoices.get": parseAthenaCapabilityKey("billing.operation.invoices.get"),
  "webhooks.list": parseAthenaCapabilityKey("billing.operation.webhooks.list"),
  "webhooks.create": parseAthenaCapabilityKey("billing.operation.webhooks.create"),
  "webhooks.get": parseAthenaCapabilityKey("billing.operation.webhooks.get"),
  "webhooks.update": parseAthenaCapabilityKey("billing.operation.webhooks.update"),
  "webhooks.delete": parseAthenaCapabilityKey("billing.operation.webhooks.delete"),
  "webhooks.test": parseAthenaCapabilityKey("billing.operation.webhooks.test"),
  "products.list": parseAthenaCapabilityKey("billing.operation.products.list"),
  "prices.list": parseAthenaCapabilityKey("billing.operation.prices.list"),
  "relations.list": parseAthenaCapabilityKey("billing.operation.relations.list"),
  "checkout.create": parseAthenaCapabilityKey("billing.operation.checkout.create"),
  "self.invoices.list": parseAthenaCapabilityKey("billing.operation.self.invoices.list"),
  "self.invoices.get": parseAthenaCapabilityKey("billing.operation.self.invoices.get"),
  "self.payments.list": parseAthenaCapabilityKey("billing.operation.self.payments.list"),
  "self.payments.get": parseAthenaCapabilityKey("billing.operation.self.payments.get"),
  "self.subscription.get": parseAthenaCapabilityKey("billing.operation.self.subscription.get"),
  "self.subscription.cancel": parseAthenaCapabilityKey("billing.operation.self.subscription.cancel"),
  "self.subscription.enroll": parseAthenaCapabilityKey("billing.operation.self.subscription.enroll"),
  "self.subscription.change": parseAthenaCapabilityKey("billing.operation.self.subscription.change"),
  "self.checkout.create": parseAthenaCapabilityKey("billing.operation.self.checkout.create"),
  "self.checkout.resume": parseAthenaCapabilityKey("billing.operation.self.checkout.resume"),
  "self.customer.get": parseAthenaCapabilityKey("billing.operation.self.customer.get"),
  "self.entitlements": parseAthenaCapabilityKey("billing.operation.self.entitlements"),
  "admin.connections.materialize": parseAthenaCapabilityKey("billing.operation.admin.connections.materialize"),
  "admin.bootstrap.retry": parseAthenaCapabilityKey("billing.operation.admin.bootstrap.retry"),
  "admin.reconciliation.run": parseAthenaCapabilityKey("billing.operation.admin.reconciliation.run"),
  "admin.reconciliation.retry": parseAthenaCapabilityKey("billing.operation.admin.reconciliation.retry"),
  "admin.webhooks.reconcile": parseAthenaCapabilityKey("billing.operation.admin.webhooks.reconcile"),
  "admin.webhooks.verify": parseAthenaCapabilityKey("billing.operation.admin.webhooks.verify"),
  "admin.webhooks.status": parseAthenaCapabilityKey("billing.operation.admin.webhooks.status"),
  "admin.ingestion.health": parseAthenaCapabilityKey("billing.operation.admin.ingestion.health"),
  "admin.conflicts.resolve": parseAthenaCapabilityKey("billing.operation.admin.conflicts.resolve"),
  "admin.conflicts.list": parseAthenaCapabilityKey("billing.operation.admin.conflicts.list"),
};

export function billingOperationCapabilityKey(
  operation: BillingOperation
): AthenaCapabilityKey {
  const key = BILLING_OPERATION_KEYS[operation];
  if (!key) {
    throw new Error(`No canonical capability key for Billing operation "${operation}"`);
  }
  return key;
}

export function billingCapabilitiesToContributions(
  capabilities: BillingCapabilities
): AthenaCapabilityContribution[] {
  const source = {
    kind: "provider" as const,
    source: `${capabilities.provider}:${capabilities.runtime}`,
  };
  return Object.entries(capabilities.operations).flatMap(
    ([operation, capability]) => {
      if (!capability) {
        return [];
      }
      const available = capability.available === true;
      return [
        capabilityContribution(
          {
            key: billingOperationCapabilityKey(operation as BillingOperation),
            domain: "billing",
            kind: "operation",
            implementation: available ? "native" : "unsupported",
            status: available ? "available" : "unavailable",
            maturity: "stable",
            ...(available ? {} : { reason: { code: "provider.operation-unsupported" } }),
          },
          source
        ),
      ];
    }
  );
}

export function billingRuntimeUnknownContributions(
  provider: string
): AthenaCapabilityContribution[] {
  const source = { kind: "provider" as const, source: `billing:${provider}` };
  return Object.values(BILLING_OPERATION_KEYS).map((key) =>
    capabilityContribution(
      {
        key: key as AthenaCapabilityKey,
        domain: "billing",
        kind: "operation",
        implementation: "unknown",
        status: "unknown",
        maturity: "stable",
        reason: { code: "capability.unknown" },
      },
      source
    )
  );
}
