import assert from "node:assert/strict";
import test from "node:test";
import type { MollieSdkClientOptions } from "../src/billing/providers/types.ts";
import {
  billingCredentialFingerprint,
  billingCredentialSlot,
  BillingSecret,
  resolveBillingCredential,
} from "../src/billing/runtime/credentials.ts";
import { fromParamFromMollieHref } from "../src/billing/runtime/local/providers/mollie/cursor.ts";
import {
  MollieSdkClientPool,
  mollieSdkClientKey,
} from "../src/billing/runtime/local/providers/mollie/sdk/client-factory.ts";
import { enrollmentProviderEffectIdempotencyKey } from "../src/billing/runtime/self/enrollment-reservation.ts";

const apiBaseUrl = "https://api.mollie.com";

function unusedMollieResource(): Record<string, () => Promise<unknown>> {
  return {
    cancel: async () => ({}),
    create: async () => ({}),
    delete: async () => ({}),
    get: async () => ({}),
    list: async () => ({}),
    update: async () => ({}),
  };
}

function fakeMollieClient() {
  return {
    customers: unusedMollieResource(),
    invoices: unusedMollieResource(),
    paymentLinks: unusedMollieResource(),
    payments: unusedMollieResource(),
    refunds: unusedMollieResource(),
    salesInvoices: unusedMollieResource(),
    subscriptions: unusedMollieResource(),
    webhooks: unusedMollieResource(),
  };
}

function credentialForSecret(secret: string, slot = "configured") {
  return resolveBillingCredential({
    binding: {
      credentials: {
        test: { kind: "api_key", secret: new BillingSecret(secret) },
      },
      kind: "configured",
      provider: "mollie",
    },
    provider: "mollie",
    slot,
    testMode: true,
  }).credential;
}

test("BIL-MOLLIE-006: rotated credentials do not reuse a pooled SDK client", () => {
  let constructs = 0;
  const pool = new MollieSdkClientPool({
    adapter: (_options: MollieSdkClientOptions) => {
      constructs += 1;
      return fakeMollieClient();
    },
    apiBaseUrl,
    credentialKind: "api_key",
    sdk: class {},
  } as never);
  const first = credentialForSecret("test_key_a");
  const second = credentialForSecret("test_key_b");
  const clientA = pool.clientFor({ credential: first });
  const clientAAgain = pool.clientFor({ credential: first });
  const clientB = pool.clientFor({ credential: second });
  assert.equal(clientA, clientAAgain);
  assert.notEqual(clientA, clientB);
  assert.equal(constructs, 2);
  const keyA = mollieSdkClientKey({
    credential: first,
    serverURL: apiBaseUrl,
  });
  const keyB = mollieSdkClientKey({
    credential: second,
    serverURL: apiBaseUrl,
  });
  assert.notEqual(keyA, keyB);
  assert.equal(keyA.includes("test_key_a"), false);
  assert.equal(keyB.includes("test_key_b"), false);
  assert.equal(first.fingerprint, billingCredentialFingerprint("test_key_a"));
  assert.notEqual(first.fingerprint, "test_key_a");
  assert.equal(first.slot, "configured");
  assert.equal(
    billingCredentialSlot({
      credentialReference: "mollie:primary",
      kind: "connection",
    }),
    "mollie:primary"
  );
});

test("BIL-MOLLIE-008: continuation from is rejected unless origin and path match", () => {
  const input = { apiBaseUrl, resource: "payments" as const };
  assert.equal(
    fromParamFromMollieHref(
      "https://api.mollie.com/v2/payments?from=tr_next",
      input
    ),
    "tr_next"
  );
  assert.equal(
    fromParamFromMollieHref(
      "https://evil.example/v2/payments?from=tr_next",
      input
    ),
    undefined
  );
  assert.equal(
    fromParamFromMollieHref(
      "http://api.mollie.com/v2/payments?from=tr_next",
      input
    ),
    undefined
  );
  assert.equal(
    fromParamFromMollieHref(
      "https://api.mollie.com/v2/customers?from=tr_next",
      input
    ),
    undefined
  );
});

test("BIL-ENROLL-LEASE-IDEM: lease recapture keeps the same provider operation identity", () => {
  const durable = {
    idempotencyKey: "enroll-subject-1",
    providerIdempotencyKey: null,
  };
  const workerA = enrollmentProviderEffectIdempotencyKey(durable);
  const workerBAfterEpochBump = enrollmentProviderEffectIdempotencyKey({
    idempotencyKey: durable.idempotencyKey,
    providerIdempotencyKey: durable.providerIdempotencyKey,
  });
  assert.equal(workerA, "enroll-subject-1");
  assert.equal(workerBAfterEpochBump, workerA);
  assert.equal(
    enrollmentProviderEffectIdempotencyKey({
      idempotencyKey: "enroll-subject-1",
      providerIdempotencyKey: "enroll-subject-1:subscription",
    }),
    "enroll-subject-1:subscription"
  );
});
