import { parseAthenaRightKey } from "../rights/key.ts";
import type { AthenaRightDefinition } from "../rights/types.ts";

const BILLING_RIGHT_META: Record<
  string,
  Pick<
    AthenaRightDefinition,
    "displayName" | "description" | "scopeKind" | "riskLevel"
  >
> = {
  "billing.admin.conflicts.write": {
    description: "Resolve billing ingestion conflicts",
    displayName: "Resolve billing conflicts",
    riskLevel: "critical",
    scopeKind: "platform",
  },
  "billing.admin.ingestion.read": {
    description: "View billing ingestion health",
    displayName: "View billing ingestion",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.admin.reconciliation.write": {
    description: "Run billing reconciliation",
    displayName: "Run billing reconciliation",
    riskLevel: "critical",
    scopeKind: "platform",
  },
  "billing.admin.webhooks.read": {
    description: "View billing webhook status",
    displayName: "View billing webhooks",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.admin.webhooks.write": {
    description: "Reconcile or verify billing webhooks",
    displayName: "Manage billing webhooks",
    riskLevel: "critical",
    scopeKind: "platform",
  },
  "billing.catalog.read": {
    description: "List Athena-owned products and prices",
    displayName: "View catalog",
    riskLevel: "low",
    scopeKind: "self",
  },
  "billing.customers.read": {
    description: "Read merchant customer records",
    displayName: "View customers",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.customers.write": {
    description: "Create or update merchant customers",
    displayName: "Manage customers",
    riskLevel: "elevated",
    scopeKind: "self",
  },
  "billing.payment-links.read": {
    description: "View payment links",
    displayName: "View payment links",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.payment-links.write": {
    description: "Create or update payment links",
    displayName: "Manage payment links",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.payments.read": {
    description: "List merchant-wide payments",
    displayName: "View all payments",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.payments.write": {
    description: "Create or cancel merchant payments",
    displayName: "Manage payments",
    riskLevel: "critical",
    scopeKind: "platform",
  },
  "billing.refunds.read": {
    description: "View refunds",
    displayName: "View refunds",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.refunds.write": {
    description: "Create refunds",
    displayName: "Manage refunds",
    riskLevel: "critical",
    scopeKind: "platform",
  },
  "billing.sales-invoices.read": {
    description: "View sales invoices",
    displayName: "View invoices",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.self.checkout.write": {
    description: "Start or resume own checkout",
    displayName: "Checkout",
    riskLevel: "elevated",
    scopeKind: "self",
  },
  "billing.self.invoices.read": {
    description: "View own invoices",
    displayName: "View own invoices",
    riskLevel: "low",
    scopeKind: "self",
  },
  "billing.self.payments.read": {
    description: "View payments belonging to the current account",
    displayName: "View own payments",
    riskLevel: "low",
    scopeKind: "self",
  },
  "billing.self.subscription.read": {
    description: "View own subscription",
    displayName: "View own subscription",
    riskLevel: "low",
    scopeKind: "self",
  },
  "billing.self.subscription.write": {
    description: "Enroll or cancel own subscription",
    displayName: "Manage own subscription",
    riskLevel: "elevated",
    scopeKind: "self",
  },
  "billing.subscriptions.read": {
    description: "View merchant subscriptions",
    displayName: "View subscriptions",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.subscriptions.write": {
    description: "Create or cancel merchant subscriptions",
    displayName: "Manage subscriptions",
    riskLevel: "critical",
    scopeKind: "platform",
  },
  "billing.webhooks.read": {
    description: "View webhook endpoints",
    displayName: "View webhooks",
    riskLevel: "elevated",
    scopeKind: "platform",
  },
  "billing.webhooks.write": {
    description: "Create or update webhook endpoints",
    displayName: "Manage webhooks",
    riskLevel: "critical",
    scopeKind: "platform",
  },
};

export const BILLING_RIGHT_DEFINITIONS: readonly AthenaRightDefinition[] =
  Object.freeze(
    Object.entries(BILLING_RIGHT_META)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, meta]) => ({
        assignable: true,
        ...meta,
        domain: "billing",
        key: parseAthenaRightKey(key),
      }))
  );
