import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { createBillingRuntimeFacade } from "../../src/billing/runtime/facade.ts";
import { createClientWithLocalBilling } from "../../src/billing/runtime/local/materialize.ts";
import type { AthenaBillingRuntimeDispatch } from "../../src/billing/runtime/dispatch.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
  bindPostgresRuntime,
  type AthenaPostgresRuntime,
} from "../../src/postgres/owned-runtime.ts";
import { materializeBilling } from "../../src/runtime/materializers/billing.ts";
import { resolveRuntimePlan } from "../../src/runtime/plan/resolve.ts";
import { validateRuntimePlan } from "../../src/runtime/plan/validate.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

test("Billing runtime identity is resolved into the Runtime Plan", () => {
  const plan = resolveRuntimePlan(
    {
      billing: {
        providers: {
          mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
        },
      },
      key: "ak_test",
      url: "https://athena.example",
    },
    { environment: "node", trustedNode: true }
  );

  assert.equal(plan.billing.kind, "local");
  assert.equal(plan.billing.source, "configured-provider");
  assert.equal("testKey" in plan.billing, false);
});

test("Billing plan derives the unified root from Athena environment URLs", () => {
  const plan = resolveRuntimePlan(
    {
      env: { ATHENA_URL: "https://athena.example" },
    },
    { environment: "node", trustedNode: true }
  );

  assert.equal(plan.billing.kind, "remote");
  assert.equal(plan.billing.source, "unified-root");
});

test("Billing plan validation rejects remote execution with local providers", () => {
  const plan = resolveRuntimePlan(
    {
      billing: {
        mode: "remote",
        providers: {
          mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
        },
      },
      key: "ak_test",
      url: "https://athena.example",
    },
    { environment: "node", trustedNode: true }
  );

  assert.throws(
    () => validateRuntimePlan(plan),
    /cannot be combined with billing\.providers/
  );
});

test("Billing materialization returns one binding owned by the selected plan", () => {
  const config = {
    billing: {
      mode: "remote" as const,
      url: "https://billing.example",
    },
    key: "ak_test",
    url: "https://athena.example",
  };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);

  assert.equal(binding.kind, "remote");
  assert.equal(binding.registry, undefined);
  assert.equal(binding.module != null, true);
});

test("Billing materialization creates the local facade before bootstrap", () => {
  const config = {
    billing: {
      providers: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
      },
    },
    key: "ak_test",
  };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);

  assert.equal(binding.kind, "local");
  assert.equal(binding.runtime != null, true);
  assert.equal(binding.registry != null, true);
  assert.equal(typeof binding.module.payments.create, "function");
});

test("local Billing keeps every legacy flat member callable", () => {
  const config = {
    billing: {
      providers: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
      },
    },
    key: "ak_test",
  };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);
  const legacyMembers = [
    "cancelPayment",
    "cancelRefund",
    "cancelSubscription",
    "createCheckout",
    "createConnection",
    "createCustomer",
    "createPayment",
    "createPaymentLink",
    "createRefund",
    "createSubscription",
    "createWebhook",
    "deleteConnection",
    "deleteCustomer",
    "deletePaymentLink",
    "deleteWebhook",
    "getConnection",
    "getCustomer",
    "getDebugBilling",
    "getInvoice",
    "getPayment",
    "getPaymentLink",
    "getRefund",
    "getSubscription",
    "getWebhook",
    "ingestProviderWebhook",
    "listConnections",
    "listCustomers",
    "listGrants",
    "listInvoices",
    "listPaymentLinks",
    "listPayments",
    "listPrices",
    "listProducts",
    "listProviders",
    "listRefunds",
    "listSinkHelpers",
    "listSubscriptions",
    "listWebhookEvents",
    "listWebhooks",
    "provisionWebhookSinks",
    "reconcileDocument",
    "testWebhook",
    "updateConnection",
    "updateCustomer",
    "updatePaymentLink",
    "updateSubscription",
    "updateWebhook",
  ] as const;

  for (const member of legacyMembers) {
    assert.equal(
      typeof (binding.module as unknown as Record<string, unknown>)[member],
      "function",
      member
    );
  }
});

test("flat subscription compatibility rejects identities without customerId", async () => {
  const config = {
    billing: {
      providers: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
      },
    },
    key: "ak_test",
  };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);

  await assert.rejects(
    () =>
      binding.module.getSubscription("sub_1", {
        connectionId: "connection_1",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "subscriptions.get" &&
      error.reason === "unsupported_operation"
  );
});

test("local Billing resolves webhook ownership from the client fallback", () => {
  const config = {
    app: { url: "https://app.example.com" },
    billing: {
      ingestion: { webhooks: { enabled: true } },
      providers: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
      },
    },
    client: "my-app",
    key: "ak_test",
  };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);

  assert.equal(binding.kind, "local");
  assert.equal(binding.webhookApplicationId, "my-app");
});

test("local Billing update adapters preserve the canonical ID and input", async () => {
  const calls: Array<{ operation: string; payload: unknown }> = [];
  const runtime = {
    customers: {
      update: async (payload: unknown) => {
        calls.push({ operation: "customers.update", payload });
        return { ok: true };
      },
    },
    paymentLinks: {
      update: async (payload: unknown) => {
        calls.push({ operation: "paymentLinks.update", payload });
        return { ok: true };
      },
    },
  } as unknown as AthenaBillingRuntimeDispatch;
  const billing = createBillingRuntimeFacade(runtime);

  await billing.updateCustomer("customer_1", {
    connectionId: "connection_1",
    name: "Ada",
  });
  await billing.updatePaymentLink("link_1", {
    connectionId: "connection_1",
    description: "Updated",
  });

  assert.deepEqual(calls, [
    {
      operation: "customers.update",
      payload: {
        connectionId: "connection_1",
        id: "customer_1",
        name: "Ada",
      },
    },
    {
      operation: "paymentLinks.update",
      payload: {
        connectionId: "connection_1",
        description: "Updated",
        id: "link_1",
      },
    },
  ]);
});

test("Cloudflare local Billing binds SQL before client assembly", async () => {
  const gatewayTransport = {} as AthenaGatewayClient;
  const postgresRuntime = {
    close: async () => undefined,
    getPool: async () => {
      throw new Error("not used");
    },
    getPoolManager: async () => {
      throw new Error("not used");
    },
    inspectPool: async () => {
      throw new Error("not used");
    },
    ownership: "borrowed" as const,
    query: async () => ({ rows: [] }),
    transaction: async <T>(
      fn: (runtime: AthenaPostgresRuntime) => Promise<T>
    ) => fn(postgresRuntime as AthenaPostgresRuntime),
  } as unknown as AthenaPostgresRuntime;
  bindPostgresRuntime(gatewayTransport, postgresRuntime);

  const client = createClientWithLocalBilling({
    billing: {
      providers: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_key" },
      },
    },
    gatewayTransport,
    key: "ak_test",
  });
  const capabilities = await client.billing.getCapabilities({
    connectionId: "connection_1",
  });

  assert.equal(capabilities.ports.self, true);
});

test("remote Billing merges root and Billing-specific headers", async () => {
  const config = {
    billing: {
      headers: {
        "x-billing-header": "billing",
        "x-shared-header": "billing",
      },
      mode: "remote" as const,
      url: "https://billing.example",
    },
    headers: {
      "x-root-header": "root",
      "x-shared-header": "root",
    },
    key: "ak_test",
  };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);
  const originalFetch = globalThis.fetch;
  let requestHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    assert.equal(binding.kind, "remote");
    await binding.module.getCapabilities({ connectionId: "connection_1" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestHeaders?.get("x-root-header"), "root");
  assert.equal(requestHeaders?.get("x-billing-header"), "billing");
  assert.equal(requestHeaders?.get("x-shared-header"), "billing");
});

test("Billing materialization exposes an explicit unavailable identity", async () => {
  const config = { key: "ak_test" };
  const plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  });
  const binding = materializeBilling(config, plan);

  assert.equal(plan.billing.kind, "unavailable");
  assert.equal(binding.kind, "unavailable");
  assert.throws(
    () => binding.module.getCapabilities({}),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_SERVICE_NOT_CONFIGURED"
  );
});
