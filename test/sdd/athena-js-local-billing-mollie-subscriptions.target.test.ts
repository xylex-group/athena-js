import { strict as assert } from "node:assert/strict";
/**
 * Target — local Mollie subscriptions.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const billingDir = join(here, "..", "..", "src", "billing");
const TEST_KEY = "test_athena_mollie_subscriptions";
const LIVE_KEY = "live_athena_mollie_subscriptions";

function jsonResponse(body: unknown, status = 200): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function mollieSubscriptionPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: { currency: "EUR", value: "19.99" },
    canceledAt: null,
    createdAt: "2026-08-23T12:00:00+00:00",
    customerId: "cst_local_1",
    description: "Athena Pro",
    id: "sub_local_1",
    interval: "1 month",
    metadata: { plan: "pro" },
    nextPaymentDate: "2026-09-23",
    profileId: "pfl_local_1",
    resource: "subscription",
    status: "active",
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

async function createLocalRuntime(testMode = true) {
  const { createLocalBillingRuntime } = await import(
    "../../src/billing/runtime/local/runtime.ts"
  );
  const { createBillingProviderRegistry } = await import(
    "../../src/billing/runtime/local/providers/create-registry.ts"
  );
  const configured = {
    mollie: { liveKey: LIVE_KEY, sdk: FetchMollieSdk, testKey: TEST_KEY },
  };
  return createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured),
    testMode,
  });
}

function createLocalClient(testMode = true) {
  return createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: { liveKey: LIVE_KEY, sdk: FetchMollieSdk, testKey: TEST_KEY },
      },
      testMode,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
}

test("T-BIL-MOLLIE-SUB-CREATE: create projection", async () => {
  const runtime = await createLocalRuntime();
  const created = await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/customers\/cst_local_1\/subscriptions$/);
      assert.equal((init?.method ?? "GET").toUpperCase(), "POST");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.amount, { currency: "EUR", value: "19.99" });
      assert.equal(body.interval, "1 month");
      assert.equal(body.description, "Athena Pro");
      return jsonResponse(mollieSubscriptionPayload(), 201);
    },
    () =>
      runtime.subscriptions.create({
        amount: { currency: "EUR", value: "19.99" },
        customerId: "cst_local_1",
        description: "Athena Pro",
        idempotencyKey: "idem-sub-1",
        interval: "1 month",
      })
  );
  assert.equal(created.provider, "mollie");
  assert.equal(created.providerSubscriptionId, "sub_local_1");
  assert.equal(created.providerCustomerId, "cst_local_1");
  assert.equal(created.status, "active");
  assert.equal(created.interval, "1 month");
  assert.deepEqual(created.amount, { currency: "EUR", value: "19.99" });
});

test("T-BIL-MOLLIE-SUB-GET: scoped get", async () => {
  const runtime = await createLocalRuntime();
  const subscription = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
      assert.match(
        String(url),
        /\/v2\/customers\/cst_local_1\/subscriptions\/sub_local_1$/
      );
      return jsonResponse(mollieSubscriptionPayload());
    },
    () =>
      runtime.subscriptions.get({
        customerId: "cst_local_1",
        subscriptionId: "sub_local_1",
      })
  );
  assert.equal(subscription.providerSubscriptionId, "sub_local_1");
  assert.equal(subscription.providerCustomerId, "cst_local_1");
});

test("T-BIL-MOLLIE-SUB-TARGET-PROFILE: requested profile overrides configured for org tokens", async () => {
  const CONFIGURED = "pfl_configured";
  const REQUESTED = "pfl_requested";
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_subscriptions",
          apiMode: "test",
          authority: {
            permissions: { subscriptions: { read: true } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: CONFIGURED,
          scope: { kind: "organization" },
          sdk: FetchMollieSdk,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await withMockedFetch(
    async (url) => {
      const requested = new URL(String(url));
      assert.equal(requested.pathname, "/v2/subscriptions");
      assert.equal(requested.searchParams.get("profileId"), REQUESTED);
      return jsonResponse({
        _embedded: {
          subscriptions: [mollieSubscriptionPayload()],
        },
        _links: {},
      });
    },
    () =>
      client.billing.subscriptions.list({
        limit: 20,
        profileId: REQUESTED,
      })
  );
});

test("T-BIL-MOLLIE-SUB-PROFILE: unenforced ops fail-close requested profileId", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_subscriptions",
          apiMode: "test",
          authority: {
            permissions: { subscriptions: { read: true, write: true } },
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
      "subscriptions.create",
      () =>
        client.billing.subscriptions.create({
          amount: { currency: "EUR", value: "19.99" },
          customerId: "cst_local_1",
          description: "Athena Pro",
          idempotencyKey: "idem-sub-profile",
          interval: "1 month",
          profileId: "pfl_B",
        }),
    ],
    [
      "subscriptions.get",
      () =>
        client.billing.subscriptions.get({
          customerId: "cst_local_1",
          profileId: "pfl_B",
          subscriptionId: "sub_local_1",
        }),
    ],
    [
      "subscriptions.update",
      () =>
        client.billing.subscriptions.update({
          customerId: "cst_local_1",
          description: "Athena Pro Plus",
          profileId: "pfl_B",
          subscriptionId: "sub_local_1",
        }),
    ],
    [
      "subscriptions.cancel",
      () =>
        client.billing.subscriptions.cancel({
          customerId: "cst_local_1",
          profileId: "pfl_B",
          subscriptionId: "sub_local_1",
        }),
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

test("T-BIL-MOLLIE-SUB-LIST: opaque pagination", async () => {
  const { encodeMollieListCursor } = await import(
    "../../src/billing/runtime/local/providers/mollie/cursor.ts"
  );
  const runtime = await createLocalRuntime();
  const { AthenaBillingProviderRequestError } = await import(
    "../../src/billing/errors.ts"
  );
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const page = await withMockedFetch(
    async (url) => {
      assert.match(String(url), /\/v2\/customers\/cst_local_1\/subscriptions/);
      return jsonResponse({
        _embedded: {
          subscriptions: [mollieSubscriptionPayload()],
        },
        _links: {
          next: {
            href: "https://api.mollie.com/v2/customers/cst_local_1/subscriptions?from=sub_page_2",
          },
        },
      });
    },
    () =>
      runtime.subscriptions.list({
        customerId: "cst_local_1",
      })
  );
  assert.equal(page.items[0]?.providerSubscriptionId, "sub_local_1");
  assert.ok(page.nextCursor);
  assert.equal(page.nextCursor?.includes("api.mollie.com"), false);

  await assert.rejects(
    () =>
      runtime.subscriptions.list({
        cursor: encodeMollieListCursor({
          from: "cst_local_1",
          provider: "mollie",
          resource: "customers",
        }),
        customerId: "cst_local_1",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingProviderRequestError &&
      error.kind === "serialization"
  );

  await assert.rejects(
    () =>
      runtime.subscriptions.list({
        customerId: "cst_local_1",
        offset: 10,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "subscriptions.list" &&
      error.reason === "unsupported_operation"
  );
});

test("T-BIL-MOLLIE-SUB-CURSOR: accepts only scoped subscription continuations", async () => {
  const { fromParamFromMollieHref } = await import(
    "../../src/billing/runtime/local/providers/mollie/cursor.ts"
  );
  const input = {
    apiBaseUrl: "https://api.mollie.com",
    resource: "subscriptions" as const,
  };

  assert.equal(
    fromParamFromMollieHref(
      "https://api.mollie.com/v2/customers/cst_local_1/subscriptions?from=page_2",
      input
    ),
    "page_2"
  );
  for (const href of [
    "https://evil.example/v2/customers/cst_local_1/subscriptions?from=page_2",
    "https://api.mollie.com/v2/customers/cst_local_1/payments?from=page_2",
    "https://api.mollie.com/v2/customers/cst_local_1/subscriptions/page_2?from=page_2",
    "https://api.mollie.com/v2/customers//subscriptions?from=page_2",
    "https://api.mollie.com/v2/customers/cst_local_1/subscriptions?cursor=page_2",
  ]) {
    assert.equal(fromParamFromMollieHref(href, input), undefined, href);
  }
});

test("T-BIL-MOLLIE-SUB-UPDATE: mutable fields only", async () => {
  const runtime = await createLocalRuntime();
  const updated = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "").toUpperCase(), "PATCH");
      assert.match(
        String(url),
        /\/v2\/customers\/cst_local_1\/subscriptions\/sub_local_1$/
      );
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(body), ["description"]);
      assert.equal(body.description, "Athena Pro Plus");
      return jsonResponse(
        mollieSubscriptionPayload({ description: "Athena Pro Plus" })
      );
    },
    () =>
      runtime.subscriptions.update({
        customerId: "cst_local_1",
        description: "Athena Pro Plus",
        subscriptionId: "sub_local_1",
      })
  );
  assert.equal(updated.description, "Athena Pro Plus");
});

test("T-BIL-MOLLIE-SUB-CANCEL: terminal semantics", async () => {
  const runtime = await createLocalRuntime();
  const canceled = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "").toUpperCase(), "DELETE");
      assert.match(
        String(url),
        /\/v2\/customers\/cst_local_1\/subscriptions\/sub_local_1$/
      );
      return jsonResponse(
        mollieSubscriptionPayload({
          canceledAt: "2026-08-23T13:00:00+00:00",
          status: "canceled",
        })
      );
    },
    () =>
      runtime.subscriptions.cancel({
        customerId: "cst_local_1",
        subscriptionId: "sub_local_1",
      })
  );
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.canceledAt, "2026-08-23T13:00:00+00:00");
});

test("T-BIL-MOLLIE-SUB-CANCEL-TESTMODE: access-token cancel sends testmode in the DELETE body", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_subscriptions",
          apiMode: "test",
          authority: {
            permissions: { subscriptions: { write: true } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: "pfl_sub_cancel_scope",
          scope: { kind: "organization" },
          sdk: FetchMollieSdk,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await withMockedFetch(
    async (url, init) => {
      const requested = new URL(String(url));
      assert.equal((init?.method ?? "").toUpperCase(), "DELETE");
      assert.equal(
        requested.pathname,
        "/v2/customers/cst_local_1/subscriptions/sub_local_1"
      );
      assert.equal(requested.searchParams.get("testmode"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { testmode: true });
      return jsonResponse(
        mollieSubscriptionPayload({
          canceledAt: "2026-08-23T13:00:00+00:00",
          status: "canceled",
        })
      );
    },
    () =>
      client.billing.subscriptions.cancel({
        customerId: "cst_local_1",
        subscriptionId: "sub_local_1",
      })
  );
});

test("T-BIL-MOLLIE-SUB-STATUS: provider status projection", async () => {
  const { projectMollieSubscriptionStatus } = await import(
    "../../src/billing/runtime/local/providers/mollie/projection/subscription.ts"
  );
  const { AthenaBillingProviderRequestError } = await import(
    "../../src/billing/errors.ts"
  );
  assert.equal(projectMollieSubscriptionStatus("pending"), "trialing");
  assert.equal(projectMollieSubscriptionStatus("active"), "active");
  assert.equal(projectMollieSubscriptionStatus("canceled"), "canceled");
  assert.equal(projectMollieSubscriptionStatus("completed"), "canceled");
  assert.equal(projectMollieSubscriptionStatus("suspended"), "past_due");
  assert.throws(
    () => projectMollieSubscriptionStatus("mystery"),
    (error: unknown) =>
      error instanceof AthenaBillingProviderRequestError &&
      error.kind === "serialization"
  );
});

test("T-BIL-LOCAL-NO-HTTP: no /billing/v1 local", async () => {
  const urls: string[] = [];
  const client = createLocalClient();
  await withMockedFetch(
    async (url) => {
      urls.push(String(url));
      return jsonResponse(mollieSubscriptionPayload(), 201);
    },
    () =>
      client.billing.subscriptions.create({
        amount: { currency: "EUR", value: "19.99" },
        customerId: "cst_local_1",
        description: "Athena Pro",
        idempotencyKey: "idem-local-sub",
        interval: "1 month",
      })
  );
  assert.equal(
    urls.some((url) => url.includes("/billing/v1")),
    false
  );
  assert.ok(urls.some((url) => url.includes("api.mollie.com")));
});

test("T-BIL-MOLLIE-TEST-LIVE: environment selection preserved", async () => {
  const testRuntime = await createLocalRuntime(true);
  const liveRuntime = await createLocalRuntime(false);
  const testAuth: string[] = [];
  const liveAuth: string[] = [];
  await withMockedFetch(
    async (_url, init) => {
      testAuth.push(new Headers(init?.headers).get("authorization") ?? "");
      return jsonResponse(mollieSubscriptionPayload(), 201);
    },
    () =>
      testRuntime.subscriptions.create({
        amount: { currency: "EUR", value: "19.99" },
        customerId: "cst_local_1",
        description: "Athena Pro",
        idempotencyKey: "idem-sub-test-env",
        interval: "1 month",
      })
  );
  await withMockedFetch(
    async (_url, init) => {
      liveAuth.push(new Headers(init?.headers).get("authorization") ?? "");
      return jsonResponse(mollieSubscriptionPayload(), 201);
    },
    () =>
      liveRuntime.subscriptions.create({
        amount: { currency: "EUR", value: "19.99" },
        customerId: "cst_local_1",
        description: "Athena Pro",
        idempotencyKey: "idem-sub-live-env",
        interval: "1 month",
      })
  );
  assert.ok(testAuth.every((value) => value.includes(TEST_KEY)));
  assert.ok(liveAuth.every((value) => value.includes(LIVE_KEY)));
});

test("T-BIL-MOLLIE-SECRETS: SDK pool remains only secret reveal site", () => {
  const transport = readFileSync(
    join(billingDir, "runtime/local/providers/mollie/sdk/client-factory.ts"),
    "utf8"
  );
  const subscriptions = readFileSync(
    join(billingDir, "runtime/local/providers/mollie/subscriptions.ts"),
    "utf8"
  );
  assert.equal(transport.includes("revealForProviderRuntime"), true);
  assert.equal(subscriptions.includes("revealForProviderRuntime"), false);
});
