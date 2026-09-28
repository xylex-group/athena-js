/**
 * Stripe must satisfy the same local billing provider contract as Mollie.
 * Conformance here is fail-closed consistency, not Stripe API behavior.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createStripeBillingProviderRuntime } from "../../../src/billing/runtime/local/providers/stripe/runtime.ts";
import { runBillingProviderConformance } from "./contract.ts";

const stripeDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/billing/runtime/local/providers/stripe"
);

const runtime = createStripeBillingProviderRuntime({
  testKey: "sk_test_xxx",
});

runBillingProviderConformance({
  provider: "stripe",
  runtime,
});

test("conformance/billing/stripe: every advertised operation is unimplemented", async () => {
  const capabilities = await runtime.getCapabilities({
    credentials: {},
    kind: "configured",
    provider: "stripe",
    providerConfig: {},
  });
  for (const [operation, enabled] of Object.entries(capabilities.operations)) {
    assert.equal(enabled, false, operation);
  }
  assert.equal(runtime.webhooks, undefined);
  assert.equal(existsSync(join(stripeDir, "verify-webhook.ts")), false);
});
