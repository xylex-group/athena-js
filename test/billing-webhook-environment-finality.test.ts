import assert from "node:assert/strict";
import test from "node:test";
import { inspectBillingWebhookIngressBinding } from "../src/billing/import/postgres.ts";
import { AthenaBillingProviderRequestError } from "../src/billing/errors.ts";
import { createAthenaBillingIngressHandlers } from "../src/next/billing-ingress-handlers.ts";
import {
  attachAthenaClientInternals,
  createRootClientInternals,
  getAthenaClientInternals,
} from "../src/runtime/client-internals.ts";
import {
  ATHENA_EVENT_INGRESS_FAILED,
  AthenaEventIngressError,
  isAthenaEventIngressError,
} from "../src/runtime/ingress/errors.ts";
import { wrapIngressProcessingError } from "../src/runtime/ingress/failure.ts";
import type { AthenaIngressIR } from "../src/runtime/ingress/ir.ts";
import type { PostgresPoolManager } from "../src/postgres/pool/manager.ts";

test("inspect reports a disabled other-environment binding as superseded", async () => {
  const inspected = await inspectBillingWebhookIngressBinding(
    {
      async query() {
        return {
          rows: [
            {
              environment: "test",
              id: "conn-test",
              status: "disabled",
            },
          ],
        };
      },
    },
    { processEnvironment: "live", token: "xOZDdN2cCzuznB7PSO0m_ZVmVUTpklYb" }
  );
  assert.equal(inspected.kind, "environment_superseded");
  if (inspected.kind === "environment_superseded") {
    assert.equal(inspected.connectionEnvironment, "test");
    assert.equal(inspected.processEnvironment, "live");
    assert.equal(inspected.connectionId, "conn-test");
  }
});

test("inspect still resolves an active binding after the process environment changes", async () => {
  const inspected = await inspectBillingWebhookIngressBinding(
    {
      async query() {
        return {
          rows: [
            {
              environment: "test",
              id: "conn-test",
              status: "active",
            },
          ],
        };
      },
    },
    { processEnvironment: "live", token: "still-active-test-token" }
  );
  assert.deepEqual(inspected, {
    connectionId: "conn-test",
    kind: "resolved",
  });
});

test("provider refetch failures keep causal fields on the ingress error", () => {
  const wrapped = wrapIngressProcessingError({
    connectionId: "conn-live",
    error: new AthenaBillingProviderRequestError({
      kind: "not_found",
      message: "payment missing",
      operation: "payments.get",
      provider: "mollie",
      retry: "never",
      status: 404,
    }),
    stage: "refetch",
  });
  assert.equal(isAthenaEventIngressError(wrapped), true);
  if (!isAthenaEventIngressError(wrapped)) {
    throw new Error("expected AthenaEventIngressError");
  }
  assert.equal(wrapped.code, ATHENA_EVENT_INGRESS_FAILED);
  assert.equal(wrapped.provider, "mollie");
  assert.equal(wrapped.diagnostics?.stage, "refetch");
  assert.equal(wrapped.diagnostics?.operation, "payments.get");
  assert.equal(wrapped.diagnostics?.connectionId, "conn-live");
  assert.equal(wrapped.diagnostics?.providerStatus, 404);
  assert.equal(wrapped.retryable, false);
});

function stubRootWithBindingLookup(
  rows: readonly Record<string, unknown>[],
  testMode: boolean
) {
  const client = {};
  attachAthenaClientInternals(
    client,
    createRootClientInternals({
      config: { auth: false, billing: { testMode } },
      eventIngressRuntime: {
        ingest: async (_ingress: AthenaIngressIR) => ({
          duplicate: false,
          events: [],
          reconciliation: "completed",
        }),
      },
      plan: {
        auth: { runtime: "disabled" },
        db: { transport: "gateway" },
        runtime: { environment: "node" },
        storage: { transport: "none" },
      },
    })
  );
  const internals = getAthenaClientInternals(client);
  assert.ok(internals);
  internals.postgresRuntime = {
    getPoolManager: async () =>
      ({
        async query() {
          return { rows };
        },
      }) as unknown as PostgresPoolManager,
  } as never;
  return client;
}

test("Classic token for a superseded environment is diagnostic 404, not unknown", async () => {
  const handlers = createAthenaBillingIngressHandlers({
    client: stubRootWithBindingLookup(
      [{ environment: "test", id: "conn-test", status: "disabled" }],
      false
    ),
  });
  const response = await handlers.POST(
    new Request(
      "http://localhost/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
      { method: "POST" }
    )
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "ATHENA_BILLING_WEBHOOK_BINDING_ENVIRONMENT_SUPERSEDED",
    message:
      "The Billing webhook binding belongs to a superseded connection environment.",
    reason: "environment_superseded",
  });
});

test("Next adapter logs provider refetch diagnostics instead of only the envelope", async () => {
  const client = stubRootWithBindingLookup(
    [{ environment: "live", id: "conn-live", status: "active" }],
    false
  );
  const internals = getAthenaClientInternals(client);
  assert.ok(internals);
  internals.eventIngressRuntime = {
    ingest: async () => {
      throw new AthenaBillingProviderRequestError({
        kind: "timeout",
        message: "Mollie timeout",
        operation: "payments.get",
        provider: "mollie",
        retry: "safe",
        status: 504,
      });
    },
  };
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const handlers = createAthenaBillingIngressHandlers({ client });
    const response = await handlers.POST(
      new Request(
        "http://localhost/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
        {
          body: "id=tr_ZmLn2eFGvahfK7Q6vkLWJ",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        }
      )
    );
    assert.equal(response.status, 400);
    const json = (await response.json()) as { code: string };
    assert.equal(json.code, ATHENA_EVENT_INGRESS_FAILED);
  } finally {
    console.error = original;
  }
  const rejected = errors.find(
    (entry) =>
      Array.isArray(entry) &&
      entry[0] === "[athena.billing] webhook ingress rejected"
  );
  assert.ok(rejected);
  const details = (rejected as unknown[])[1] as {
    operation?: string;
    provider?: string;
    providerStatus?: number;
    stage?: string;
  };
  assert.equal(details.operation, "payments.get");
  assert.equal(details.provider, "mollie");
  assert.equal(details.providerStatus, 504);
  assert.equal(details.stage, "refetch");
});
