/**
 * Direct BillingRuntime vs Next handler vs HTTP executor vs browser transport.
 * Normalizes transport metadata only; domain results must deepEqual.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../../src/auth/contract/index.ts";
import { createBrowserBillingTransport } from "../../../src/billing/runtime/browser-transport.ts";
import type { AthenaBillingRuntimeDispatch } from "../../../src/billing/runtime/dispatch.ts";
import type { AthenaGatewayClient } from "../../../src/gateway/client.ts";
import { createAthenaBillingHandlers } from "../../../src/next/billing-handlers.ts";
import { getAthenaClientInternals } from "../../../src/runtime/client-internals.ts";
import { normalizeAthenaPrincipal } from "../../../src/runtime/data/principal.ts";
import {
  createAthenaHttpExecutor,
  createAthenaHttpTransportIR,
} from "../../../src/runtime/transport/http.ts";
import { createClient } from "../../../src/v3-client.ts";
import { FetchMollieSdk } from "../../helpers/fetch-mollie-sdk.ts";

const DISCOVERY = {
  athena: true as const,
  capabilities: {
    auth: { available: false },
    delete: true,
    fetch: true,
    insert: true,
    models: "off" as const,
    nestedRelations: false,
    policy: false,
    rawSql: false,
    rpc: false,
    update: true,
  },
  endpoints: {
    billing: "/api/athena/billing",
    data: "/api/athena",
  },
  protocol: { major: 1, minor: 1 },
  runtime: "next-local" as const,
  runtimeImplementation: "athena-js" as const,
};

const RIGHTS = [
  "billing.catalog.read",
  "billing.customers.read",
  "billing.customers.write",
  "billing.payments.read",
  "billing.payments.write",
  "billing.refunds.read",
  "billing.refunds.write",
  "billing.subscriptions.read",
  "billing.subscriptions.write",
  "billing.payment-links.read",
  "billing.payment-links.write",
  "billing.sales-invoices.read",
  "billing.webhooks.read",
  "billing.webhooks.write",
] as const;

function mockTransport(): AthenaGatewayClient {
  const ok = async <T>() =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as T;
  return {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
}

test("billing runtime-parity: Direct BillingRuntime matches handler HTTP executor and browser", async () => {
  const client = createClient({
    auth: false,
    billing: {
      catalog: {
        prices: [
          {
            amount: { currency: "EUR", value: "10.00" },
            id: "price_parity",
            productId: "prod_parity",
          },
        ],
        products: [{ id: "prod_parity", name: "Parity" }],
      },
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_athena_runtime_parity",
          sdk: FetchMollieSdk,
          testKey: "test_athena_runtime_parity",
        },
      },
      testMode: true,
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_runtime_parity",
    gatewayTransport: mockTransport(),
  });
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);
  const runtime = internals.billingRuntime as AthenaBillingRuntimeDispatch;
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    grants: [],
    rights: [...RIGHTS],
    userId: "user-billing-conformance",
  });
  const handlers = createAthenaBillingHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
              session: {
                id: "session-bill",
                userId: "user-billing-conformance",
              },
              user: {
                id: "user-billing-conformance",
                rights: [...RIGHTS],
              },
            }
          : null,
      mode: "athena-session",
    },
    client,
    discoveryDocument: DISCOVERY,
    security: { mode: "trusted" },
  });

  const cookie = `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`;
  const billingFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.mollie.com")) {
      return new Response("{}", { status: 404 });
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const merged = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (!merged.has("cookie")) {
      merged.set("cookie", cookie);
    }
    if (!merged.has("origin")) {
      merged.set("origin", "http://localhost");
    }
    const request = new Request(url, {
      body: init?.body ?? (input instanceof Request ? input.body : undefined),
      headers: merged,
      method,
    });
    return method === "GET" ? handlers.GET(request) : handlers.POST(request);
  }) as typeof fetch;

  const ir = createAthenaHttpTransportIR({
    basePath: "/api/athena/billing",
    domain: "billing",
  });
  const httpExecutor = createAthenaHttpExecutor(ir, {
    fetch: billingFetch,
    headers: { cookie },
  });
  const browser = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: billingFetch,
    headers: { cookie },
  });

  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.mollie.com")) {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(url).pathname;
      if (
        method === "POST" &&
        path.includes("/v2/payments") &&
        !path.includes("/refunds")
      ) {
        return Response.json(
          {
            amount: { currency: "EUR", value: "10.00" },
            createdAt: "2026-01-01T00:00:00+00:00",
            description: "Order",
            id: "tr_created",
            resource: "payment",
            status: "open",
          },
          { status: 201 }
        );
      }
      if (method === "GET" && path.includes("/v2/payments")) {
        return Response.json({
          amount: { currency: "EUR", value: "10.00" },
          createdAt: "2026-01-01T00:00:00+00:00",
          id: "tr_created",
          resource: "payment",
          status: "open",
        });
      }
      return Response.json({ id: "x", resource: "unknown" });
    }
    return billingFetch(input, init);
  }) as typeof fetch;

  try {
    assert.equal("payments" in browser, false);
    assert.equal("webhooks" in browser, false);

    const catalogDirect = await runtime.execute("products.list", {}, principal);
    const catalogPosted = await httpExecutor.postJson("/api/athena/billing", {
      operation: "products.list",
      payload: {},
    });
    const catalogJson = catalogPosted.json as { data?: unknown; ok?: boolean };
    const catalogBrowser = await browser.catalog.products.list({});
    assert.equal(catalogJson.ok, true);
    assert.deepEqual(catalogJson.data, catalogDirect);
    assert.deepEqual(catalogBrowser, catalogDirect);

    const capsDirect = await runtime.execute("getCapabilities", {}, principal);
    const capsPosted = await httpExecutor.postJson("/api/athena/billing", {
      operation: "getCapabilities",
      payload: {},
    });
    const capsJson = capsPosted.json as { data?: unknown; ok?: boolean };
    const capsBrowser = await browser.getCapabilities({});
    assert.equal(capsJson.ok, true);
    assert.deepEqual(capsJson.data, capsDirect);
    assert.deepEqual(capsBrowser, capsDirect);
  } finally {
    globalThis.fetch = previous;
  }
});
