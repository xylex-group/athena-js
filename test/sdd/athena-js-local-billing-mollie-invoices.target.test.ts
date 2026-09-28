/**
 * Target — local Mollie invoices and remaining refund identity.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaBillingCapabilityError,
  AthenaBillingError,
} from "../../src/billing/errors.ts";
import { BillingSecret } from "../../src/billing/runtime/credentials.ts";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { projectBillingWebhook } from "../../src/billing/runtime/local/execute/webhooks.ts";
import { MollieBillingWebhooksPort } from "../../src/billing/runtime/local/providers/mollie/webhooks.ts";
import type {
  BillingProviderExecutionContext,
  BillingProviderWebhook,
} from "../../src/billing/runtime/local/providers/types.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const TEST_TOKEN = "access_athena_mollie_invoices_test";
const LIVE_TOKEN = "access_athena_mollie_invoices_live";
const PROFILE_ID = "pfl_local_1";

const invoiceProvider = {
  authority: {
    permissions: {
      refunds: { read: true, write: true },
      "sales-invoices": { read: true },
      subscriptions: { read: true, write: true },
    },
    source: "declared" as const,
  },
  credentialKind: "organization_access_token" as const,
  liveToken: LIVE_TOKEN,
  profileId: PROFILE_ID,
  sdk: FetchMollieSdk,
  testToken: TEST_TOKEN,
};

const webhookProvider = {
  accessToken: TEST_TOKEN,
  apiMode: "test" as const,
  authority: {
    permissions: { webhooks: { read: true, write: true } },
    source: "declared" as const,
  },
  credentialKind: "advanced_access_token" as const,
  scope: { kind: "organization" as const },
  sdk: FetchMollieSdk,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function mollieInvoicePayload(overrides: Record<string, unknown> = {}) {
  return {
    amountPaid: { currency: "EUR", value: "0.00" },
    createdAt: "2026-08-23T12:00:00+00:00",
    customerId: "cst_local_1",
    description: "August invoice",
    id: "invoice_local_1",
    issuedAt: "2026-08-23T12:00:00+00:00",
    metadata: {},
    paidAt: null,
    profileId: "pfl_local_1",
    resource: "sales-invoice",
    status: "open",
    totalAmount: { currency: "EUR", value: "19.99" },
    ...overrides,
  };
}

function molliePaymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: { currency: "EUR", value: "10.00" },
    id: "tr_local_1",
    profileId: PROFILE_ID,
    resource: "payment",
    status: "paid",
    ...overrides,
  };
}

function mollieRefundPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: { currency: "EUR", value: "5.00" },
    description: "Partial refund",
    id: "re_local_1",
    metadata: {},
    paymentId: "tr_local_1",
    resource: "refund",
    status: "queued",
    ...overrides,
  };
}

async function withMockedFetch<T>(
  handler: typeof fetch,
  run: () => Promise<T>
): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

async function createLocalRuntime(provider = invoiceProvider, testMode = true) {
  const { createLocalBillingRuntime } = await import(
    "../../src/billing/runtime/local/runtime.ts"
  );
  const { createBillingProviderRegistry } = await import(
    "../../src/billing/runtime/local/providers/create-registry.ts"
  );
  const configured = {
    mollie: provider,
  };
  return createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured),
    testMode,
  });
}

test("T-BIL-MOLLIE-WEBHOOKS: local CRUD executes advertised provider operations", async () => {
  const runtime = await createLocalRuntime(webhookProvider);
  const providerWebhook = {
    eventTypes: "payment.paid,payment.failed",
    id: "wh_local_1",
    name: "athena-billing",
    status: "active",
    url: "https://athena.example.com/api/athena/billing/webhook",
    webhookSecret: "secret_local_1",
  };
  const calls: string[] = [];
  const result = await withMockedFetch(
    async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${String(url)}`);
      if (method === "GET") {
        return jsonResponse({
          _embedded: { webhooks: [providerWebhook] },
        });
      }
      if (method === "POST") {
        return jsonResponse(providerWebhook, 201);
      }
      if (method === "PATCH") {
        return jsonResponse({
          ...providerWebhook,
          url: "https://athena.example.com/api/athena/billing/webhook-v2",
        });
      }
      return new Response(null, { status: 204 });
    },
    async () => {
      const page = await runtime.webhooks.list({});
      const created = await runtime.webhooks.create({
        url: providerWebhook.url,
      });
      const updated = await runtime.webhooks.update({
        id: providerWebhook.id,
        url: "https://athena.example.com/api/athena/billing/webhook-v2",
      });
      await runtime.webhooks.delete({ id: providerWebhook.id });
      return { created, page, updated };
    }
  );

  assert.equal(result.page.items[0]?.providerWebhookId, "wh_local_1");
  assert.deepEqual(result.page.items[0]?.eventTypes, [
    "payment.paid",
    "payment.failed",
  ]);
  assert.equal(result.created.providerWebhookId, "wh_local_1");
  assert.equal(
    result.updated.url,
    "https://athena.example.com/api/athena/billing/webhook-v2"
  );
  assert.equal(calls.filter((call) => call.startsWith("GET ")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("POST ")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("PATCH ")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("DELETE ")).length, 1);
});

test("T-BIL-MOLLIE-WEBHOOKS: list forwards limit and continuation cursor", async () => {
  const runtime = await createLocalRuntime(webhookProvider);
  const requests: URL[] = [];
  let page = 0;
  await withMockedFetch(
    async (url) => {
      requests.push(new URL(String(url)));
      page += 1;
      return jsonResponse(
        page === 1
          ? {
              _embedded: { webhooks: [] },
              _links: {
                next: {
                  href: "https://api.mollie.com/v2/webhooks?from=wh_cursor",
                },
              },
            }
          : { _embedded: { webhooks: [] } }
      );
    },
    async () => {
      const first = await runtime.webhooks.list({ limit: 2 });
      const nextCursor = first.nextCursor;
      assert.ok(nextCursor);
      await runtime.webhooks.list({ cursor: nextCursor, limit: 2 });
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.searchParams.get("limit"), "2");
  assert.equal(requests[0]?.searchParams.get("from"), null);
  assert.equal(requests[1]?.searchParams.get("limit"), "2");
  assert.equal(requests[1]?.searchParams.get("from"), "wh_cursor");
});

test("T-BIL-MOLLIE-WEBHOOKS-ENVIRONMENT: list and delete send testmode", async () => {
  const calls: Array<{
    operation: "delete" | "list";
    request: Record<string, unknown>;
  }> = [];
  const noopResource = {
    cancel: async () => undefined,
    create: async () => undefined,
    delete: async () => undefined,
    get: async () => undefined,
    list: async () => undefined,
    update: async () => undefined,
  };
  const client = {
    customers: noopResource,
    paymentLinks: noopResource,
    payments: noopResource,
    refunds: noopResource,
    salesInvoices: noopResource,
    subscriptions: noopResource,
    webhooks: {
      delete: async (request: Record<string, unknown>) => {
        calls.push({ operation: "delete", request });
      },
      list: async (request: Record<string, unknown>) => {
        calls.push({ operation: "list", request });
        return {
          _embedded: {
            webhooks: [
              {
                eventTypes: "payment.paid",
                id: "wh_environment",
                url: "https://example.com/webhook",
              },
            ],
          },
          _links: {},
        };
      },
    },
  };
  const binding = {
    credentials: {
      live: {
        kind: "advanced_access_token" as const,
        secret: new BillingSecret("live-token"),
      },
      test: {
        kind: "advanced_access_token" as const,
        secret: new BillingSecret("test-token"),
      },
    },
    kind: "configured" as const,
    provider: "mollie" as const,
    providerConfig: {
      authority: {
        permissions: { webhooks: { read: true, write: true } },
        scope: { kind: "organization" },
      },
    },
  };
  const port = new MollieBillingWebhooksPort({
    apiBaseUrl: () => "https://api.mollie.com",
    clientFor: () => client,
  } as never);

  for (const testMode of [true, false]) {
    const context: BillingProviderExecutionContext = {
      binding,
      credential: {
        environment: testMode ? "test" : "live",
        fingerprint: `${testMode}`,
        kind: "advanced_access_token",
        provider: "mollie",
        revealForProviderRuntime: () => `${testMode}`,
        slot: "configured",
      },
      environment: {
        name: testMode ? "test" : "live",
        testMode,
      },
      provider: "mollie",
      target: {},
    };
    await port.list(context, { limit: 10 });
    await port.delete(context, { id: "wh_environment" });
  }

  assert.deepEqual(calls, [
    {
      operation: "list",
      request: { from: undefined, limit: 10, testmode: true },
    },
    {
      operation: "delete",
      request: {
        requestBody: { testmode: true },
        webhookId: "wh_environment",
      },
    },
    {
      operation: "list",
      request: { from: undefined, limit: 10, testmode: false },
    },
    {
      operation: "delete",
      request: {
        requestBody: { testmode: false },
        webhookId: "wh_environment",
      },
    },
  ]);
});

test("T-BIL-MOLLIE-WEBHOOKS-ENVIRONMENT: testmode reaches Mollie HTTP in both environments", async () => {
  const provider = { ...webhookProvider, apiMode: "both" as const };
  for (const testMode of [true, false]) {
    const runtime = await createLocalRuntime(provider, testMode);
    await withMockedFetch(
      async (url, init) => {
        const requested = new URL(String(url));
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
          assert.equal(
            requested.searchParams.get("testmode"),
            String(testMode)
          );
          return jsonResponse({ _embedded: { webhooks: [] }, _links: {} });
        }
        assert.equal(method, "DELETE");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          testmode: testMode,
        });
        return jsonResponse(undefined, 204);
      },
      async () => {
        await runtime.webhooks.list({ limit: 10 });
        await runtime.webhooks.delete({ id: "wh_environment" });
      }
    );
  }
});

test("T-BIL-MOLLIE-WEBHOOKS: capabilities follow Mollie read and write permissions", async () => {
  const readOnlyRuntime = await createLocalRuntime({
    ...webhookProvider,
    authority: {
      permissions: { webhooks: { read: true } },
      scope: { kind: "organization" as const },
      source: "declared" as const,
    },
  });
  const writeOnlyRuntime = await createLocalRuntime({
    ...webhookProvider,
    authority: {
      permissions: { webhooks: { write: true } },
      scope: { kind: "organization" as const },
      source: "declared" as const,
    },
  });
  const readOnlyCapabilities = await readOnlyRuntime.getCapabilities({
    provider: "mollie",
  });
  const writeOnlyCapabilities = await writeOnlyRuntime.getCapabilities({
    provider: "mollie",
  });
  assert.equal(
    readOnlyCapabilities.operations["webhooks.list"]?.available,
    true
  );
  assert.equal(
    readOnlyCapabilities.operations["webhooks.create"]?.available,
    false
  );
  assert.equal(
    writeOnlyCapabilities.operations["webhooks.list"]?.available,
    false
  );
  assert.equal(
    writeOnlyCapabilities.operations["webhooks.create"]?.available,
    true
  );
});

test("T-BIL-MOLLIE-WEBHOOKS: empty event types fail as invalid requests before dispatch", async () => {
  const runtime = await createLocalRuntime(webhookProvider);
  let dispatches = 0;
  await withMockedFetch(
    async () => {
      dispatches += 1;
      return jsonResponse({});
    },
    async () => {
      await assert.rejects(
        runtime.webhooks.create({
          eventTypes: [],
          url: "https://athena.example.com/webhook",
        }),
        (error: unknown) =>
          error instanceof AthenaBillingError &&
          error.code === "ATHENA_BILLING_INVALID_REQUEST" &&
          error.status === 400
      );
      await assert.rejects(
        runtime.webhooks.update({
          eventTypes: [],
          id: "wh_local_1",
        }),
        (error: unknown) =>
          error instanceof AthenaBillingError &&
          error.code === "ATHENA_BILLING_INVALID_REQUEST" &&
          error.status === 400
      );
    }
  );
  assert.equal(dispatches, 0);
});

test("T-BIL-MOLLIE-WEBHOOKS: default idempotency keys include webhook identity", async () => {
  const runtime = await createLocalRuntime(webhookProvider);
  const idempotencyKeys: string[] = [];
  await withMockedFetch(
    async (_url, init) => {
      idempotencyKeys.push(
        new Headers(init?.headers).get("idempotency-key") ?? ""
      );
      return jsonResponse(
        {
          eventTypes: "payment.paid",
          id: "wh_local_1",
          status: "active",
          url: "https://athena.example.com/webhook",
        },
        201
      );
    },
    async () => {
      await runtime.webhooks.create({
        eventTypes: ["payment.paid"],
        url: "https://athena.example.com/webhook",
      });
      await runtime.webhooks.create({
        eventTypes: ["payment.failed"],
        url: "https://athena.example.com/webhook",
      });
    }
  );
  assert.equal(idempotencyKeys.length, 2);
  assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
});

test("T-BIL-MOLLIE-WEBHOOKS: projection preserves the provider identity", () => {
  const webhook: BillingProviderWebhook = {
    environment: "live",
    eventTypes: ["payment.paid"],
    id: "wh_stripe_1",
    provider: "stripe",
    status: "active",
    url: "https://example.test/webhook",
  };
  assert.equal(projectBillingWebhook(webhook).provider, "stripe");
});

test("T-BIL-MOLLIE-WEBHOOKS-UNSUPPORTED: get and test remain unsupported", async () => {
  const runtime = await createLocalRuntime(webhookProvider);
  for (const [operation, run] of [
    ["webhooks.get", () => runtime.webhooks.get({ id: "wh_local_1" })],
    ["webhooks.test", () => runtime.webhooks.test({ id: "wh_local_1" })],
  ] as const) {
    await assert.rejects(
      run,
      (error: unknown) =>
        error instanceof AthenaBillingCapabilityError &&
        error.operation === operation &&
        error.reason === "unsupported_operation",
      operation
    );
  }
});

test("T-BIL-MOLLIE-INVOICE-GET: canonical invoice", async () => {
  const runtime = await createLocalRuntime();
  const invoice = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
      assert.match(
        String(url),
        /\/v2\/sales-invoices\/invoice_local_1(?:\?testmode=true)?$/
      );
      return jsonResponse(mollieInvoicePayload());
    },
    () => runtime.invoices.get({ invoiceId: "invoice_local_1" })
  );
  assert.equal(invoice.provider, "mollie");
  assert.equal(invoice.providerInvoiceId, "invoice_local_1");
  assert.equal(invoice.providerCustomerId, "cst_local_1");
  assert.equal(invoice.status, "open");
  assert.deepEqual(invoice.amount, { currency: "EUR", value: "19.99" });
});

test("T-BIL-MOLLIE-INVOICE-LIST: canonical page", async () => {
  const runtime = await createLocalRuntime();
  const page = await withMockedFetch(
    async (url) => {
      assert.match(String(url), /\/v2\/sales-invoices/);
      return jsonResponse({
        _embedded: {
          sales_invoices: [mollieInvoicePayload()],
        },
      });
    },
    () => runtime.invoices.list({})
  );
  assert.equal(page.items[0]?.providerInvoiceId, "invoice_local_1");
  assert.equal(page.items[0]?.status, "open");
});

test("T-BIL-MOLLIE-INVOICE-STATUS: strict status mapping", async () => {
  const { projectMollieInvoiceStatus } = await import(
    "../../src/billing/runtime/local/providers/mollie/projection/invoice.ts"
  );
  const { AthenaBillingProviderRequestError } = await import(
    "../../src/billing/errors.ts"
  );
  assert.equal(projectMollieInvoiceStatus("draft"), "draft");
  assert.equal(projectMollieInvoiceStatus("issuing"), "open");
  assert.equal(projectMollieInvoiceStatus("issued"), "open");
  assert.equal(projectMollieInvoiceStatus("open"), "open");
  assert.equal(projectMollieInvoiceStatus("pending-payment"), "open");
  assert.equal(projectMollieInvoiceStatus("paid"), "paid");
  assert.equal(projectMollieInvoiceStatus("cancelled"), "void");
  assert.equal(projectMollieInvoiceStatus("canceled"), "void");
  assert.equal(projectMollieInvoiceStatus("failed"), "uncollectible");
  assert.throws(
    () => projectMollieInvoiceStatus("mystery"),
    (error: unknown) =>
      error instanceof AthenaBillingProviderRequestError &&
      error.kind === "serialization"
  );
});

test("T-BIL-MOLLIE-INVOICE-STATUS-FIXTURES: get projects Mollie sales-invoice states", async () => {
  const runtime = await createLocalRuntime();
  const cases = [
    ["draft", "draft"],
    ["issuing", "open"],
    ["issued", "open"],
    ["pending-payment", "open"],
    ["paid", "paid"],
    ["failed", "uncollectible"],
    ["cancelled", "void"],
  ] as const;
  for (const [providerStatus, canonical] of cases) {
    const invoice = await withMockedFetch(
      async () =>
        jsonResponse(mollieInvoicePayload({ status: providerStatus })),
      () => runtime.invoices.get({ invoiceId: "invoice_local_1" })
    );
    assert.equal(invoice.status, canonical, providerStatus);
  }
});

test("T-BIL-MOLLIE-REFUND-GET: compound identity", async () => {
  const runtime = await createLocalRuntime();
  const refund = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
      const href = String(url);
      if (/\/v2\/payments\/tr_local_1(?:\?|$)/.test(href)) {
        return jsonResponse(molliePaymentPayload());
      }
      assert.match(
        href,
        /\/v2\/payments\/tr_local_1\/refunds\/re_local_1(?:\?testmode=true)?$/
      );
      return jsonResponse(mollieRefundPayload());
    },
    () =>
      runtime.refunds.get({
        paymentId: "tr_local_1",
        refundId: "re_local_1",
      })
  );
  assert.equal(refund.providerRefundId, "re_local_1");
  assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-REFUND-CANCEL: DELETE 204 then GET reconstructs refund", async () => {
  const runtime = await createLocalRuntime();
  const methods: string[] = [];
  const refund = await withMockedFetch(
    async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const href = String(url);
      if (/\/v2\/payments\/tr_local_1(?:\?|$)/.test(href)) {
        methods.push(`PAYMENT_${method}`);
        return jsonResponse(molliePaymentPayload());
      }
      methods.push(method);
      assert.match(
        href,
        /\/v2\/payments\/tr_local_1\/refunds\/re_local_1(?:\?testmode=true)?$/
      );
      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      assert.equal(method, "GET");
      return jsonResponse(mollieRefundPayload({ status: "canceled" }));
    },
    () =>
      runtime.refunds.cancel({
        paymentId: "tr_local_1",
        refundId: "re_local_1",
      })
  );
  assert.deepEqual(methods, ["PAYMENT_GET", "DELETE", "PAYMENT_GET", "GET"]);
  assert.equal(refund.status, "canceled");
  assert.equal(refund.providerRefundId, "re_local_1");
  assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-REFUND-CANCEL-GONE: 204 then GET 404 stays canceled", async () => {
  const runtime = await createLocalRuntime();
  const refund = await withMockedFetch(
    async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (/\/v2\/payments\/tr_local_1(?:\?|$)/.test(String(url))) {
        return jsonResponse(molliePaymentPayload());
      }
      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(
        {
          detail: "No refund exists with token re_local_1.",
          status: 404,
          title: "Not Found",
        },
        404
      );
    },
    () =>
      runtime.refunds.cancel({
        paymentId: "tr_local_1",
        refundId: "re_local_1",
      })
  );
  assert.equal(refund.status, "canceled");
  assert.equal(refund.provider, "mollie");
  assert.equal(refund.providerRefundId, "re_local_1");
  assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-CAPS-OPS: operation-level truth", async () => {
  const runtime = await createLocalRuntime();
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.deepEqual(capabilities.ports, {
    checkout: false,
    customers: true,
    invoices: true,
    paymentLinks: true,
    payments: true,
    prices: false,
    products: false,
    refunds: true,
    relations: false,
    self: false,
    subscriptions: true,
    webhooks: true,
  });
  assert.equal(
    capabilities.operations["subscriptions.create"]?.available,
    true
  );
  assert.equal(capabilities.operations["subscriptions.get"]?.available, true);
  assert.equal(capabilities.operations["subscriptions.list"]?.available, true);
  assert.equal(
    capabilities.operations["subscriptions.update"]?.available,
    true
  );
  assert.equal(
    capabilities.operations["subscriptions.cancel"]?.available,
    true
  );
  assert.equal(capabilities.operations["invoices.get"]?.available, true);
  assert.equal(capabilities.operations["invoices.list"]?.available, true);
  assert.equal(capabilities.operations["refunds.get"]?.available, true);
  assert.equal(capabilities.operations["refunds.cancel"]?.available, true);
  assert.equal(capabilities.operations["webhooks.create"]?.available, false);
  assert.equal(capabilities.operations["webhooks.list"]?.available, false);
  assert.equal(capabilities.operations["products.list"]?.available, false);
  assert.equal(capabilities.operations["prices.list"]?.available, false);
  assert.equal(capabilities.operations["checkout.create"]?.available, false);
});

test("T-BIL-MOLLIE-INVOICE-PROFILE: requested profileId fail-closes without Mollie HTTP", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: TEST_TOKEN,
          apiMode: "test",
          authority: {
            permissions: { "sales-invoices": { read: true } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          scope: { kind: "organization" },
          sdk: FetchMollieSdk,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      "invoices.get",
      () =>
        client.billing.invoices.get({
          invoiceId: "invoice_local_1",
          profileId: "pfl_B",
        }),
    ],
    [
      "invoices.list",
      () => client.billing.invoices.list({ profileId: "pfl_B" }),
    ],
  ];
  for (const [operation, run] of cases) {
    await assert.rejects(
      () =>
        withMockedFetch(async () => {
          throw new Error(`${operation} must not call Mollie`);
        }, run),
      (error: unknown) =>
        error instanceof AthenaBillingCapabilityError &&
        error.operation === operation &&
        error.reason === "unsupported_operation",
      operation
    );
  }
});

test("T-BIL-MOLLIE-INVOICE-API-KEY: standard keys reach Mollie invoice reads", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          credentialKind: "api_key",
          profileId: PROFILE_ID,
          sdk: FetchMollieSdk,
          testKey: "test_athena_mollie_invoices",
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const capabilities = await client.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(capabilities.operations["invoices.get"]?.available, true);
  assert.equal(capabilities.operations["invoices.list"]?.available, true);

  const invoice = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
      assert.match(
        String(url),
        /\/v2\/sales-invoices\/invoice_local_1(?:\?testmode=true)?$/
      );
      return jsonResponse(mollieInvoicePayload());
    },
    () => client.billing.invoices.get({ invoiceId: "invoice_local_1" })
  );
  assert.equal(invoice.providerInvoiceId, "invoice_local_1");
});

test("T-BIL-LOCAL-NO-HTTP: invoices stay on Mollie", async () => {
  const urls: string[] = [];
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: invoiceProvider,
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await withMockedFetch(
    async (url) => {
      urls.push(String(url));
      return jsonResponse({
        _embedded: { sales_invoices: [mollieInvoicePayload()] },
      });
    },
    () => client.billing.invoices.list({})
  );
  assert.equal(
    urls.some((url) => url.includes("/billing/v1")),
    false
  );
  assert.ok(urls.some((url) => url.includes("/v2/sales-invoices")));
});
