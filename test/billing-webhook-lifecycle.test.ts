import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertBillingWebhookRegistrationLifecycle,
  billingWebhookRegistrationLifecycle,
  type BillingWebhookRegistrationLifecycleState,
} from "../src/billing/ingestion/reconciliation/lifecycle.ts";

test("webhook lifecycle requires durable secret before activation", () => {
  assert.equal(
    billingWebhookRegistrationLifecycle({
      providerRegistered: true,
      secretPersisted: false,
      verificationPassed: true,
    }),
    "provider_registered_secret_pending"
  );
  assert.equal(
    billingWebhookRegistrationLifecycle({
      providerRegistered: true,
      secretPersisted: true,
      verificationPassed: false,
    }),
    "verification_pending"
  );
  assert.throws(
    () =>
      assertBillingWebhookRegistrationLifecycle("active", {
        hasSecret: false,
        next: "active",
      }),
    /secret/i
  );
});

test("webhook lifecycle permits replayable rotation and activation transitions", () => {
  const states: BillingWebhookRegistrationLifecycleState[] = [
    "provider_registration_pending",
    "provider_registered_secret_pending",
    "secret_persisted_activation_pending",
    "verification_pending",
    "active",
    "rotation_pending",
    "rotation_secret_pending",
    "active",
  ];
  for (let index = 1; index < states.length; index += 1) {
    const previous = states[index - 1];
    const next = states[index];
    assert.ok(previous);
    assert.ok(next);
    assert.doesNotThrow(() =>
      assertBillingWebhookRegistrationLifecycle(previous, {
        hasSecret: next === "active" || next === "verification_pending",
        next,
      })
    );
  }
});

test("webhook lifecycle rejects illegal transitions and permits idempotent replay", () => {
  assert.throws(
    () =>
      assertBillingWebhookRegistrationLifecycle(
        "provider_registration_pending",
        { hasSecret: true, next: "active" }
      ),
    /Illegal webhook registration lifecycle transition/
  );
  assert.doesNotThrow(() =>
    assertBillingWebhookRegistrationLifecycle("active", {
      hasSecret: true,
      next: "active",
    })
  );
});
