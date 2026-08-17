import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaBillingError,
  billingSdkManifest,
  createBillingModule,
} from "../src/billing/module.ts";
import { AthenaConfigurationError, createClient } from "../src/index.ts";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_NAME = "default";
const RESOURCE_ID = "res_1";
const REF = { connectionId: CONNECTION_ID };

function createMockResponse(
  body: unknown,
  status = 200,
  contentType = "application/json"
) {
  if (typeof body === "string") {
    return new Response(body, {
      headers: { "content-type": contentType },
      status,
    });
  }
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function pathTemplateFromUrl(pathname: string): string {
  let path = pathname;
  path = path.replace(
    `/admin/billing/clients/${CLIENT_NAME}/connections/${CONNECTION_ID}/reconcile`,
    "/admin/billing/clients/{client_name}/connections/{connection_id}/reconcile"
  );
  path = path.replace(
    `/admin/billing/clients/${CLIENT_NAME}/connections/${CONNECTION_ID}`,
    "/admin/billing/clients/{client_name}/connections/{connection_id}"
  );
  path = path.replace(
    `/admin/billing/clients/${CLIENT_NAME}/connections`,
    "/admin/billing/clients/{client_name}/connections"
  );
  path = path.replace(
    `/admin/billing/clients/${CLIENT_NAME}/webhook-events`,
    "/admin/billing/clients/{client_name}/webhook-events"
  );
  path = path.replace(
    `/admin/billing/clients/${CLIENT_NAME}/webhook-sinks/provision`,
    "/admin/billing/clients/{client_name}/webhook-sinks/provision"
  );
  path = path.replace(
    `/billing/providers/mollie/clients/${CLIENT_NAME}/connections/${CONNECTION_ID}/webhook`,
    "/billing/providers/{provider}/clients/{client_name}/connections/{connection_id}/webhook"
  );
  // Resource id segments (must run after more-specific admin paths)
  path = path.replace(/\/customers\/[^/]+(\/|$)/, "/customers/{id}$1");
  path = path.replace(
    /\/payments\/[^/]+(\/cancel)?(\/|$)/,
    (_m, cancel, trail) => `/payments/{id}${cancel ?? ""}${trail ?? ""}`
  );
  path = path.replace(/\/payment-links\/[^/]+(\/|$)/, "/payment-links/{id}$1");
  path = path.replace(
    /\/refunds\/[^/]+(\/cancel)?(\/|$)/,
    (_m, cancel, trail) => `/refunds/{id}${cancel ?? ""}${trail ?? ""}`
  );
  path = path.replace(
    /\/subscriptions\/[^/]+(\/cancel)?(\/|$)/,
    (_m, cancel, trail) => `/subscriptions/{id}${cancel ?? ""}${trail ?? ""}`
  );
  path = path.replace(/\/invoices\/[^/]+(\/|$)/, "/invoices/{id}$1");
  path = path.replace(
    /\/webhooks\/[^/]+(\/test)?(\/|$)/,
    (_m, testSeg, trail) => `/webhooks/{id}${testSeg ?? ""}${trail ?? ""}`
  );
  return path;
}

test("billingSdkManifest METHOD+path set is non-empty and unique", () => {
  const routes = billingSdkManifest.methods.map(({ method, path }) =>
    routeKey(method, path)
  );
  assert.ok(routes.length >= 40);
  assert.equal(new Set(routes).size, routes.length);
  assert.ok(routes.includes("GET /billing/v1/products"));
  assert.ok(routes.includes("GET /billing/v1/prices"));
});

test("createBillingModule maps every billingSdkManifest method to the correct METHOD+path", async () => {
  const calls: Array<{ method: string; pathTemplate: string; url: string }> =
    [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      method,
      pathTemplate: pathTemplateFromUrl(parsed.pathname),
      url: String(url),
    });
    if (parsed.pathname === "/debug/billing") {
      return createMockResponse("<html>billing debug</html>", 200, "text/html");
    }
    return createMockResponse({
      data: { ok: true },
      message: "ok",
      status: "success",
    });
  };

  const billing = createBillingModule({
    apiKey: "admin-key",
    baseUrl: "https://athena.example.com",
    client: CLIENT_NAME,
    fetchImpl,
  });

  await billing.getCapabilities(REF);
  await billing.createCheckout({ connectionId: CONNECTION_ID });
  await billing.listProducts(REF);
  await billing.listPrices({ ...REF, productId: "prod_1" });
  await billing.listCustomers(REF);
  await billing.createCustomer({
    ...REF,
    email: "a@example.com",
    idempotencyKey: "idem-1",
  });
  await billing.getCustomer(RESOURCE_ID, REF);
  await billing.updateCustomer(RESOURCE_ID, { ...REF, name: "Ada" });
  await billing.deleteCustomer(RESOURCE_ID, REF);
  await billing.listPayments({ ...REF, source: "provider" });
  await billing.createPayment({ amount: 100, connectionId: CONNECTION_ID });
  await billing.getPayment(RESOURCE_ID, REF);
  await billing.cancelPayment(RESOURCE_ID, REF);
  await billing.listPaymentLinks(REF);
  await billing.createPaymentLink({ connectionId: CONNECTION_ID });
  await billing.getPaymentLink(RESOURCE_ID, REF);
  await billing.updatePaymentLink(RESOURCE_ID, { description: "updated" });
  await billing.deletePaymentLink(RESOURCE_ID, REF);
  await billing.listRefunds(REF);
  await billing.createRefund({ connectionId: CONNECTION_ID });
  await billing.getRefund(RESOURCE_ID, REF);
  await billing.cancelRefund(RESOURCE_ID, REF);
  await billing.listSubscriptions(REF);
  await billing.createSubscription({ connectionId: CONNECTION_ID });
  await billing.getSubscription(RESOURCE_ID, REF);
  await billing.updateSubscription(RESOURCE_ID, { metadata: {} });
  await billing.cancelSubscription(RESOURCE_ID, REF);
  await billing.listInvoices(REF);
  await billing.getInvoice(RESOURCE_ID, REF);
  await billing.listWebhooks(REF);
  await billing.createWebhook(REF, { url: "https://hooks.example.com" });
  await billing.getWebhook(RESOURCE_ID, REF);
  await billing.updateWebhook(RESOURCE_ID, REF, { enabled: true });
  await billing.deleteWebhook(RESOURCE_ID, REF);
  await billing.testWebhook(RESOURCE_ID, REF);
  await billing.listConnections(CLIENT_NAME);
  await billing.createConnection(CLIENT_NAME, {
    ownerId: "org_1",
    ownerKind: "organization",
    provider: "mollie",
    providerAccountId: "acc_1",
  });
  await billing.getConnection(CLIENT_NAME, CONNECTION_ID);
  await billing.updateConnection(CLIENT_NAME, CONNECTION_ID, {
    status: "active",
  });
  await billing.deleteConnection(CLIENT_NAME, CONNECTION_ID);
  await billing.reconcileDocument(CLIENT_NAME, CONNECTION_ID, {
    resourceId: "tr_1",
    resourceKind: "payment",
  });
  await billing.listWebhookEvents(CLIENT_NAME);
  await billing.provisionWebhookSinks(CLIENT_NAME, { targetSchema: "public" });
  await billing.listGrants();
  await billing.listProviders();
  await billing.listSinkHelpers({ targetSchema: "public" });
  await billing.ingestProviderWebhook({
    body: "id=tr_1",
    clientName: CLIENT_NAME,
    connectionId: CONNECTION_ID,
    provider: "mollie",
    signatureHeaders: { "x-mollie-signature": "sig" },
  });
  await billing.getDebugBilling("secret");

  const exercised = new Set(
    calls.map((call) => routeKey(call.method, call.pathTemplate))
  );
  const expected = new Set(
    billingSdkManifest.methods.map(({ method, path }) => routeKey(method, path))
  );

  const missing = [...expected]
    .filter((key) => !exercised.has(key))
    .sort((a, b) => String(a).localeCompare(String(b)));
  const extra = [...exercised]
    .filter((key) => !expected.has(key))
    .sort((a, b) => String(a).localeCompare(String(b)));

  assert.deepEqual(
    missing,
    [],
    `missing manifest routes: ${missing.join(", ")}`
  );
  assert.deepEqual(extra, [], `unexpected routes: ${extra.join(", ")}`);
  assert.equal(calls.length, billingSdkManifest.methods.length);

  const pricesCall = calls.find(
    (call) => call.pathTemplate === "/billing/v1/prices"
  );
  assert.ok(pricesCall);
  assert.match(pricesCall.url, /productId=prod_1/);
  assert.match(pricesCall.url, /connectionId=/);

  const debugCall = calls.find(
    (call) => call.pathTemplate === "/debug/billing"
  );
  assert.ok(debugCall);
  assert.match(debugCall.url, /jwt_secret=secret/);
});

test("createBillingModule maps live routes to correct method, path, query, and body", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    const pathname = new URL(String(url)).pathname;

    if (pathname === "/billing/v1/capabilities") {
      return createMockResponse({
        data: { ports: { payments: true } },
        message: "ok",
        status: "success",
      });
    }
    if (
      pathname === "/billing/v1/customers" &&
      (init?.method ?? "GET") === "POST"
    ) {
      return createMockResponse({
        data: { id: "cst_1" },
        message: "ok",
        status: "success",
      });
    }
    if (pathname === "/billing/v1/payments") {
      return createMockResponse({
        data: [{ id: "tr_1" }],
        message: "ok",
        status: "success",
      });
    }
    if (
      pathname ===
      `/admin/billing/clients/default/connections/${CONNECTION_ID}/reconcile`
    ) {
      return createMockResponse({
        data: { upsert: { table: "billing_payments" } },
        message: "ok",
        status: "success",
      });
    }
    if (
      pathname ===
      `/billing/providers/mollie/clients/default/connections/${CONNECTION_ID}/webhook`
    ) {
      return createMockResponse({
        data: { eventLogId: "evt_1" },
        message: "ok",
        status: "success",
      });
    }
    if (pathname === "/debug/billing") {
      return createMockResponse("<html>billing debug</html>", 200, "text/html");
    }
    if (pathname === "/admin/billing/providers") {
      return createMockResponse({ data: [], message: "ok", status: "success" });
    }
    return createMockResponse({ data: null, message: "ok", status: "success" });
  };

  const billing = createBillingModule({
    apiKey: "admin-key",
    baseUrl: "https://athena.example.com",
    client: "default",
    fetchImpl,
  });

  const capabilities = await billing.getCapabilities({
    connectionId: CONNECTION_ID,
  });
  assert.deepEqual(capabilities, { ports: { payments: true } });

  const customer = await billing.createCustomer({
    connectionId: CONNECTION_ID,
    email: "user@example.com",
    idempotencyKey: "idem-1",
  });
  assert.deepEqual(customer, { id: "cst_1" });

  const payments = await billing.listPayments({
    connectionId: CONNECTION_ID,
    source: "provider",
  });
  assert.deepEqual(payments, [{ id: "tr_1" }]);

  const reconcile = await billing.reconcileDocument("default", CONNECTION_ID, {
    resourceId: "tr_1",
    resourceKind: "payment",
  });
  assert.deepEqual(reconcile, { upsert: { table: "billing_payments" } });

  const webhook = await billing.ingestProviderWebhook({
    body: "id=tr_1",
    clientName: "default",
    connectionId: CONNECTION_ID,
    provider: "mollie",
    signatureHeaders: { "x-mollie-signature": "sig" },
  });
  assert.deepEqual(webhook, { eventLogId: "evt_1" });

  const debugHtml = await billing.getDebugBilling("secret");
  assert.equal(debugHtml, "<html>billing debug</html>");

  await billing.listProviders();

  const byPath = (path: string) =>
    calls.find((call) => new URL(call.url).pathname === path);
  const capabilityCall = byPath("/billing/v1/capabilities");
  assert.ok(capabilityCall);
  assert.equal(capabilityCall?.init?.method ?? "GET", "GET");
  assert.match(
    capabilityCall?.url,
    /connectionId=11111111-1111-1111-1111-111111111111/
  );
  const capabilityHeaders = capabilityCall?.init?.headers as Record<
    string,
    string
  >;
  assert.equal(capabilityHeaders["X-Athena-Key"], "admin-key");

  const createCustomerCall = byPath("/billing/v1/customers");
  assert.equal(createCustomerCall?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(createCustomerCall?.init?.body)), {
    connectionId: CONNECTION_ID,
    email: "user@example.com",
    idempotencyKey: "idem-1",
    metadata: {},
  });

  const listPaymentsCall = byPath("/billing/v1/payments");
  assert.match(String(listPaymentsCall?.url ?? ""), /source=provider/);

  const reconcileCall = byPath(
    `/admin/billing/clients/default/connections/${CONNECTION_ID}/reconcile`
  );
  assert.equal(reconcileCall?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(reconcileCall?.init?.body)), {
    resourceId: "tr_1",
    resourceKind: "payment",
  });

  const webhookCall = byPath(
    `/billing/providers/mollie/clients/default/connections/${CONNECTION_ID}/webhook`
  );
  assert.equal(webhookCall?.init?.method, "POST");
  assert.equal(webhookCall?.init?.body, "id=tr_1");

  const debugCall = byPath("/debug/billing");
  assert.match(String(debugCall?.url ?? ""), /jwt_secret=secret/);
});

test("createBillingModule surfaces AthenaBillingError for non-OK responses", async () => {
  const billing = createBillingModule({
    apiKey: "admin-key",
    baseUrl: "https://athena.example.com",
    fetchImpl: async () =>
      createMockResponse(
        { message: "Billing connection not found", status: "error" },
        404
      ),
  });

  await assert.rejects(
    () => billing.getConnection("default", CONNECTION_ID),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.status, 404);
      assert.equal(
        error.endpoint,
        `/admin/billing/clients/default/connections/${CONNECTION_ID}`
      );
      assert.equal(error.method, "GET");
      assert.equal(error.message, "Billing connection not found");
      return true;
    }
  );
});

test("createClient attaches billing namespace using the resolved db/root URL by default", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return createMockResponse({ data: { ports: {} }, status: "success" });
  };

  try {
    const client = createClient({
      key: "root-key",
      url: "https://athena.example.com",
    });

    assert.equal(typeof client.billing, "object");
    assert.equal(typeof client.billing.getCapabilities, "function");

    await client.billing.getCapabilities({ connectionId: CONNECTION_ID });

    assert.equal(calls.length, 1);
    // Billing inherits the resolved db service base (root + /db) when billing.url is omitted.
    assert.match(
      calls[0].url,
      /^https:\/\/athena\.example\.com\/db\/billing\/v1\/capabilities/
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers["X-Athena-Key"], "root-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient billing.url override wins over root URL", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return createMockResponse({ data: [], status: "success" });
  };

  try {
    const client = createClient({
      billing: { url: "https://billing.override.example.com" },
      key: "root-key",
      url: "https://athena.example.com",
    });

    await client.billing.listProviders();
    assert.equal(calls.length, 1);
    assert.match(
      calls[0],
      /^https:\/\/billing\.override\.example\.com\/admin\/billing\/providers/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient without root/db/billing URL leaves billing unconfigured", () => {
  const client = createClient({
    auth: { url: "https://auth.example.com/api/auth" },
    key: "key",
  });

  assert.throws(
    () => {
      // Proxy apply triggers service guard for unconfigured billing.
      void (
        client.billing as unknown as { getCapabilities: () => unknown }
      ).getCapabilities();
    },
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_SERVICE_NOT_CONFIGURED" &&
      error.service === "billing"
  );
});
