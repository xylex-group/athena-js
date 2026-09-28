/**
 * Provider-port structural conformance: Mollie implemented, Stripe stub denied.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { MOLLIE_BILLING_PROVIDER_CAPABILITIES } from "../../../src/billing/runtime/local/providers/mollie/capabilities.ts";
import { STRIPE_BILLING_PROVIDER_CAPABILITIES } from "../../../src/billing/runtime/local/providers/stripe/capabilities.ts";

const LIFECYCLE = [
  "customers.create",
  "customers.get",
  "payments.create",
  "payments.get",
  "subscriptions.create",
  "subscriptions.get",
  "invoices.get",
  "checkout.create",
  "webhooks.create",
] as const;

test("P?: Mollie advertises native customer and payment lifecycle", () => {
  assert.equal(
    MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations["customers.create"],
    true
  );
  assert.equal(
    MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations["payments.create"],
    true
  );
  assert.equal(
    MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations["subscriptions.create"],
    true
  );
});

test("P?: Stripe stub does not claim lifecycle operations", () => {
  for (const operation of LIFECYCLE) {
    assert.equal(
      STRIPE_BILLING_PROVIDER_CAPABILITIES.operations[operation],
      false,
      operation
    );
  }
});
