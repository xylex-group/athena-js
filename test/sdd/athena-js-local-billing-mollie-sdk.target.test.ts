/**
 * Target — native Mollie SDK constructor, pool, one-page lists, and fail-closed writes.
 */

import { strict as assert } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import type { MollieSdkClientOptions } from "../../src/billing/providers/types.ts";
import { createClient } from "../../src/v3-client.ts";

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

class FakeMollieClient {
  static constructs: MollieSdkClientOptions[] = [];
  static calls: Array<{ method: string; request: unknown }> = [];

  constructor(options: MollieSdkClientOptions = {}) {
    FakeMollieClient.constructs.push(options);
  }

  customers = unusedMollieResource();
  invoices = unusedMollieResource();
  salesInvoices = unusedMollieResource();
  paymentLinks = unusedMollieResource();
  refunds = unusedMollieResource();
  subscriptions = unusedMollieResource();
  payments = {
    cancel: async () => ({}),
    create: async (request: unknown) => {
      FakeMollieClient.calls.push({ method: "payments.create", request });
      return {
        amount: { currency: "EUR", value: "10.00" },
        id: "tr_fake_1",
        resource: "payment",
        status: "open",
      };
    },
    get: async () => ({}),
    list: async (request: unknown) => {
      FakeMollieClient.calls.push({ method: "payments.list", request });
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            _embedded: {
              payments: [
                {
                  amount: { currency: "EUR", value: "10.00" },
                  id: "tr_page_1",
                  resource: "payment",
                  status: "open",
                },
              ],
            },
            _links: {
              next: {
                href: "https://api.mollie.com/v2/payments?from=tr_page_2",
              },
            },
          };
          yield {
            _embedded: {
              payments: [
                { id: "tr_page_2", resource: "payment", status: "open" },
              ],
            },
          };
        },
      };
    },
  };
}

const mollieDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "billing",
  "runtime",
  "local",
  "providers",
  "mollie"
);

function resetFake() {
  FakeMollieClient.constructs = [];
  FakeMollieClient.calls = [];
}

test("ACT-BILLING-SDK-001: resource ports do not call fetch or Mollie HTTP", () => {
  const ports = [
    "payments.ts",
    "customers.ts",
    "refunds.ts",
    "payment-links.ts",
    "subscriptions.ts",
    "invoices.ts",
  ];
  for (const file of ports) {
    const src = readFileSync(join(mollieDir, file), "utf8");
    assert.doesNotMatch(src, /requestMollieJson/);
    assert.doesNotMatch(src, /api\.mollie\.com/);
    assert.doesNotMatch(src, /Authorization/);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
  }
  assert.equal(readdirSync(mollieDir).includes("transport.ts"), false);
});

test("T-BIL-MOLLIE-SDK-API-KEY: constructor receives security.apiKey without testmode", async () => {
  resetFake();
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: { sdk: FakeMollieClient, testKey: "test_sdk_key" },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await client.billing.payments.create({
    amount: { currency: "EUR", value: "10.00" },
    description: "SDK",
    idempotencyKey: "idem-sdk-construct",
  });
  assert.equal(FakeMollieClient.constructs.length, 1);
  assert.deepEqual(FakeMollieClient.constructs[0]?.security, {
    apiKey: "test_sdk_key",
  });
  assert.equal(FakeMollieClient.constructs[0]?.testmode, undefined);
  const create = FakeMollieClient.calls.find(
    (c) => c.method === "payments.create"
  );
  assert.ok(create);
  assert.equal(
    (create.request as { paymentRequest?: { description?: string } })
      .paymentRequest?.description,
    "SDK"
  );
});

test("T-BIL-MOLLIE-SDK-WRITE-DENIED: missing write never constructs the SDK", async () => {
  resetFake();
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_sdk_denied",
          authority: {
            permissions: { payments: { read: true, write: false } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: "pfl_a",
          sdk: FakeMollieClient,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await assert.rejects(
    () =>
      client.billing.payments.create({
        amount: { currency: "EUR", value: "10.00" },
        description: "denied",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "missing_permission"
  );
  assert.equal(FakeMollieClient.constructs.length, 0);
  assert.equal(FakeMollieClient.calls.length, 0);
});

test("T-BIL-MOLLIE-SDK-ONE-PAGE: list consumes a single async-iterator page", async () => {
  resetFake();
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: { sdk: FakeMollieClient, testKey: "test_sdk_key" },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const page = await client.billing.payments.list({ limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.providerPaymentId, "tr_page_1");
  assert.ok(page.nextCursor);
  assert.equal(FakeMollieClient.calls.length, 1);
});

test("T-BIL-MOLLIE-SDK-CAMEL-ENVELOPE: list reads camelized embedded and links", async () => {
  resetFake();
  class CamelEnvelopeClient {
    customers = unusedMollieResource();
    invoices = unusedMollieResource();
    salesInvoices = unusedMollieResource();
    paymentLinks = unusedMollieResource();
    refunds = unusedMollieResource();
    subscriptions = unusedMollieResource();
    payments = {
      cancel: async () => ({}),
      create: async () => ({}),
      get: async () => ({}),
      list: async () => ({
        embedded: {
          payments: [
            {
              amount: { currency: "EUR", value: "10.00" },
              id: "tr_camel_1",
              resource: "payment",
              status: "open",
            },
          ],
        },
        links: {
          next: { href: "https://api.mollie.com/v2/payments?from=tr_camel_2" },
        },
      }),
    };
  }
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: { sdk: CamelEnvelopeClient, testKey: "test_sdk_key" },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const page = await client.billing.payments.list({ limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.providerPaymentId, "tr_camel_1");
  assert.ok(page.nextCursor);
});

test("T-BIL-MOLLIE-SDK-IDEMPOTENCY: create forwards idempotencyKey to the SDK", async () => {
  resetFake();
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: { sdk: FakeMollieClient, testKey: "test_sdk_key" },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await client.billing.payments.create({
    amount: { currency: "EUR", value: "1.00" },
    description: "idem",
    idempotencyKey: "idem-from-input",
  });
  const create = FakeMollieClient.calls.find(
    (c) => c.method === "payments.create"
  );
  assert.equal(
    (create?.request as { idempotencyKey?: string } | undefined)
      ?.idempotencyKey,
    "idem-from-input"
  );
});

test("T-BIL-MOLLIE-SDK-SCOPED-PROFILE: prefers restricted profileId over defaultProfileId", async () => {
  resetFake();
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_sdk_scoped",
          authority: {
            permissions: { payments: { read: true, write: true } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          defaultProfileId: "pfl_default",
          scope: { kind: "profile", profileId: "pfl_scoped" },
          sdk: FakeMollieClient,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await client.billing.payments.create({
    amount: { currency: "EUR", value: "10.00" },
    description: "scoped-profile",
    idempotencyKey: "idem-sdk-profile",
  });
  assert.equal(FakeMollieClient.constructs[0]?.profileId, "pfl_scoped");
});
