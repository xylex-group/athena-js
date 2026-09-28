import assert from "node:assert/strict";
import test from "node:test";
import { ATHENA_BILLING_CREDENTIAL_UNAVAILABLE } from "../src/billing/errors.ts";
import { billingWebhookOperationalStatus } from "../src/billing/ingestion/observability/operational-status.ts";
import { connectionIngestionHealthFromRegistrations } from "../src/billing/ingestion/reconciliation/health.ts";
import type { BillingWebhookRegistrationRecord } from "../src/billing/ingestion/reconciliation/types.ts";
import { registerEmbeddedBillingScheduler } from "../src/billing/reconciliation/scheduler.ts";
import {
  claimEmbeddedBillingRuntimeOwner,
  peekEmbeddedBillingRuntimeSurfaces,
  resetEmbeddedBillingRuntimeOwnersForTests,
  retainEmbeddedBillingRuntimeScheduler,
} from "../src/billing/runtime/local/process-ownership.ts";

test("claiming a billing runtime owner cancels the previous generation schedulers", async () => {
  resetEmbeddedBillingRuntimeOwnersForTests();
  const key = "app\0db";
  const first = claimEmbeddedBillingRuntimeOwner(key);
  let ticks = 0;
  const handle = registerEmbeddedBillingScheduler({
    enabled: true,
    isCurrent: first.isCurrent,
    run: async () => {
      ticks += 1;
    },
    schedule: { intervalMs: 60_000, jitterMs: 0 },
  });
  retainEmbeddedBillingRuntimeScheduler(key, first.generation, handle);
  await handle?.runNow("scheduled");
  assert.equal(ticks, 1);
  const second = claimEmbeddedBillingRuntimeOwner(key);
  assert.equal(second.isCurrent(), true);
  assert.equal(first.isCurrent(), false);
  await handle?.runNow("scheduled");
  assert.equal(ticks, 1);
  assert.equal(peekEmbeddedBillingRuntimeSurfaces(key)?.dispatch, undefined);
});

test("active webhook registration with credential-unavailable is not healthy", () => {
  const row = {
    configHash: "h",
    connectionId: "352a6eea-b281-4860-a6d5-d2ce3ca6c311",
    environment: "live",
    eventTypes: [],
    id: "reg_1",
    kind: "classic",
    lastError: { code: ATHENA_BILLING_CREDENTIAL_UNAVAILABLE },
    lastIngressStage: "failed",
    name: "classic",
    provider: "mollie",
    status: "active",
    url: "https://example.test/classic/xOZD",
  } satisfies BillingWebhookRegistrationRecord;
  const status = billingWebhookOperationalStatus({
    connectionId: row.connectionId,
    endpoint: "/classic",
    kind: "classic",
    mounted: true,
    previousSigningSecretsConfigured: 0,
    registration: row,
    signingSecretConfigured: false,
  });
  assert.equal(status.registration.status, "active");
  assert.equal(status.registration.health, "unhealthy");
  const health = connectionIngestionHealthFromRegistrations([row]);
  assert.equal(health.classic, "error");
});
