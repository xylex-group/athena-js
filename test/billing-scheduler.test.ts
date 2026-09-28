import assert from "node:assert/strict";
import test from "node:test";
import {
  ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
  AthenaBillingCredentialError,
} from "../src/billing/errors.ts";
import { AthenaBillingReconciliationError } from "../src/billing/reconciliation/retry.ts";
import { logEmbeddedBillingSchedulerError } from "../src/billing/reconciliation/scheduler.ts";

test("credential-unavailable scheduler errors warn instead of failing", () => {
  const errors: unknown[] = [];
  const warns: unknown[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    logEmbeddedBillingSchedulerError(
      new AthenaBillingCredentialError({
        code: ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
        environment: "test",
        message:
          "Mollie test billing credential is unavailable. Configured environments: live.",
        provider: "mollie",
      })
    );
    logEmbeddedBillingSchedulerError(
      new AthenaBillingReconciliationError({
        kind: "lease_lost",
        message: "Another reconciler holds the customers lease.",
      })
    );
    logEmbeddedBillingSchedulerError(new Error("lease lost"));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  assert.equal(warns.length, 2);
  assert.equal(errors.length, 1);
  assert.match(String(warns[0]), /skipping scheduled reconciliation/);
  assert.match(String(warns[1]), /skipping scheduled reconciliation/);
  assert.deepEqual((warns[1] as unknown[])[1], {
    error: "Another reconciler holds the customers lease.",
  });
  assert.match(String(errors[0]), /scheduled reconciliation failed/);
});
