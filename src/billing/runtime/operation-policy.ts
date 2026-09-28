import { type AthenaRightKey, parseAthenaRightKey } from "../../rights/key.ts";
import type { BillingOperation } from "./capabilities.ts";

export type BillingSubjectScope = "self" | "merchant" | "admin";
export type BillingExecutionAuthority = "session" | "process";

export interface BillingOperationPolicy {
  readonly executionAuthority: BillingExecutionAuthority;
  readonly operation: BillingOperation;
  readonly requiredRights: readonly AthenaRightKey[];
  readonly subjectScope: BillingSubjectScope;
}

const CATALOG_READ = parseAthenaRightKey("billing.catalog.read");
const PAYMENTS_READ = parseAthenaRightKey("billing.payments.read");
const PAYMENTS_WRITE = parseAthenaRightKey("billing.payments.write");
const CUSTOMERS_READ = parseAthenaRightKey("billing.customers.read");
const CUSTOMERS_WRITE = parseAthenaRightKey("billing.customers.write");
const REFUNDS_READ = parseAthenaRightKey("billing.refunds.read");
const REFUNDS_WRITE = parseAthenaRightKey("billing.refunds.write");
const SUBSCRIPTIONS_READ = parseAthenaRightKey("billing.subscriptions.read");
const SUBSCRIPTIONS_WRITE = parseAthenaRightKey("billing.subscriptions.write");
const PAYMENT_LINKS_READ = parseAthenaRightKey("billing.payment-links.read");
const PAYMENT_LINKS_WRITE = parseAthenaRightKey("billing.payment-links.write");
const SALES_INVOICES_READ = parseAthenaRightKey("billing.sales-invoices.read");
const WEBHOOKS_READ = parseAthenaRightKey("billing.webhooks.read");
const WEBHOOKS_WRITE = parseAthenaRightKey("billing.webhooks.write");
const SELF_INVOICES_READ = parseAthenaRightKey("billing.self.invoices.read");
const SELF_PAYMENTS_READ = parseAthenaRightKey("billing.self.payments.read");
const SELF_SUBSCRIPTION_READ = parseAthenaRightKey(
  "billing.self.subscription.read"
);
const SELF_SUBSCRIPTION_WRITE = parseAthenaRightKey(
  "billing.self.subscription.write"
);
const SELF_CHECKOUT_WRITE = parseAthenaRightKey("billing.self.checkout.write");
const ADMIN_RECONCILIATION_WRITE = parseAthenaRightKey(
  "billing.admin.reconciliation.write"
);
const ADMIN_WEBHOOKS_READ = parseAthenaRightKey("billing.admin.webhooks.read");
const ADMIN_WEBHOOKS_WRITE = parseAthenaRightKey(
  "billing.admin.webhooks.write"
);
const ADMIN_INGESTION_READ = parseAthenaRightKey(
  "billing.admin.ingestion.read"
);
const ADMIN_CONFLICTS_WRITE = parseAthenaRightKey(
  "billing.admin.conflicts.write"
);

function policy(
  operation: BillingOperation,
  subjectScope: BillingSubjectScope,
  requiredRights: readonly AthenaRightKey[]
): BillingOperationPolicy {
  return {
    executionAuthority: subjectScope === "self" ? "session" : "process",
    operation,
    requiredRights,
    subjectScope,
  };
}

const POLICIES: readonly BillingOperationPolicy[] = Object.freeze([
  policy("customers.create", "merchant", [CUSTOMERS_WRITE]),
  policy("customers.delete", "merchant", [CUSTOMERS_WRITE]),
  policy("customers.get", "merchant", [CUSTOMERS_READ]),
  policy("customers.list", "merchant", [CUSTOMERS_READ]),
  policy("customers.update", "merchant", [CUSTOMERS_WRITE]),
  policy("invoices.get", "merchant", [SALES_INVOICES_READ]),
  policy("invoices.list", "merchant", [SALES_INVOICES_READ]),
  policy("paymentLinks.create", "merchant", [PAYMENT_LINKS_WRITE]),
  policy("paymentLinks.delete", "merchant", [PAYMENT_LINKS_WRITE]),
  policy("paymentLinks.get", "merchant", [PAYMENT_LINKS_READ]),
  policy("paymentLinks.list", "merchant", [PAYMENT_LINKS_READ]),
  policy("paymentLinks.update", "merchant", [PAYMENT_LINKS_WRITE]),
  policy("payments.cancel", "merchant", [PAYMENTS_WRITE]),
  policy("payments.create", "merchant", [PAYMENTS_WRITE]),
  policy("payments.get", "merchant", [PAYMENTS_READ]),
  policy("payments.list", "merchant", [PAYMENTS_READ]),
  policy("refunds.cancel", "merchant", [REFUNDS_WRITE]),
  policy("refunds.create", "merchant", [REFUNDS_WRITE]),
  policy("refunds.get", "merchant", [REFUNDS_READ]),
  policy("refunds.list", "merchant", [REFUNDS_READ]),
  policy("subscriptions.cancel", "merchant", [SUBSCRIPTIONS_WRITE]),
  policy("subscriptions.create", "merchant", [SUBSCRIPTIONS_WRITE]),
  policy("subscriptions.get", "merchant", [SUBSCRIPTIONS_READ]),
  policy("subscriptions.list", "merchant", [SUBSCRIPTIONS_READ]),
  policy("subscriptions.update", "merchant", [SUBSCRIPTIONS_WRITE]),
  policy("webhooks.create", "merchant", [WEBHOOKS_WRITE]),
  policy("webhooks.delete", "merchant", [WEBHOOKS_WRITE]),
  policy("webhooks.get", "merchant", [WEBHOOKS_READ]),
  policy("webhooks.list", "merchant", [WEBHOOKS_READ]),
  policy("webhooks.test", "merchant", [WEBHOOKS_WRITE]),
  policy("webhooks.update", "merchant", [WEBHOOKS_WRITE]),
  policy("products.list", "self", [CATALOG_READ]),
  policy("prices.list", "self", [CATALOG_READ]),
  policy("relations.list", "self", [CATALOG_READ]),
  policy("checkout.create", "merchant", [PAYMENTS_WRITE]),
  policy("self.invoices.list", "self", [SELF_INVOICES_READ]),
  policy("self.invoices.get", "self", [SELF_INVOICES_READ]),
  policy("self.payments.list", "self", [SELF_PAYMENTS_READ]),
  policy("self.payments.get", "self", [SELF_PAYMENTS_READ]),
  policy("self.subscription.get", "self", [SELF_SUBSCRIPTION_READ]),
  policy("self.subscription.cancel", "self", [SELF_SUBSCRIPTION_WRITE]),
  policy("self.subscription.enroll", "self", [SELF_SUBSCRIPTION_WRITE]),
  policy("self.subscription.change", "self", [SELF_SUBSCRIPTION_WRITE]),
  policy("self.checkout.create", "self", [SELF_CHECKOUT_WRITE]),
  policy("self.checkout.resume", "self", [SELF_CHECKOUT_WRITE]),
  policy("self.customer.get", "self", [SELF_INVOICES_READ]),
  policy("self.entitlements", "self", [SELF_SUBSCRIPTION_READ]),
  policy("admin.connections.materialize", "admin", [
    ADMIN_RECONCILIATION_WRITE,
  ]),
  policy("admin.bootstrap.retry", "admin", [ADMIN_RECONCILIATION_WRITE]),
  policy("admin.conflicts.list", "admin", [ADMIN_CONFLICTS_WRITE]),
  policy("admin.conflicts.resolve", "admin", [ADMIN_CONFLICTS_WRITE]),
  policy("admin.ingestion.health", "admin", [ADMIN_INGESTION_READ]),
  policy("admin.reconciliation.retry", "admin", [ADMIN_RECONCILIATION_WRITE]),
  policy("admin.reconciliation.run", "admin", [ADMIN_RECONCILIATION_WRITE]),
  policy("admin.webhooks.reconcile", "admin", [ADMIN_WEBHOOKS_WRITE]),
  policy("admin.webhooks.status", "admin", [ADMIN_WEBHOOKS_READ]),
  policy("admin.webhooks.verify", "admin", [ADMIN_WEBHOOKS_WRITE]),
]);

const POLICY_BY_OPERATION = Object.freeze(
  Object.fromEntries(POLICIES.map((entry) => [entry.operation, entry]))
) as Record<BillingOperation, BillingOperationPolicy>;

export function billingOperationPolicy(
  operation: BillingOperation
): BillingOperationPolicy {
  return POLICY_BY_OPERATION[operation];
}

export function listBillingOperationPolicies(): readonly BillingOperationPolicy[] {
  return POLICIES;
}

export function isSessionSubjectBillingOperation(
  operation: BillingOperation
): boolean {
  return billingOperationPolicy(operation).subjectScope === "self";
}
