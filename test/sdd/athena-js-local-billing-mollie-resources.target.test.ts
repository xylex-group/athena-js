import { strict as assert } from "node:assert/strict";
/**
 * Target — local Mollie customers, refunds, and payment links.
 *
 * See the next-PR brief for local billing resource breadth.
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
const srcRoot = join(here, "..", "..", "src");
const billingDir = join(srcRoot, "billing");

const TEST_KEY = "test_athena_mollie_resources";
const LIVE_KEY = "live_athena_mollie_resources";

function readBilling(rel: string): string {
  return readFileSync(join(billingDir, rel), "utf8");
}

function jsonResponse(body: unknown, status = 200): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function mollieCustomerPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: "billing@example.com",
    id: "cst_local_1",
    metadata: { account: "acme" },
    name: "Example BV",
    resource: "customer",
    ...overrides,
  };
}

function molliePaymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: { currency: "EUR", value: "10.00" },
    id: "tr_local_1",
    profileId: "pfl_A",
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

function molliePaymentLinkPayload(overrides: Record<string, unknown> = {}) {
  return {
    _links: {
      paymentLink: {
        href: "https://paymentlink.mollie.com/payment/abc",
      },
    },
    amount: { currency: "EUR", value: "25.00" },
    archived: false,
    description: "Invoice #42",
    id: "pl_local_1",
    metadata: {},
    paidAt: null,
    resource: "payment-link",
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

function createOrgTokenClient(
  permissions: Record<string, { read?: boolean; write?: boolean }>
) {
  return createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_resources",
          apiMode: "test",
          authority: {
            permissions,
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
}

function createAccessTokenClient(
  permissions: Record<string, { read?: boolean; write?: boolean }>
) {
  return createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_resources",
          apiMode: "test",
          authority: {
            permissions,
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: "pfl_delete_scope",
          scope: { kind: "organization" },
          sdk: FetchMollieSdk,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
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

test("T-BIL-MOLLIE-CUSTOMER-CREATE: canonical customer maps through Mollie", async () => {
  const runtime = await createLocalRuntime();
  const created = await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/customers$/);
      assert.equal((init?.method ?? "GET").toUpperCase(), "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.name, "Example BV");
      assert.equal(body.email, "billing@example.com");
      return jsonResponse(mollieCustomerPayload(), 201);
    },
    () =>
      runtime.customers.create({
        email: "billing@example.com",
        idempotencyKey: "idem-cust-1",
        name: "Example BV",
      })
  );
  assert.equal(created.provider, "mollie");
  assert.equal(created.providerCustomerId, "cst_local_1");
  assert.equal(created.name, "Example BV");
  assert.equal(created.email, "billing@example.com");
});

test("T-BIL-MOLLIE-CUSTOMER-LIST: list projects BillingPage", async () => {
  const runtime = await createLocalRuntime();
  const page = await withMockedFetch(
    async () =>
      jsonResponse({
        _embedded: {
          customers: [
            mollieCustomerPayload(),
            mollieCustomerPayload({ id: "cst_local_2", name: "Second" }),
          ],
        },
        _links: {
          next: {
            href: "https://api.mollie.com/v2/customers?from=cst_local_2&limit=50",
          },
        },
      }),
    () => runtime.customers.list({})
  );
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.providerCustomerId, "cst_local_1");
  assert.equal(typeof page.nextCursor, "string");
  assert.notEqual(page.nextCursor, null);
  assert.equal(String(page.nextCursor).includes("api.mollie.com"), false);
  assert.equal(String(page.nextCursor).includes("https://"), false);
});

test("T-BIL-MOLLIE-CUSTOMER-GET: provider id mapping", async () => {
  const runtime = await createLocalRuntime();
  const customer = await withMockedFetch(
    async (url) => {
      assert.match(String(url), /\/v2\/customers\/cst_local_1$/);
      return jsonResponse(mollieCustomerPayload());
    },
    () => runtime.customers.get({ id: "cst_local_1" })
  );
  assert.equal(customer.providerCustomerId, "cst_local_1");
});

test("T-BIL-MOLLIE-CUSTOMER-UPDATE: canonical patch semantics", async () => {
  const runtime = await createLocalRuntime();
  const updated = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "").toUpperCase(), "PATCH");
      assert.match(String(url), /\/v2\/customers\/cst_local_1$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.name, "Renamed BV");
      assert.equal(body.email, "new@example.com");
      return jsonResponse(
        mollieCustomerPayload({
          email: "new@example.com",
          name: "Renamed BV",
        })
      );
    },
    () =>
      runtime.customers.update({
        email: "new@example.com",
        id: "cst_local_1",
        name: "Renamed BV",
      })
  );
  assert.equal(updated.name, "Renamed BV");
  assert.equal(updated.email, "new@example.com");
});

test("T-BIL-MOLLIE-CUSTOMER-DELETE: successful empty response", async () => {
  const runtime = await createLocalRuntime();
  await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "").toUpperCase(), "DELETE");
      assert.match(String(url), /\/v2\/customers\/cst_local_1$/);
      return jsonResponse(undefined, 204);
    },
    () => runtime.customers.delete({ id: "cst_local_1" })
  );
});

test("T-BIL-MOLLIE-CUSTOMER-DELETE-TESTMODE: access-token delete sends testmode in the DELETE body", async () => {
  const client = createAccessTokenClient({ customers: { write: true } });
  await withMockedFetch(
    async (url, init) => {
      const requested = new URL(String(url));
      assert.equal((init?.method ?? "").toUpperCase(), "DELETE");
      assert.equal(requested.pathname, "/v2/customers/cst_local_1");
      assert.equal(requested.searchParams.get("testmode"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { testmode: true });
      return jsonResponse(undefined, 204);
    },
    () => client.billing.customers.delete({ id: "cst_local_1" })
  );
});

test("T-BIL-MOLLIE-REFUND-CREATE: payment-scoped refund mapping", async () => {
  const runtime = await createLocalRuntime();
  const refund = await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/payments\/tr_local_1\/refunds$/);
      assert.equal((init?.method ?? "").toUpperCase(), "POST");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.amount, { currency: "EUR", value: "5.00" });
      assert.equal(body.description, "Partial refund");
      return jsonResponse(mollieRefundPayload(), 201);
    },
    () =>
      runtime.refunds.create({
        amount: { currency: "EUR", value: "5.00" },
        description: "Partial refund",
        idempotencyKey: "idem-refund-1",
        paymentId: "tr_local_1",
      })
  );
  assert.equal(refund.provider, "mollie");
  assert.equal(refund.providerRefundId, "re_local_1");
  assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-REFUND-CANCEL-TESTMODE: access-token cancel keeps testmode in the query", async () => {
  const client = createAccessTokenClient({
    refunds: { read: true, write: true },
  });
  await withMockedFetch(
    async (url, init) => {
      const requested = new URL(String(url));
      const method = (init?.method ?? "GET").toUpperCase();
      if (requested.pathname === "/v2/payments/tr_local_1") {
        assert.equal(method, "GET");
        return jsonResponse(
          molliePaymentPayload({ profileId: "pfl_delete_scope" })
        );
      }
      assert.equal(
        requested.pathname,
        "/v2/payments/tr_local_1/refunds/re_local_1"
      );
      if (method === "DELETE") {
        assert.equal(requested.searchParams.get("testmode"), "true");
        assert.equal(init?.body, undefined);
        return jsonResponse(undefined, 204);
      }
      assert.equal(method, "GET");
      return jsonResponse(mollieRefundPayload({ status: "canceled" }));
    },
    () =>
      client.billing.refunds.cancel({
        paymentId: "tr_local_1",
        refundId: "re_local_1",
      })
  );
});

test("T-BIL-MOLLIE-REFUND-PROJECTION: canonical refund fields/status", async () => {
  const { projectMollieRefund, projectMollieRefundStatus } = await import(
    "../../src/billing/runtime/local/providers/mollie/projection/refund.ts"
  );
  assert.equal(projectMollieRefundStatus("queued"), "queued");
  assert.equal(projectMollieRefundStatus("pending"), "pending");
  assert.equal(projectMollieRefundStatus("processing"), "processing");
  assert.equal(projectMollieRefundStatus("refunded"), "refunded");
  assert.equal(projectMollieRefundStatus("failed"), "failed");
  assert.equal(projectMollieRefundStatus("canceled"), "canceled");
  const refund = projectMollieRefund(mollieRefundPayload());
  assert.equal(refund.providerRefundId, "re_local_1");
  assert.equal(refund.status, "queued");
  assert.deepEqual(refund.amount, { currency: "EUR", value: "5.00" });
});

test("T-BIL-MOLLIE-REFUND-IDEMPOTENCY: header preserved", async () => {
  const runtime = await createLocalRuntime();
  const headers: string[] = [];
  await withMockedFetch(
    async (_url, init) => {
      headers.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      return jsonResponse(mollieRefundPayload(), 201);
    },
    () =>
      runtime.refunds.create({
        amount: { currency: "EUR", value: "5.00" },
        idempotencyKey: "idem-refund-keep",
        paymentId: "tr_local_1",
      })
  );
  assert.deepEqual(headers, ["idem-refund-keep"]);
});

test("T-BIL-MOLLIE-REFUND-CREATE-PROFILE: parent payment mismatch rejects before refund POST", async () => {
  const client = createOrgTokenClient({ refunds: { write: true } });
  const methods: string[] = [];
  await assert.rejects(
    () =>
      withMockedFetch(
        async (url, init) => {
          const method = (init?.method ?? "GET").toUpperCase();
          methods.push(method);
          assert.equal(method, "GET");
          assert.match(String(url), /\/v2\/payments\/tr_local_1(?:\?|$)/);
          return jsonResponse(molliePaymentPayload({ profileId: "pfl_A" }));
        },
        () =>
          client.billing.refunds.create({
            amount: { currency: "EUR", value: "5.00" },
            idempotencyKey: "idem-refund-profile",
            paymentId: "tr_local_1",
            profileId: "pfl_B",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "refunds.create" &&
      error.reason === "missing_provider_scope"
  );
  assert.deepEqual(methods, ["GET"]);
});

test("T-BIL-MOLLIE-REFUND-CREATE-PROFILE-MATCH: matching parent payment then POST refund", async () => {
  const client = createOrgTokenClient({ refunds: { write: true } });
  const methods: string[] = [];
  const refund = await withMockedFetch(
    async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      methods.push(method);
      if (method === "GET") {
        assert.match(String(url), /\/v2\/payments\/tr_local_1(?:\?|$)/);
        return jsonResponse(molliePaymentPayload({ profileId: "pfl_B" }));
      }
      assert.equal(method, "POST");
      assert.match(String(url), /\/v2\/payments\/tr_local_1\/refunds$/);
      return jsonResponse(mollieRefundPayload(), 201);
    },
    () =>
      client.billing.refunds.create({
        amount: { currency: "EUR", value: "5.00" },
        idempotencyKey: "idem-refund-match",
        paymentId: "tr_local_1",
        profileId: "pfl_B",
      })
  );
  assert.deepEqual(methods, ["GET", "POST"]);
  assert.equal(refund.providerRefundId, "re_local_1");
});

test("T-BIL-MOLLIE-REFUND-GET-PROFILE: parent payment mismatch does not return refund", async () => {
  const client = createOrgTokenClient({ refunds: { read: true } });
  await assert.rejects(
    () =>
      withMockedFetch(
        async (url, init) => {
          assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
          assert.match(String(url), /\/v2\/payments\/tr_local_1(?:\?|$)/);
          return jsonResponse(molliePaymentPayload({ profileId: "pfl_A" }));
        },
        () =>
          client.billing.refunds.get({
            paymentId: "tr_local_1",
            profileId: "pfl_B",
            refundId: "re_local_1",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "refunds.get" &&
      error.reason === "missing_provider_scope"
  );
});

test("T-BIL-MOLLIE-REFUND-CANCEL-PROFILE: parent payment mismatch does not DELETE refund", async () => {
  const client = createOrgTokenClient({
    refunds: { read: true, write: true },
  });
  const methods: string[] = [];
  await assert.rejects(
    () =>
      withMockedFetch(
        async (url, init) => {
          const method = (init?.method ?? "GET").toUpperCase();
          methods.push(method);
          assert.equal(method, "GET");
          assert.match(String(url), /\/v2\/payments\/tr_local_1(?:\?|$)/);
          return jsonResponse(molliePaymentPayload({ profileId: "pfl_A" }));
        },
        () =>
          client.billing.refunds.cancel({
            paymentId: "tr_local_1",
            profileId: "pfl_B",
            refundId: "re_local_1",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "refunds.cancel" &&
      error.reason === "missing_provider_scope"
  );
  assert.deepEqual(methods, ["GET"]);
});

test("T-BIL-MOLLIE-CUSTOMER-PROFILE: requested profileId fail-closes without Mollie HTTP", async () => {
  const client = createOrgTokenClient({
    customers: { read: true, write: true },
  });
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      "customers.create",
      () =>
        client.billing.customers.create({
          idempotencyKey: "idem-cust-profile",
          name: "Example",
          profileId: "pfl_B",
        }),
    ],
    [
      "customers.get",
      () =>
        client.billing.customers.get({
          id: "cst_local_1",
          profileId: "pfl_B",
        }),
    ],
    [
      "customers.list",
      () => client.billing.customers.list({ profileId: "pfl_B" }),
    ],
    [
      "customers.update",
      () =>
        client.billing.customers.update({
          id: "cst_local_1",
          name: "Renamed",
          profileId: "pfl_B",
        }),
    ],
    [
      "customers.delete",
      () =>
        client.billing.customers.delete({
          id: "cst_local_1",
          profileId: "pfl_B",
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

test("T-BIL-MOLLIE-LINK-PROFILE: requested profileId fail-closes without Mollie HTTP", async () => {
  const client = createOrgTokenClient({
    "payment-links": { read: true, write: true },
  });
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      "paymentLinks.create",
      () =>
        client.billing.paymentLinks.create({
          amount: { currency: "EUR", value: "25.00" },
          description: "Invoice #42",
          idempotencyKey: "idem-link-profile",
          profileId: "pfl_B",
        }),
    ],
    [
      "paymentLinks.get",
      () =>
        client.billing.paymentLinks.get({
          id: "pl_local_1",
          profileId: "pfl_B",
        }),
    ],
    [
      "paymentLinks.list",
      () => client.billing.paymentLinks.list({ profileId: "pfl_B" }),
    ],
    [
      "paymentLinks.update",
      () =>
        client.billing.paymentLinks.update({
          description: "Updated",
          id: "pl_local_1",
          profileId: "pfl_B",
        }),
    ],
    [
      "paymentLinks.delete",
      () =>
        client.billing.paymentLinks.delete({
          id: "pl_local_1",
          profileId: "pfl_B",
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

test("T-BIL-MOLLIE-REFUND-LIST-PROFILE: org/advanced list includes configured profileId", async () => {
  const PROFILE_ID = "pfl_refund_list_scope";
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_resources",
          apiMode: "test",
          authority: {
            permissions: { refunds: { read: true } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: PROFILE_ID,
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
      assert.equal(requested.pathname, "/v2/refunds");
      assert.equal(requested.searchParams.get("profileId"), PROFILE_ID);
      return jsonResponse({
        _embedded: {
          refunds: [mollieRefundPayload()],
        },
        _links: {},
      });
    },
    () => client.billing.refunds.list({ limit: 20 })
  );
});

test("T-BIL-MOLLIE-LINK-CREATE: canonical payment-link creation", async () => {
  const runtime = await createLocalRuntime();
  const link = await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/payment-links$/);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.amount, { currency: "EUR", value: "25.00" });
      assert.equal(body.description, "Invoice #42");
      assert.equal(body.redirectUrl, "https://example.com/complete");
      return jsonResponse(molliePaymentLinkPayload(), 201);
    },
    () =>
      runtime.paymentLinks.create({
        amount: { currency: "EUR", value: "25.00" },
        description: "Invoice #42",
        idempotencyKey: "idem-link-create",
        redirectUrl: "https://example.com/complete",
      })
  );
  assert.equal(link.provider, "mollie");
  assert.equal(link.providerPaymentLinkId, "pl_local_1");
  assert.equal(link.description, "Invoice #42");
});

test("T-BIL-MOLLIE-LINK-DELETE-TESTMODE: access-token delete sends testmode in the DELETE body", async () => {
  const client = createAccessTokenClient({
    "payment-links": { write: true },
  });
  await withMockedFetch(
    async (url, init) => {
      const requested = new URL(String(url));
      assert.equal((init?.method ?? "").toUpperCase(), "DELETE");
      assert.equal(requested.pathname, "/v2/payment-links/pl_local_1");
      assert.equal(requested.searchParams.get("testmode"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { testmode: true });
      return jsonResponse(undefined, 204);
    },
    () => client.billing.paymentLinks.delete({ id: "pl_local_1" })
  );
});

test("T-BIL-MOLLIE-LINK-CHECKOUT: provider checkout URL projects", async () => {
  const { projectMolliePaymentLink } = await import(
    "../../src/billing/runtime/local/providers/mollie/projection/payment-link.ts"
  );
  const link = projectMolliePaymentLink(molliePaymentLinkPayload());
  assert.equal(link.checkoutUrl, "https://paymentlink.mollie.com/payment/abc");
  assert.equal(link.status, "open");
});

test("T-BIL-MOLLIE-LIST-CURSOR: local cursor is opaque", async () => {
  const runtime = await createLocalRuntime();
  const page = await withMockedFetch(
    async (url) => {
      const href = String(url);
      if (href.includes("from=")) {
        return jsonResponse({
          _embedded: {
            customers: [mollieCustomerPayload({ id: "cst_page_2" })],
          },
        });
      }
      return jsonResponse({
        _embedded: { customers: [mollieCustomerPayload()] },
        _links: {
          next: {
            href: "https://api.mollie.com/v2/customers?from=cst_page_2",
          },
        },
      });
    },
    async () => {
      const first = await runtime.customers.list({});
      assert.ok(first.nextCursor);
      assert.equal(first.nextCursor?.includes("api.mollie.com"), false);
      return runtime.customers.list({ cursor: first.nextCursor ?? undefined });
    }
  );
  assert.equal(page.items[0]?.providerCustomerId, "cst_page_2");
});

test("T-BIL-MOLLIE-TEST-CREDENTIAL: test mode uses test key across ports", async () => {
  const runtime = await createLocalRuntime(true);
  const authorizations: string[] = [];
  await withMockedFetch(
    async (_url, init) => {
      authorizations.push(
        new Headers(init?.headers).get("authorization") ?? ""
      );
      const href = String(_url);
      if (href.includes("/customers") && !href.includes("/refunds")) {
        return jsonResponse(mollieCustomerPayload(), 201);
      }
      if (href.includes("/refunds")) {
        return jsonResponse(mollieRefundPayload(), 201);
      }
      return jsonResponse(molliePaymentLinkPayload(), 201);
    },
    async () => {
      await runtime.customers.create({
        idempotencyKey: "idem-c",
        name: "Example",
      });
      await runtime.refunds.create({
        amount: { currency: "EUR", value: "5.00" },
        idempotencyKey: "idem-refund-test-cred",
        paymentId: "tr_local_1",
      });
      await runtime.paymentLinks.create({
        amount: { currency: "EUR", value: "25.00" },
        description: "Link",
        idempotencyKey: "idem-link-test-cred",
      });
    }
  );
  assert.equal(authorizations.length, 3);
  assert.ok(authorizations.every((value) => value.includes(TEST_KEY)));
  assert.equal(
    authorizations.some((value) => value.includes(LIVE_KEY)),
    false
  );
});

test("T-BIL-MOLLIE-LIVE-CREDENTIAL: live mode uses live key", async () => {
  const runtime = await createLocalRuntime(false);
  const authorizations: string[] = [];
  await withMockedFetch(
    async (_url, init) => {
      authorizations.push(
        new Headers(init?.headers).get("authorization") ?? ""
      );
      return jsonResponse(mollieCustomerPayload(), 201);
    },
    () =>
      runtime.customers.create({
        idempotencyKey: "idem-live",
        name: "Live",
      })
  );
  assert.deepEqual(authorizations, [`Bearer ${LIVE_KEY}`]);
});

test("T-BIL-MOLLIE-NO-CROSS-FALLBACK: missing selected credential fails", async () => {
  const { createLocalBillingRuntime } = await import(
    "../../src/billing/runtime/local/runtime.ts"
  );
  const { createBillingProviderRegistry } = await import(
    "../../src/billing/runtime/local/providers/create-registry.ts"
  );
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const configured = { mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY } };
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured),
    testMode: false,
  });
  await assert.rejects(
    () =>
      runtime.customers.create({
        idempotencyKey: "idem-missing",
        name: "Nope",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "missing_provider_scope" &&
      error.operation === "customers.create"
  );
});

test("T-BIL-MOLLIE-PROVIDER-CAPS: operation capability truth", async () => {
  const runtime = await createLocalRuntime();
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.ports.customers, true);
  assert.equal(capabilities.ports.refunds, true);
  assert.equal(capabilities.ports.paymentLinks, true);
  assert.equal(capabilities.ports.subscriptions, true);
  assert.equal(capabilities.ports.invoices, true);
  assert.equal(capabilities.operations["customers.create"]?.available, true);
  assert.equal(capabilities.operations["customers.get"]?.available, true);
  assert.equal(capabilities.operations["customers.list"]?.available, true);
  assert.equal(capabilities.operations["customers.update"]?.available, true);
  assert.equal(capabilities.operations["customers.delete"]?.available, true);
  assert.equal(capabilities.operations["refunds.create"]?.available, true);
  assert.equal(capabilities.operations["refunds.list"]?.available, true);
  assert.equal(capabilities.operations["refunds.get"]?.available, true);
  assert.equal(capabilities.operations["refunds.cancel"]?.available, true);
  assert.equal(capabilities.operations["paymentLinks.create"]?.available, true);
  assert.equal(capabilities.operations["paymentLinks.get"]?.available, true);
  assert.equal(capabilities.operations["paymentLinks.list"]?.available, true);
  assert.equal(capabilities.operations["paymentLinks.update"]?.available, true);
  assert.equal(capabilities.operations["paymentLinks.delete"]?.available, true);
  assert.equal(capabilities.operations["payments.create"]?.available, true);
  assert.equal(capabilities.operations["payments.get"]?.available, true);
  assert.equal(capabilities.operations["payments.list"]?.available, true);
  assert.equal(capabilities.operations["payments.cancel"]?.available, true);
});

test("T-BIL-MOLLIE-ERRORS: provider HTTP errors normalize", async () => {
  const { AthenaBillingProviderRequestError } = await import(
    "../../src/billing/errors.ts"
  );
  const runtime = await createLocalRuntime();
  await assert.rejects(
    () =>
      withMockedFetch(
        async () =>
          jsonResponse(
            {
              detail: "Unauthorized",
              status: 401,
              title: "Unauthorized Request",
            },
            401
          ),
        () =>
          runtime.customers.create({
            idempotencyKey: "idem-401",
            name: "Nope",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingProviderRequestError &&
      error.kind === "authentication" &&
      error.retry === "never"
  );
  await assert.rejects(
    () =>
      withMockedFetch(
        async () => jsonResponse({ detail: "Missing", status: 404 }, 404),
        () => runtime.customers.get({ id: "cst_missing" })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingProviderRequestError &&
      error.kind === "not_found"
  );
});

test("T-BIL-MOLLIE-SECRETS: no key in errors or serialization", async () => {
  const { AthenaBillingProviderRequestError } = await import(
    "../../src/billing/errors.ts"
  );
  const runtime = await createLocalRuntime();
  await assert.rejects(
    () =>
      withMockedFetch(
        async () =>
          jsonResponse(
            {
              authorization: TEST_KEY,
              detail: "Unauthorized",
              status: 401,
            },
            401
          ),
        () =>
          runtime.refunds.create({
            amount: { currency: "EUR", value: "5.00" },
            idempotencyKey: "idem-secret",
            paymentId: "tr_local_1",
          })
      ),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingProviderRequestError);
      assert.equal(JSON.stringify(error).includes(TEST_KEY), false);
      assert.equal(String(error).includes(TEST_KEY), false);
      return true;
    }
  );
});

test("T-BIL-LOCAL-EXECUTE-OPS: execute refuses operations marked false", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const { createLocalBillingRuntime } = await import(
    "../../src/billing/runtime/local/runtime.ts"
  );
  const { createMollieBillingProviderRuntime } = await import(
    "../../src/billing/runtime/local/providers/mollie/runtime.ts"
  );
  const { BillingProviderRegistry } = await import(
    "../../src/billing/runtime/local/providers/registry.ts"
  );
  const configured = {
    mollie: { liveKey: LIVE_KEY, sdk: FetchMollieSdk, testKey: TEST_KEY },
  };
  const mollie = createMollieBillingProviderRuntime(configured.mollie);
  const denied = Object.create(mollie, {
    getCapabilities: {
      value: async (binding: Parameters<typeof mollie.getCapabilities>[0]) => {
        const capabilities = await mollie.getCapabilities(binding);
        return {
          ...capabilities,
          operations: {
            ...capabilities.operations,
            "customers.update": false,
          },
        };
      },
    },
  });
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: new BillingProviderRegistry([denied]),
    testMode: true,
  });
  await assert.rejects(
    () =>
      withMockedFetch(
        async () => {
          throw new Error("customers.update must not call Mollie");
        },
        () =>
          runtime.customers.update({
            id: "cst_local_1",
            name: "Denied",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "customers.update" &&
      error.reason === "unsupported_operation"
  );
});

test("T-BIL-MOLLIE-LIST-OFFSET: local lists fail closed on offset", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const runtime = await createLocalRuntime();
  const lists = [
    [
      "customers.list",
      () => runtime.customers.list({ limit: 20, offset: 100 }),
    ],
    ["refunds.list", () => runtime.refunds.list({ limit: 20, offset: 100 })],
    [
      "paymentLinks.list",
      () => runtime.paymentLinks.list({ limit: 20, offset: 100 }),
    ],
  ] as const;
  for (const [operation, run] of lists) {
    await assert.rejects(
      () =>
        withMockedFetch(async () => {
          throw new Error(`${operation} must not call Mollie`);
        }, run),
      (error: unknown) =>
        error instanceof AthenaBillingCapabilityError &&
        error.operation === operation &&
        error.reason === "unsupported_operation"
    );
  }
});

test("T-BIL-MOLLIE-NO-REMOTE: local mode never calls /billing/v1", async () => {
  const urls: string[] = [];
  const client = createLocalClient();
  await withMockedFetch(
    async (url) => {
      urls.push(String(url));
      return jsonResponse(mollieCustomerPayload(), 201);
    },
    () =>
      client.billing.customers.create({
        idempotencyKey: "idem-ns",
        name: "Example",
      })
  );
  assert.equal(
    urls.some((url) => url.includes("/billing/v1")),
    false
  );
  assert.ok(urls.some((url) => url.includes("api.mollie.com")));
});

test("T-BIL-REMOTE-NAMESPACE-PARITY: canonical namespaces work remotely", async () => {
  const urls: string[] = [];
  const client = createClient({
    billing: { mode: "remote" },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await withMockedFetch(
    async (url, init) => {
      urls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
      return new Response(
        JSON.stringify({ data: { providerCustomerId: "cst_r" } }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      );
    },
    () =>
      client.billing.customers.create({
        connectionId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "idem-remote",
        name: "Remote",
      })
  );
  assert.ok(
    urls.some(
      (url) => url.includes("POST ") && url.includes("/billing/v1/customers")
    )
  );
  assert.equal(
    urls.some((url) => url.includes("api.mollie.com")),
    false
  );
});

test("T-BIL-MOLLIE-TRANSPORT: payments use shared SDK pool, not client.ts", () => {
  assert.equal(
    readFileSync(
      join(billingDir, "runtime/local/providers/mollie/sdk/client-factory.ts"),
      "utf8"
    ).includes("revealForProviderRuntime"),
    true
  );
  assert.equal(
    readBilling("runtime/local/providers/mollie/payments.ts").includes(
      'from "./client.ts"'
    ),
    false
  );
  assert.equal(
    readBilling("runtime/local/providers/mollie/customers.ts").includes(
      "revealForProviderRuntime"
    ),
    false
  );
});
