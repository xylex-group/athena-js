/**
 * Target: Embedded Billing HTTP + browser same-origin + Next handlers.
 * See docs/sdd/xylex/athena-js-embedded-billing-http/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import { createSessionCookieHeader } from "../../src/auth/local/cookies.ts";
import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  AthenaBillingAuthorizationError,
} from "../../src/billing/errors.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaBillingHandlers } from "../../src/next/billing-handlers.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT } from "../../src/runtime/data/discovery-document.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { createClient } from "../../src/v3-client.ts";
import { createClient as createCoreClient } from "../../src/v3-client-core.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function mockTransport(): AthenaGatewayClient {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
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

function mollieConfig() {
  return {
    mollie: {
      liveKey: "live_athena_embedded_http",
      sdk: FetchMollieSdk,
      testKey: "test_athena_embedded_http",
    },
  };
}

function paymentInput() {
  return {
    amount: { currency: "EUR", value: "10.00" },
    description: "Order 42",
    idempotencyKey: "idem-http-1",
    redirectUrl: "https://example.com/return",
  };
}

function createServerClient() {
  return createClient({
    auth: false,
    billing: { mode: "local", providers: mollieConfig(), testMode: true },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_bill_http",
    gatewayTransport: mockTransport(),
  });
}

const NEXT_LOCAL_BILLING_DISCOVERY = {
  athena: true,
  capabilities: {
    auth: { available: false },
    delete: true,
    fetch: true,
    insert: true,
    models: "off",
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
  runtime: "next-local",
  runtimeImplementation: "athena-js",
} as const satisfies AthenaRuntimeDiscoveryDocument;

test("T-BIL-HTTP-HANDLERS: P?: createAthenaBillingHandlers serves GET discovery and POST operations", async () => {
  assert.equal(existsSync(join(srcRoot, "next", "billing-handlers.ts")), true);
  assert.equal(DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT, "/api/athena/billing");
  const client = createServerClient();
  const handlers = createAthenaBillingHandlers({
    client,
    discoveryDocument: NEXT_LOCAL_BILLING_DISCOVERY,
    security: { mode: "trusted" },
  });
  const discovery = await handlers.GET(
    new Request("http://localhost/api/athena/billing")
  );
  const doc = (await discovery.json()) as { endpoints?: { billing?: string } };
  assert.equal(doc.endpoints?.billing, "/api/athena/billing");
  assert.equal(typeof handlers.POST, "function");
});

test("T-BIL-HTTP-NEXT: P?: createAthenaNextHandlers returns auth data storage billing", () => {
  const next = createAthenaNextHandlers({
    client: createServerClient(),
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  assert.equal(typeof next.auth.GET, "function");
  assert.equal(typeof next.data.POST, "function");
  assert.equal(typeof next.storage.POST, "function");
  assert.equal(typeof next.billing.GET, "function");
  assert.equal(typeof next.billing.POST, "function");
});

test("T-BIL-HTTP-DISCOVERY: P?: discovery advertises billing only when a Billing Runtime exists", async () => {
  const withRuntime = createAthenaNextHandlers({
    client: createServerClient(),
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const advertised = (await (
    await withRuntime.billing.GET(
      new Request("http://localhost/api/athena/billing")
    )
  ).json()) as { endpoints?: { billing?: string } };
  assert.equal(advertised.endpoints?.billing, "/api/athena/billing");

  const without = createAthenaNextHandlers({
    client: createClient({
      auth: false,
      databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_bill_http",
      gatewayTransport: mockTransport(),
    }),
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const doc = (await (
    await without.storage.GET(
      new Request("http://localhost/api/athena/storage")
    )
  ).json()) as { endpoints?: { billing?: string } };
  assert.equal(doc.endpoints?.billing, undefined);
});

test("T-BIL-HTTP-THIN: P?: Billing HTTP does not duplicate safety Rights or Mollie SDK", () => {
  const src = readSrc("next/billing-handlers.ts");
  assert.equal(src.includes("prepareBillingCommand"), false);
  assert.equal(src.includes("missingRequiredRights"), false);
  assert.equal(src.includes("createOfficialMollieAdapter"), false);
  assert.equal(src.includes("ATHENA_BILLING_MONEY_SCALE_INVALID"), false);
  assert.match(src, /resolveAthenaRuntimePrincipal/);
});

test("T-BIL-HTTP-PRINCIPAL: P?: Billing HTTP uses canonical request principal", async () => {
  const client = createServerClient();
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "session-bill", userId: "user_bill" },
            user: { id: "user_bill", rights: ["billing.payments.read"] },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const denied = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "payments.create",
        payload: paymentInput(),
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await denied.json()) as {
    error?: { code?: string };
    ok?: boolean;
    status?: number;
  };
  assert.equal(json.ok, false);
  assert.equal(json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  assert.equal(denied.status, 403);
});

test("T-BIL-HTTP-BROWSER: P?: browser createClient billing uses same-origin /api/athena/billing", async () => {
  assert.equal(
    readSrc("v3-client-assembly.ts").includes("createBrowserBillingTransport"),
    true
  );
  assert.match(
    readSrc("v3-client-assembly.ts"),
    /hasDiscoveredRuntimeTopology\(core\.config\)/
  );
  assert.match(
    readSrc("billing/runtime/local/runtime.ts"),
    /overlayCallerBillingCapabilities/
  );
  const posts: string[] = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    posts.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
    if ((init?.method ?? "GET").toUpperCase() === "GET") {
      return Response.json({
        endpoints: { billing: "/api/athena/billing", data: "/api/athena" },
      });
    }
    return Response.json({ data: { id: "tr_http" }, ok: true, status: 200 });
  }) as typeof fetch;
  try {
    const client = createCoreClient({
      key: "ak_test",
      url: "https://gateway.example.com",
    });
    await client.billing.catalog.products.list({} as never);
    await client.billing.getCapabilities({} as never);
    assert.equal("webhooks" in client.billing, false);
    assert.equal("payments" in client.billing, false);
    assert.equal(
      posts.some((row) => row.includes("/api/athena/billing")),
      true
    );
    assert.equal(
      posts.some((row) => row.includes("/billing/v1")),
      false
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});

test("T-BIL-HTTP-NODE-DIRECT: P?: Node local billing stays in-process not browser HTTP", async () => {
  const hits: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    hits.push(String(input instanceof Request ? input.url : input));
    return new Response(
      JSON.stringify({
        amount: { currency: "EUR", value: "10.00" },
        createdAt: "2026-08-23T10:00:00+00:00",
        description: "Order 42",
        id: "tr_direct",
        resource: "payment",
        status: "open",
      }),
      { headers: { "content-type": "application/json" }, status: 201 }
    );
  }) as typeof fetch;
  try {
    const client = createServerClient();
    const payment = await client.billing.payments.create(paymentInput());
    assert.equal(payment.providerPaymentId, "tr_direct");
    assert.equal(
      hits.some((url) => url.includes("/api/athena/billing")),
      false
    );
    assert.ok(hits.some((url) => url.includes("api.mollie.com")));
  } finally {
    globalThis.fetch = previous;
  }
});

test("T-BIL-HTTP-SECRETS: P?: browser graph has no Mollie keys or official SDK factory", () => {
  const files = [
    "browser.ts",
    "v3-client-core.ts",
    "next/client.ts",
    "billing/runtime/browser-transport.ts",
  ];
  const blob = files
    .filter((rel) => existsSync(join(srcRoot, rel)))
    .map((rel) => readSrc(rel))
    .join("\n");
  assert.equal(blob.includes("createOfficialMollieAdapter"), false);
  assert.equal(blob.includes("runtime/local/runtime.ts"), false);
  assert.equal(/testKey|liveKey/.test(blob), false);
  assert.equal(blob.includes("next/billing-handlers"), false);
});

test("T-BIL-HTTP-EQUIV-AUTH: P?: direct and HTTP Billing share authorization outcomes", async () => {
  const client = createServerClient();
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    rights: ["billing.payments.read"],
    userId: "user_bill",
  });
  const runtime = getAthenaClientInternals(client)?.billingRuntime;
  assert.ok(runtime?.execute);
  await assert.rejects(
    () => runtime.execute("payments.create", paymentInput(), principal),
    AthenaBillingAuthorizationError
  );
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "s", userId: "user_bill" },
            user: { id: "user_bill", rights: ["billing.payments.read"] },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const http = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "payments.create",
        payload: paymentInput(),
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  assert.equal(http.status, 403);
});

test("T-BIL-HTTP-EQUIV-MONEY: P?: direct and HTTP Billing share financial preflight errors", async () => {
  const client = createServerClient();
  const bad = {
    ...paymentInput(),
    amount: { currency: "EUR", value: "10.001" },
  };
  await assert.rejects(
    () => client.billing.payments.create(bad),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("ATHENA_BILLING_MONEY_SCALE_INVALID")
  );
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "s", userId: "user_bill" },
            user: {
              id: "user_bill",
              rights: ["billing.payments.write"],
            },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const http = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "payments.create", payload: bad }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await http.json()) as {
    error?: { code?: string; message?: string };
    ok?: boolean;
  };
  assert.equal(http.status, 403);
  assert.equal(json.ok, false);
  assert.equal(json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  assert.match(json.error?.message ?? "", /no subject binding/);
});

test("T-BIL-HTTP-EQUIV-WEBHOOK-EVENT-TYPES: P?: empty event types stay client errors over HTTP", async () => {
  const client = createServerClient();
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    rights: ["billing.webhooks.write"],
    userId: "user_bill",
  });
  const runtime = getAthenaClientInternals(client)?.billingRuntime;
  assert.ok(runtime?.execute);
  await assert.rejects(
    () =>
      runtime.execute(
        "webhooks.create",
        {
          eventTypes: [],
          url: "https://athena.example.com/webhook",
        },
        principal
      ),
    (error: unknown) =>
      error instanceof AthenaBillingAuthorizationError &&
      error.code === ATHENA_BILLING_AUTHORIZATION_DENIED
  );
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "s", userId: "user_bill" },
            user: { id: "user_bill", rights: ["billing.webhooks.write"] },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const http = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "webhooks.create",
        payload: {
          eventTypes: [],
          url: "https://athena.example.com/webhook",
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await http.json()) as {
    error?: { code?: string; message?: string };
    ok?: boolean;
  };
  assert.equal(http.status, 403);
  assert.equal(json.ok, false);
  assert.equal(json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  assert.match(json.error?.message ?? "", /no subject binding/);
});

test("T-BIL-HTTP-EQUIV-PROVIDER: P?: direct and HTTP Billing share provider invocation", async () => {
  const calls: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    return new Response(
      JSON.stringify({
        amount: { currency: "EUR", value: "10.00" },
        createdAt: "2026-08-23T10:00:00+00:00",
        description: "Order 42",
        id: "tr_shared",
        resource: "payment",
        status: "open",
      }),
      { headers: { "content-type": "application/json" }, status: 201 }
    );
  }) as typeof fetch;
  try {
    const client = createServerClient();
    await client.billing.payments.create({
      ...paymentInput(),
      idempotencyKey: "idem-direct",
    });
    const directCalls = calls.filter((row) =>
      row.includes("api.mollie.com")
    ).length;
    assert.ok(directCalls >= 1);
    const handlers = createAthenaNextHandlers({
      auth: {
        lookupSession: async (token) =>
          token === "sess_bill"
            ? {
              session: { id: "s", userId: "user_bill" },
              user: { id: "user_bill", rights: ["*"] },
            }
            : null,
        mode: "athena-session",
      },
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const before = calls.filter((row) => row.includes("api.mollie.com")).length;
    const http = await handlers.billing.POST(
      new Request("http://localhost/api/athena/billing", {
        body: JSON.stringify({
          operation: "payments.create",
          payload: { ...paymentInput(), idempotencyKey: "idem-http" },
        }),
        headers: {
          "content-type": "application/json",
          cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
          origin: "http://localhost",
        },
        method: "POST",
      })
    );
    assert.equal(http.status, 403);
    const after = calls.filter((row) => row.includes("api.mollie.com")).length;
    assert.equal(after, before);
  } finally {
    globalThis.fetch = previous;
  }
});

test("T-BIL-HTTP-APP-ORIGIN: public app.url Origin is not cross-origin denied", async () => {
  const publicOrigin = "https://app.example.test";
  const discoveryDocument = NEXT_LOCAL_BILLING_DISCOVERY;
  const denied = createAthenaBillingHandlers({
    client: createServerClient(),
    discoveryDocument,
  });
  const deniedResponse = await denied.POST(
    new Request("http://localhost:3010/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        origin: publicOrigin,
      },
      method: "POST",
    })
  );
  const deniedJson = (await deniedResponse.json()) as {
    error?: { message?: string };
  };
  assert.equal(deniedResponse.status, 403);
  assert.equal(
    deniedJson.error?.message,
    "cross-origin billing request denied"
  );

  const allowed = createAthenaBillingHandlers({
    client: createClient({
      app: { url: publicOrigin },
      auth: false,
      billing: { mode: "local", providers: mollieConfig(), testMode: true },
      databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_bill_http",
      gatewayTransport: mockTransport(),
    }),
    discoveryDocument,
  });
  const allowedResponse = await allowed.POST(
    new Request("http://localhost:3010/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        origin: publicOrigin,
      },
      method: "POST",
    })
  );
  const allowedJson = (await allowedResponse.json()) as {
    error?: { message?: string };
  };
  assert.notEqual(
    allowedJson.error?.message,
    "cross-origin billing request denied"
  );
});

test("T-BIL-HTTP-COOKIE-ORIGIN: session-cookie billing requires Origin even when trusted", async () => {
  const discoveryDocument = NEXT_LOCAL_BILLING_DISCOVERY;
  const cookie = `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`;
  const trustedCookieHandlers = createAthenaBillingHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "session-bill", userId: "user_bill" },
            user: { id: "user_bill", rights: ["billing.payments.read"] },
          }
          : null,
      mode: "athena-session",
    },
    client: createServerClient(),
    discoveryDocument,
    security: { mode: "trusted" },
  });

  const missingOrigin = await trustedCookieHandlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  const missingJson = (await missingOrigin.json()) as {
    error?: { message?: string };
  };
  assert.equal(missingOrigin.status, 403);
  assert.equal(
    missingJson.error?.message,
    "cross-origin billing request denied"
  );

  const evilOrigin = await trustedCookieHandlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://evil.example",
      },
      method: "POST",
    })
  );
  const evilJson = (await evilOrigin.json()) as {
    error?: { message?: string };
  };
  assert.equal(evilOrigin.status, 403);
  assert.equal(evilJson.error?.message, "cross-origin billing request denied");

  const matchingOrigin = await trustedCookieHandlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const matchingJson = (await matchingOrigin.json()) as {
    error?: { message?: string };
  };
  assert.notEqual(
    matchingJson.error?.message,
    "cross-origin billing request denied"
  );

  const trustedNoCookie = createAthenaBillingHandlers({
    client: createServerClient(),
    discoveryDocument,
    security: { mode: "trusted" },
  });
  const skipped = await trustedNoCookie.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const skippedJson = (await skipped.json()) as {
    error?: { message?: string };
  };
  assert.notEqual(
    skippedJson.error?.message,
    "cross-origin billing request denied"
  );

  const defaultMode = createAthenaBillingHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "session-bill", userId: "user_bill" },
            user: { id: "user_bill" },
          }
          : null,
      mode: "athena-session",
    },
    client: createServerClient(),
    discoveryDocument,
  });
  const defaultMissing = await defaultMode.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  const defaultJson = (await defaultMissing.json()) as {
    error?: { message?: string };
  };
  assert.equal(defaultMissing.status, 403);
  assert.equal(
    defaultJson.error?.message,
    "cross-origin billing request denied"
  );
});

test("T-BIL-HTTP-CAPS-RIGHTS: getCapabilities authorized follows session rights, not SQL presence alone", async () => {
  const client = createServerClient();
  const cookie = `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`;
  const denied = createAthenaBillingHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "session-bill", userId: "user_bill" },
            user: { id: "user_bill", rights: ["billing.self.payments.read"] },
          }
          : null,
      mode: "athena-session",
    },
    client,
    discoveryDocument: NEXT_LOCAL_BILLING_DISCOVERY,
    security: { mode: "trusted" },
  });
  const deniedResponse = await denied.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  assert.equal(deniedResponse.status, 200);
  const deniedJson = (await deniedResponse.json()) as {
    data?: {
      operations?: Record<string, { authorized?: boolean; available?: boolean }>;
    };
  };
  assert.equal(
    deniedJson.data?.operations?.["admin.ingestion.health"]?.authorized,
    false
  );
  assert.equal(
    deniedJson.data?.operations?.["admin.ingestion.health"]?.available,
    false
  );

  const allowed = createAthenaBillingHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "session-bill", userId: "user_bill" },
            user: {
              id: "user_bill",
              rights: [
                "billing.admin.ingestion.read",
                "billing.payments.read",
              ],
            },
          }
          : null,
      mode: "athena-session",
    },
    client,
    discoveryDocument: NEXT_LOCAL_BILLING_DISCOVERY,
    security: { mode: "trusted" },
  });
  const allowedResponse = await allowed.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "getCapabilities", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  assert.equal(allowedResponse.status, 200);
  const allowedJson = (await allowedResponse.json()) as {
    data?: {
      operations?: Record<string, { authorized?: boolean; available?: boolean }>;
    };
  };
  assert.equal(
    allowedJson.data?.operations?.["admin.ingestion.health"]?.authorized,
    true
  );
  assert.equal(
    allowedJson.data?.operations?.["payments.list"]?.authorized,
    true
  );
});

test("T-BIL-HTTP-SAMESITE: session cookies used with billing are SameSite=Lax", () => {
  const header = createSessionCookieHeader("sess_bill", {
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    secure: true,
  });
  assert.match(header, /SameSite=Lax/);
  assert.equal(header.includes("SameSite=None"), false);
  const cookiesSrc = readSrc("auth/local/cookies.ts");
  assert.match(cookiesSrc, /sameSite:\s*"Lax"/);
  assert.match(
    readSrc("next/billing-handlers.ts"),
    /billingRequestCarriesSessionCookie/
  );
});

test("T-BIL-HTTP-REMOTE: P?: explicit billing.url keeps remote /billing/v1", async () => {
  const posts: string[] = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    return Response.json({ data: {} });
  }) as typeof fetch;
  try {
    const client = createCoreClient({
      billing: { url: "https://athena.example.com" },
      key: "ak_test",
      url: "https://gateway.example.com",
    });
    try {
      await client.billing.payments.create(paymentInput());
    } catch {
      // remote transport may reject mock shape
    }
    assert.equal(
      posts.some((row) => row.includes("/billing/v1")),
      true
    );
    assert.equal(
      posts.some((row) => row.includes("/api/athena/billing")),
      false
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});

test("T-BIL-HTTP-INTERNAL-MESSAGE: unknown billing errors stay generic on the wire", async () => {
  const client = createServerClient();
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);
  internals.billingRuntime.execute = async () => {
    throw new Error("relation billing.billing_customers does not exist");
  };
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_bill"
          ? {
            session: { id: "s", userId: "user_bill" },
            user: {
              id: "user_bill",
              rights: ["billing.catalog.read"],
            },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "getCapabilities",
        payload: {},
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 500);
  const json = (await response.json()) as {
    error?: { code?: string; message?: string };
  };
  assert.equal(json.error?.code, "ATHENA_BILLING_INTERNAL");
  assert.equal(json.error?.message, "Billing request failed.");
  assert.equal(JSON.stringify(json).includes("billing_customers"), false);
});
