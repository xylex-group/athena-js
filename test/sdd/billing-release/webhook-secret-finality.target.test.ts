/**
 * RED: webhook encryption never derives from DATABASE_URL; missing secrets rotate.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { resolveBillingWebhookMasterKey } from "../../../src/billing/ingestion/secrets/master-key.ts";
import { readSrc } from "./helpers.ts";

test("DATABASE_URL must not mint a webhook master key", () => {
  const previous = process.env.ATHENA_BILLING_WEBHOOK_MASTER_KEY;
  delete process.env.ATHENA_BILLING_WEBHOOK_MASTER_KEY;
  try {
    const a = resolveBillingWebhookMasterKey({
      databaseUrl: "postgres://owner:secret-a@localhost/db",
    });
    const b = resolveBillingWebhookMasterKey({
      databaseUrl: "postgres://owner:secret-b@localhost/db",
    });
    assert.equal(a, undefined);
    assert.equal(b, undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.ATHENA_BILLING_WEBHOOK_MASTER_KEY;
    } else {
      process.env.ATHENA_BILLING_WEBHOOK_MASTER_KEY = previous;
    }
  }
});

test("master-key.ts does not hash DATABASE_URL", () => {
  const source = readSrc("billing", "ingestion", "secrets", "master-key.ts");
  assert.equal(source.includes("athena-billing-webhook-secrets:"), false);
  assert.equal(source.includes("createHash"), false);
});

test("next-gen reconciliation requires a usable local signing secret", () => {
  const coordinator = readSrc(
    "billing",
    "ingestion",
    "reconciliation",
    "coordinator.ts"
  );
  assert.match(coordinator, /secret_rotation_required|rotation_required/);
  assert.match(coordinator, /key_version|key ring|decrypt-only/i);
});

test("Mollie next-gen available is verified authority, not credential kind", () => {
  const capability = readSrc(
    "billing",
    "runtime",
    "local",
    "providers",
    "mollie",
    "webhook-capability.ts"
  );
  assert.equal(capability.includes("nextGen: { available: true }"), false);
  assert.match(capability, /verified|permissions|webhooks\.write/);
});
