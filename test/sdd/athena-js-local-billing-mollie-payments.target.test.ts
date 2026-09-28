import { strict as assert } from "node:assert/strict";
/**
 * Target — PR A Mollie payment port finality (get / list / cancel).
 *
 * Billing domain identity only. No Data Nucleus, Policy IR, Schema IR, or migrations.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const billingDir = join(srcRoot, "billing");
const mollieDir = join(billingDir, "runtime", "local", "providers", "mollie");

const TEST_KEY = "test_athena_mollie_payments";
const LIVE_KEY = "live_athena_mollie_payments";

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function joinedSources(dir: string): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

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

function molliePaymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: { currency: "EUR", value: "10.00" },
    amountRefunded: { currency: "EUR", value: "0.00" },
    createdAt: "2026-08-23T10:00:00+00:00",
    customerId: "cst_local",
    description: "Order 42",
    id: "tr_local_1",
    metadata: { orderId: "42" },
    paidAt: null,
    profileId: "pfl_local",
    resource: "payment",
    status: "open",
    subscriptionId: null,
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

test("ACT-BILLING-MOLLIE-001: Mollie provider files must not import runtime/data/nucleus", () => {
  const src = joinedSources(mollieDir);
  assert.doesNotMatch(src, /runtime\/data\/nucleus/);
  assert.doesNotMatch(src, /from ["'][^"']*nucleus/);
});

test("ACT-BILLING-MOLLIE-002: Mollie provider files must not import Policy IR", () => {
  const src = joinedSources(mollieDir);
  assert.doesNotMatch(src, /from ["'][^"']*\/policy\//);
  assert.doesNotMatch(src, /BillingPolicyIR|PolicyDecision/);
});

test("ACT-BILLING-MOLLIE-003: Mollie provider files must not import Schema IR model builders", () => {
  const src = joinedSources(mollieDir);
  assert.doesNotMatch(src, /from ["'][^"']*\/schema\//);
  assert.doesNotMatch(src, /defineModel|AthenaResourceRef/);
});

test("ACT-BILLING-MOLLIE-004: PR adds no billing migration", () => {
  const billingSrc = joinedSources(billingDir);
  assert.doesNotMatch(billingSrc, /CREATE TABLE/i);
  assert.doesNotMatch(billingSrc, /src\/migrations/);
  for (const name of [
    "migrations",
    "athena/migrations",
    "embedded-migrations",
    "managed-runtime-migrations",
  ]) {
    assert.equal(
      existsSync(join(srcRoot, name, "billing_payments.sql")),
      false
    );
  }
});

test("ACT-BILLING-MOLLIE-005: provider execution resolves through BillingProviderRegistry", () => {
  const src = readBilling("runtime/local/execute/payments.ts");
  assert.match(src, /executeLocalBillingOperation/);
  assert.match(src, /executeLocalBillingPaymentGet/);
  assert.match(src, /executeLocalBillingPaymentList/);
  assert.match(src, /executeLocalBillingPaymentCancel/);
  assert.match(
    readBilling("runtime/local/execute/invoke.ts"),
    /prepareLocalBillingInvocation/
  );
  assert.doesNotMatch(src, /MolliePaymentExecutor|MollieRuntimeResolver/);
});

test("ACT-BILLING-MOLLIE-006: capability true requires corresponding port implementation", async () => {
  const { createMollieBillingProviderRuntime } = await import(
    "../../src/billing/runtime/local/providers/mollie/runtime.ts"
  );
  const runtime = createMollieBillingProviderRuntime({
    sdk: FetchMollieSdk,
    testKey: TEST_KEY,
  });
  const capabilities = await runtime.getCapabilities({
    credentials: {},
    kind: "configured",
    provider: "mollie",
    providerConfig: {},
  });
  assert.equal(capabilities.operations["payments.get"], true);
  assert.equal(capabilities.operations["payments.list"], true);
  assert.equal(capabilities.operations["payments.cancel"], true);
  assert.equal(typeof runtime.payments?.get, "function");
  assert.equal(typeof runtime.payments?.list, "function");
  assert.equal(typeof runtime.payments?.cancel, "function");
});

test("ACT-BILLING-MOLLIE-007: local mode cannot invoke RemoteBillingRuntime", () => {
  const localSrc = [
    readBilling("runtime/local/runtime.ts"),
    readBilling("runtime/local/execute/payments.ts"),
    readBilling("runtime/local/execute/shared.ts"),
    joinedSources(mollieDir),
  ].join("\n");
  assert.doesNotMatch(localSrc, /createRemoteBillingRuntime/);
  assert.doesNotMatch(localSrc, /RemoteBillingRuntime/);
});

test("ACT-BILLING-MOLLIE-008: provider cursor remains opaque at public boundary", async () => {
  const runtime = await createLocalRuntime();
  const page = await withMockedFetch(
    async () =>
      jsonResponse({
        _embedded: {
          payments: [molliePaymentPayload()],
        },
        _links: {
          next: {
            href: "https://api.mollie.com/v2/payments?from=tr_local_2&limit=50",
          },
        },
      }),
    () => runtime.payments.list({})
  );
  assert.equal(page.items.length, 1);
  assert.equal(typeof page.nextCursor, "string");
  assert.notEqual(page.nextCursor, null);
  assert.equal(String(page.nextCursor).includes("api.mollie.com"), false);
  assert.equal(String(page.nextCursor).includes("https://"), false);
  assert.equal(String(page.nextCursor).includes("tr_local_2"), false);
});

test("T-BIL-MOLLIE-PAYMENT-GET: canonical payment maps through Mollie GET", async () => {
  const runtime = await createLocalRuntime();
  const payment = await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/payments\/tr_local_1$/);
      assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
      return jsonResponse(molliePaymentPayload({ status: "paid" }));
    },
    () => runtime.payments.get({ id: "tr_local_1" })
  );
  assert.equal(payment.provider, "mollie");
  assert.equal(payment.providerPaymentId, "tr_local_1");
  assert.equal(payment.status, "paid");
  assert.equal(payment.amount.value, "10.00");
});

test("T-BIL-MOLLIE-PAYMENT-LIST-PROFILE: org/advanced list includes configured profileId", async () => {
  const PROFILE_ID = "pfl_list_scope";
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { read: true } },
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
      assert.equal(requested.pathname, "/v2/payments");
      assert.equal(requested.searchParams.get("profileId"), PROFILE_ID);
      return jsonResponse({
        _embedded: {
          payments: [molliePaymentPayload()],
        },
        _links: {},
      });
    },
    () => client.billing.payments.list({ limit: 20 })
  );
});

test("T-BIL-MOLLIE-PAYMENT-TARGET-PROFILE: requested profile overrides configured for org tokens", async () => {
  const CONFIGURED = "pfl_configured";
  const REQUESTED = "pfl_requested";
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { read: true, write: true } },
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
      assert.equal(requested.searchParams.get("profileId"), REQUESTED);
      return jsonResponse({
        _embedded: { payments: [molliePaymentPayload()] },
        _links: {},
      });
    },
    () =>
      client.billing.payments.list({
        limit: 20,
        profileId: REQUESTED,
      })
  );
  await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/payments$/);
      const body = JSON.parse(String(init?.body)) as { profileId?: string };
      assert.equal(body.profileId, REQUESTED);
      return jsonResponse(molliePaymentPayload());
    },
    () =>
      client.billing.payments.create({
        amount: { currency: "EUR", value: "10.00" },
        description: "Targeted",
        idempotencyKey: "idemp_target_profile",
        profileId: REQUESTED,
      })
  );
});

test("T-BIL-MOLLIE-PAYMENT-API-KEY-PROFILE: API keys never send profileId", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          liveKey: LIVE_KEY,
          profileId: "pfl_config_only",
          sdk: FetchMollieSdk,
          testKey: TEST_KEY,
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
      assert.equal(requested.searchParams.get("profileId"), null);
      return jsonResponse({
        _embedded: { payments: [molliePaymentPayload()] },
        _links: {},
      });
    },
    () => client.billing.payments.list({ limit: 20 })
  );
});

test("T-BIL-MOLLIE-PAYMENT-LIST: list projects BillingPage", async () => {
  const runtime = await createLocalRuntime();
  const page = await withMockedFetch(
    async (url) => {
      assert.match(String(url), /\/v2\/payments/);
      return jsonResponse({
        _embedded: {
          payments: [
            molliePaymentPayload(),
            molliePaymentPayload({ description: "Second", id: "tr_local_2" }),
          ],
        },
        _links: {
          next: {
            href: "https://api.mollie.com/v2/payments?from=tr_local_2&limit=50",
          },
        },
      });
    },
    () => runtime.payments.list({ limit: 50 })
  );
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.providerPaymentId, "tr_local_1");
  assert.equal(page.items[1]?.providerPaymentId, "tr_local_2");
  assert.equal(typeof page.nextCursor, "string");
});

test("T-BIL-MOLLIE-PAYMENT-CANCEL: DELETE payment projects canceled status", async () => {
  const runtime = await createLocalRuntime();
  const payment = await withMockedFetch(
    async (url, init) => {
      assert.match(String(url), /\/v2\/payments\/tr_local_1$/);
      assert.equal((init?.method ?? "").toUpperCase(), "DELETE");
      return jsonResponse(molliePaymentPayload({ status: "canceled" }));
    },
    () => runtime.payments.cancel({ id: "tr_local_1" })
  );
  assert.equal(payment.providerPaymentId, "tr_local_1");
  assert.equal(payment.status, "canceled");
});

test("T-BIL-MOLLIE-PAYMENT-CANCEL-TESTMODE: access-token cancel sends testmode in the DELETE body", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { write: true } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: "pfl_cancel_scope",
          scope: { kind: "organization" },
          sdk: FetchMollieSdk,
        },
      },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const methods: string[] = [];
  await withMockedFetch(
    async (url, init) => {
      const requested = new URL(String(url));
      const method = (init?.method ?? "GET").toUpperCase();
      methods.push(method);
      assert.equal(requested.pathname, "/v2/payments/tr_local_1");
      if (method === "GET") {
        return jsonResponse(
          molliePaymentPayload({ profileId: "pfl_cancel_scope" })
        );
      }
      assert.equal(method, "DELETE");
      assert.equal(requested.searchParams.get("testmode"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { testmode: true });
      return jsonResponse(
        molliePaymentPayload({
          profileId: "pfl_cancel_scope",
          status: "canceled",
        })
      );
    },
    () => client.billing.payments.cancel({ id: "tr_local_1" })
  );
  assert.deepEqual(methods, ["GET", "DELETE"]);
});

test("T-BIL-MOLLIE-PAYMENT-CANCEL-PROFILE: requested profile mismatch does not cancel", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { write: true } },
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
  const methods: string[] = [];
  await assert.rejects(
    () =>
      withMockedFetch(
        async (url, init) => {
          const method = (init?.method ?? "GET").toUpperCase();
          methods.push(method);
          assert.equal(method, "GET");
          assert.match(String(url), /\/v2\/payments\/tr_local_1/);
          return jsonResponse(
            molliePaymentPayload({ profileId: "pfl_A", status: "open" })
          );
        },
        () =>
          client.billing.payments.cancel({
            id: "tr_local_1",
            profileId: "pfl_B",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "payments.cancel" &&
      error.reason === "missing_provider_scope"
  );
  assert.deepEqual(methods, ["GET"]);
});

test("T-BIL-MOLLIE-PAYMENT-CANCEL-PROFILE-MATCH: matching profile GET then DELETE", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { write: true } },
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
  const methods: string[] = [];
  const payment = await withMockedFetch(
    async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      methods.push(method);
      assert.match(String(url), /\/v2\/payments\/tr_local_1/);
      if (method === "GET") {
        return jsonResponse(molliePaymentPayload({ profileId: "pfl_B" }));
      }
      assert.equal(method, "DELETE");
      return jsonResponse(
        molliePaymentPayload({ profileId: "pfl_B", status: "canceled" })
      );
    },
    () =>
      client.billing.payments.cancel({
        id: "tr_local_1",
        profileId: "pfl_B",
      })
  );
  assert.deepEqual(methods, ["GET", "DELETE"]);
  assert.equal(payment.status, "canceled");
});

test("T-BIL-MOLLIE-PAYMENT-GET-PROFILE: requested profile mismatch does not return payment", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { read: true } },
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
  await assert.rejects(
    () =>
      withMockedFetch(
        async (url, init) => {
          assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
          assert.match(String(url), /\/v2\/payments\/tr_local_1/);
          return jsonResponse(
            molliePaymentPayload({ profileId: "pfl_A", status: "paid" })
          );
        },
        () =>
          client.billing.payments.get({
            id: "tr_local_1",
            profileId: "pfl_B",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "payments.get" &&
      error.reason === "missing_provider_scope"
  );
});

test("T-BIL-MOLLIE-PAYMENT-GET-PROFILE-MATCH: matching profile returns the payment", async () => {
  const client = createClient({
    billing: {
      mode: "local",
      providers: {
        mollie: {
          accessToken: "access_athena_mollie_payments",
          apiMode: "test",
          authority: {
            permissions: { payments: { read: true } },
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
  const payment = await withMockedFetch(
    async (url, init) => {
      assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
      assert.match(String(url), /\/v2\/payments\/tr_local_1/);
      return jsonResponse(
        molliePaymentPayload({ profileId: "pfl_B", status: "paid" })
      );
    },
    () =>
      client.billing.payments.get({
        id: "tr_local_1",
        profileId: "pfl_B",
      })
  );
  assert.equal(payment.providerPaymentId, "tr_local_1");
  assert.equal(payment.providerProfileId, "pfl_B");
  assert.equal(payment.status, "paid");
});

test("T-BIL-MOLLIE-PAYMENT-LIST-OFFSET: local list fails closed on offset", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const runtime = await createLocalRuntime();
  await assert.rejects(
    () =>
      withMockedFetch(
        async () => {
          throw new Error("payments.list must not call Mollie");
        },
        () => runtime.payments.list({ limit: 20, offset: 100 })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "payments.list" &&
      error.reason === "unsupported_operation"
  );
});

test("T-BIL-MOLLIE-PAYMENT-LIST-PERSISTENCE: local list fails closed on persistence source", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const client = createLocalClient();
  await assert.rejects(
    () =>
      withMockedFetch(
        async () => {
          throw new Error("payments.list must not call Mollie");
        },
        () =>
          client.billing.payments.list({
            limit: 20,
            source: "persistence",
          })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.operation === "payments.list" &&
      error.reason === "unsupported_operation"
  );
});

test("T-BIL-MOLLIE-PAYMENT-LIST-PROVIDER-SOURCE: local list still queries Mollie for provider source", async () => {
  const client = createLocalClient();
  const page = await withMockedFetch(
    async (url) => {
      assert.match(String(url), /\/v2\/payments/);
      return jsonResponse({
        _embedded: { payments: [molliePaymentPayload()] },
        _links: {},
      });
    },
    () =>
      client.billing.payments.list({
        limit: 20,
        source: "provider",
      })
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.providerPaymentId, "tr_local_1");
});

test("T-BIL-REMOTE-PAYMENT-LIST-OFFSET: remote list fails closed on offset", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const { createRemoteBillingRuntime } = await import(
    "../../src/billing/runtime/remote/runtime.ts"
  );
  const client = createClient({
    billing: { mode: "remote" },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const runtime = createRemoteBillingRuntime({
    apiKey: "ak_test",
    baseUrl: "https://athena.example.com",
  });
  const rejected = (error: unknown) =>
    error instanceof AthenaBillingCapabilityError &&
    error.operation === "payments.list" &&
    error.reason === "unsupported_operation";
  const mustNotFetch = async () => {
    throw new Error("payments.list must not call GET /billing/v1/payments");
  };
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        client.billing.payments.list({
          connectionId: "11111111-1111-1111-1111-111111111111",
          limit: 20,
          offset: 100,
        })
      ),
    rejected
  );
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        runtime.payments.list({
          connectionId: "11111111-1111-1111-1111-111111111111",
          limit: 10,
        })
      ),
    rejected
  );
});

test("T-BIL-REMOTE-PAYMENT-PROFILE: remote rejects unenforced profileId", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const { createRemoteBillingRuntime } = await import(
    "../../src/billing/runtime/remote/runtime.ts"
  );
  const client = createClient({
    billing: { mode: "remote" },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const runtime = createRemoteBillingRuntime({
    apiKey: "ak_test",
    baseUrl: "https://athena.example.com",
  });
  const rejected = (operation: string) => (error: unknown) =>
    error instanceof AthenaBillingCapabilityError &&
    error.operation === operation &&
    error.reason === "unsupported_operation";
  const mustNotFetch = async () => {
    throw new Error("must not call GET /billing/v1");
  };
  const target = {
    connectionId: "11111111-1111-1111-1111-111111111111",
    profileId: "pfl_B",
  };
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () => client.billing.payments.list(target)),
    rejected("payments.list")
  );
  await assert.rejects(
    () => withMockedFetch(mustNotFetch, () => runtime.payments.list(target)),
    rejected("payments.list")
  );
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        client.billing.payments.get({ ...target, id: "tr_r" })
      ),
    rejected("payments.get")
  );
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        runtime.payments.get({ ...target, id: "tr_r" })
      ),
    rejected("payments.get")
  );
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        client.billing.payments.cancel({ ...target, id: "tr_r" })
      ),
    rejected("payments.cancel")
  );
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        runtime.payments.cancel({ ...target, id: "tr_r" })
      ),
    rejected("payments.cancel")
  );
  await assert.rejects(
    () =>
      withMockedFetch(mustNotFetch, () =>
        client.billing.getCapabilities(target)
      ),
    rejected("getCapabilities")
  );
});

test("T-BIL-REMOTE-CAPS-CONNECTION: remote getCapabilities requires connectionId before fetch", async () => {
  const { AthenaBillingCapabilityError } = await import(
    "../../src/billing/errors.ts"
  );
  const { createRemoteBillingRuntime } = await import(
    "../../src/billing/runtime/remote/runtime.ts"
  );
  const client = createClient({
    billing: { mode: "remote" },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const runtime = createRemoteBillingRuntime({
    apiKey: "ak_test",
    baseUrl: "https://athena.example.com",
  });
  const rejected = (error: unknown) =>
    error instanceof AthenaBillingCapabilityError &&
    error.operation === "getCapabilities" &&
    error.reason === "missing_connection";
  const mustNotFetch = async () => {
    throw new Error(
      "getCapabilities must not call GET /billing/v1/capabilities"
    );
  };
  for (const target of [
    {},
    { provider: "mollie" },
    { connectionId: "" },
  ] as const) {
    await assert.rejects(
      () =>
        withMockedFetch(mustNotFetch, () =>
          client.billing.getCapabilities(target)
        ),
      rejected
    );
    await assert.rejects(
      () =>
        withMockedFetch(mustNotFetch, () => runtime.getCapabilities(target)),
      rejected
    );
  }
});

test("T-BIL-MOLLIE-PAYMENT-CAPS: get/list/cancel are advertised", async () => {
  const runtime = await createLocalRuntime();
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.operations["payments.create"]?.available, true);
  assert.equal(capabilities.operations["payments.get"]?.available, true);
  assert.equal(capabilities.operations["payments.list"]?.available, true);
  assert.equal(capabilities.operations["payments.cancel"]?.available, true);
});

test("T-BIL-MOLLIE-PAYMENT-CURSOR-RESOURCE: list cursor is payments-scoped", () => {
  const src = readBilling("runtime/local/providers/mollie/cursor.ts");
  assert.match(src, /"payments"/);
  assert.doesNotMatch(src, /AthenaResourceRef/);
});

test("T-BIL-REMOTE-PAYMENT-PARITY: remote get/list/cancel hit /billing/v1", async () => {
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
        JSON.stringify({
          data: {
            amount: { currency: "EUR", value: "1.00" },
            items: [],
            metadata: {},
            provider: "mollie",
            providerPaymentId: "tr_r",
            raw: {},
            status: "pending",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      );
    },
    async () => {
      await client.billing.payments.get({
        connectionId: "11111111-1111-1111-1111-111111111111",
        id: "tr_r",
      });
      await client.billing.payments.list({
        connectionId: "11111111-1111-1111-1111-111111111111",
      });
      await client.billing.payments.cancel({
        connectionId: "11111111-1111-1111-1111-111111111111",
        id: "tr_r",
      });
    }
  );
  assert.ok(
    urls.some(
      (url) => url.includes("GET ") && url.includes("/billing/v1/payments/tr_r")
    )
  );
  assert.ok(
    urls.some(
      (url) => url.includes("GET ") && url.includes("/billing/v1/payments")
    )
  );
  assert.ok(
    urls.some(
      (url) =>
        url.includes("POST ") &&
        url.includes("/billing/v1/payments/tr_r/cancel")
    )
  );
  assert.equal(
    urls.some((url) => url.includes("api.mollie.com")),
    false
  );
});

test("T-BIL-LOCAL-PAYMENT-NO-REMOTE: local get never calls /billing/v1", async () => {
  const urls: string[] = [];
  const client = createLocalClient();
  await withMockedFetch(
    async (url) => {
      urls.push(String(url));
      return jsonResponse(molliePaymentPayload());
    },
    () => client.billing.payments.get({ id: "tr_local_1" })
  );
  assert.equal(
    urls.some((url) => url.includes("/billing/v1")),
    false
  );
  assert.ok(urls.some((url) => url.includes("api.mollie.com")));
});

test("T-BIL-PROVIDER-PAYMENT-PORT: provider port is create/get/list/cancel", () => {
  const src = readBilling("runtime/local/providers/types.ts");
  assert.match(src, /export interface BillingProviderPaymentPort/);
  assert.match(src, /create\(/);
  assert.match(src, /get\(/);
  assert.match(src, /list\(/);
  assert.match(src, /cancel\(/);
  assert.doesNotMatch(src, /AthenaResourceRef/);
});
