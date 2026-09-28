/**
 * Provider-neutral local billing contract.
 * Advertised capabilities must match ports; identities stay compound.
 */

import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { BillingOperation } from "../../../src/billing/runtime/capabilities.ts";
import type {
  BillingProviderBinding,
  BillingProviderPortCapabilities,
  BillingProviderRuntime,
} from "../../../src/billing/runtime/local/providers/types.ts";
import type { BillingProviderName } from "../../../src/billing/types.ts";

export interface BillingProviderConformanceHarness {
  provider: BillingProviderName;
  runtime: BillingProviderRuntime;
}

const PORTS = [
  "customers",
  "invoices",
  "paymentLinks",
  "payments",
  "refunds",
  "subscriptions",
  "webhooks",
  "products",
  "prices",
  "checkout",
] as const satisfies ReadonlyArray<keyof BillingProviderPortCapabilities>;

const OPERATION_PORT: Record<
  BillingOperation,
  keyof BillingProviderPortCapabilities
> = {
  "admin.conflicts.list": "webhooks",
  "admin.conflicts.resolve": "webhooks",
  "admin.connections.materialize": "webhooks",
  "admin.ingestion.health": "webhooks",
  "admin.reconciliation.retry": "webhooks",
  "admin.reconciliation.run": "webhooks",
  "admin.webhooks.reconcile": "webhooks",
  "admin.webhooks.status": "webhooks",
  "admin.webhooks.verify": "webhooks",
  "checkout.create": "checkout",
  "customers.create": "customers",
  "customers.delete": "customers",
  "customers.get": "customers",
  "customers.list": "customers",
  "customers.update": "customers",
  "invoices.get": "invoices",
  "invoices.list": "invoices",
  "paymentLinks.create": "paymentLinks",
  "paymentLinks.delete": "paymentLinks",
  "paymentLinks.get": "paymentLinks",
  "paymentLinks.list": "paymentLinks",
  "paymentLinks.update": "paymentLinks",
  "payments.cancel": "payments",
  "payments.create": "payments",
  "payments.get": "payments",
  "payments.list": "payments",
  "prices.list": "prices",
  "products.list": "products",
  "refunds.cancel": "refunds",
  "refunds.create": "refunds",
  "refunds.get": "refunds",
  "refunds.list": "refunds",
  "self.checkout.create": "payments",
  "self.checkout.resume": "payments",
  "self.customer.get": "invoices",
  "self.entitlements": "subscriptions",
  "self.invoices.get": "invoices",
  "self.invoices.list": "invoices",
  "self.payments.get": "payments",
  "self.payments.list": "payments",
  "self.subscription.cancel": "subscriptions",
  "self.subscription.change": "subscriptions",
  "self.subscription.enroll": "subscriptions",
  "self.subscription.get": "subscriptions",
  "subscriptions.cancel": "subscriptions",
  "subscriptions.create": "subscriptions",
  "subscriptions.get": "subscriptions",
  "subscriptions.list": "subscriptions",
  "subscriptions.update": "subscriptions",
  "webhooks.create": "webhooks",
  "webhooks.delete": "webhooks",
  "webhooks.get": "webhooks",
  "webhooks.list": "webhooks",
  "webhooks.test": "webhooks",
  "webhooks.update": "webhooks",
};

const OPERATION_METHOD: Record<BillingOperation, string> = {
  "admin.conflicts.list": "list",
  "admin.conflicts.resolve": "resolve",
  "admin.connections.materialize": "materialize",
  "admin.ingestion.health": "health",
  "admin.reconciliation.retry": "retry",
  "admin.reconciliation.run": "run",
  "admin.webhooks.reconcile": "reconcile",
  "admin.webhooks.status": "status",
  "admin.webhooks.verify": "verify",
  "checkout.create": "create",
  "customers.create": "create",
  "customers.delete": "delete",
  "customers.get": "get",
  "customers.list": "list",
  "customers.update": "update",
  "invoices.get": "get",
  "invoices.list": "list",
  "paymentLinks.create": "create",
  "paymentLinks.delete": "delete",
  "paymentLinks.get": "get",
  "paymentLinks.list": "list",
  "paymentLinks.update": "update",
  "payments.cancel": "cancel",
  "payments.create": "create",
  "payments.get": "get",
  "payments.list": "list",
  "prices.list": "list",
  "products.list": "list",
  "refunds.cancel": "cancel",
  "refunds.create": "create",
  "refunds.get": "get",
  "refunds.list": "list",
  "self.checkout.create": "create",
  "self.checkout.resume": "get",
  "self.customer.get": "get",
  "self.entitlements": "get",
  "self.invoices.get": "get",
  "self.invoices.list": "list",
  "self.payments.get": "get",
  "self.payments.list": "list",
  "self.subscription.cancel": "cancel",
  "self.subscription.change": "change",
  "self.subscription.enroll": "enroll",
  "self.subscription.get": "get",
  "subscriptions.cancel": "cancel",
  "subscriptions.create": "create",
  "subscriptions.get": "get",
  "subscriptions.list": "list",
  "subscriptions.update": "update",
  "webhooks.create": "create",
  "webhooks.delete": "delete",
  "webhooks.get": "get",
  "webhooks.list": "list",
  "webhooks.test": "test",
  "webhooks.update": "update",
};

const here = dirname(fileURLToPath(import.meta.url));
const typesSrc = readFileSync(
  join(here, "..", "..", "..", "src", "billing", "types.ts"),
  "utf8"
);

function interfaceBody(name: string): string {
  const match = typesSrc.match(
    new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(match, `missing interface ${name}`);
  return match[1] ?? "";
}

function configuredBinding(
  provider: BillingProviderName
): BillingProviderBinding {
  return {
    credentials: {},
    kind: "configured",
    provider,
    providerConfig: {},
  };
}

function portOf(
  runtime: BillingProviderRuntime,
  port: keyof BillingProviderPortCapabilities
): unknown {
  return runtime[port];
}

export function runBillingProviderConformance(
  harness: BillingProviderConformanceHarness
): void {
  const prefix = `conformance/billing/${harness.provider}`;

  test(`${prefix}: runtime provider name matches harness`, () => {
    assert.equal(harness.runtime.provider, harness.provider);
  });

  test(`${prefix}: capability ports match installed ports`, async () => {
    const capabilities = await harness.runtime.getCapabilities(
      configuredBinding(harness.provider)
    );
    for (const port of PORTS) {
      const advertised = capabilities.ports[port] === true;
      const installed = portOf(harness.runtime, port) != null;
      assert.equal(
        installed,
        advertised,
        `${port}: capability=${advertised} port=${installed}`
      );
    }
  });

  test(`${prefix}: advertised operations have a method on the matching port`, async () => {
    const capabilities = await harness.runtime.getCapabilities(
      configuredBinding(harness.provider)
    );
    for (const [operation, available] of Object.entries(
      capabilities.operations
    )) {
      if (available !== true) {
        continue;
      }
      if (operation.startsWith("admin.")) {
        continue;
      }
      const portName = OPERATION_PORT[operation as BillingOperation];
      const methodName = OPERATION_METHOD[operation as BillingOperation];
      const port = portOf(harness.runtime, portName) as
        | Record<string, unknown>
        | undefined;
      assert.ok(port, `${operation}: missing port ${portName}`);
      assert.equal(
        typeof port[methodName],
        "function",
        `${operation}: missing ${portName}.${methodName}`
      );
    }
  });

  test(`${prefix}: canonical identities stay compound`, () => {
    for (const name of ["BillingGetRefundInput", "BillingCancelRefundInput"]) {
      const body = interfaceBody(name);
      assert.match(body, /^[ \t]+paymentId: string;/m);
      assert.match(body, /^[ \t]+refundId: string;/m);
      assert.doesNotMatch(body, /^[ \t]+id: string;/m);
    }
    for (const name of [
      "BillingGetSubscriptionInput",
      "BillingUpdateSubscriptionInput",
      "BillingCancelSubscriptionInput",
    ]) {
      const body = interfaceBody(name);
      assert.match(body, /^[ \t]+customerId: string;/m);
      assert.match(body, /^[ \t]+subscriptionId: string;/m);
      assert.doesNotMatch(body, /^[ \t]+id: string;/m);
    }
    const invoice = interfaceBody("BillingGetInvoiceInput");
    assert.match(invoice, /^[ \t]+invoiceId: string;/m);
    assert.doesNotMatch(invoice, /^[ \t]+id: string;/m);
  });

  test(`${prefix}: capabilities serialize without secrets`, async () => {
    const capabilities = await harness.runtime.getCapabilities(
      configuredBinding(harness.provider)
    );
    const serialized = JSON.stringify(capabilities);
    assert.equal(serialized.includes("test_xxx"), false);
    assert.equal(serialized.includes("sk_test"), false);
    assert.equal(serialized.includes("sk_live"), false);
    assert.equal(serialized.includes("live_xxx"), false);
  });
}
