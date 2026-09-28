import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaBillingModule } from "../src/billing/module.ts";
import type { AthenaBillingRuntimeDispatch } from "../src/billing/runtime/dispatch.ts";
import { createRequestScopedBillingFacade } from "../src/billing/runtime/self/request-port.ts";

function createFixture() {
  const calls: Array<{
    operation: string;
    payload: unknown;
    principal: {
      organizationId?: string;
      rights: readonly string[];
      userId?: string;
    };
  }> = [];
  const runtime = {
    execute: async (
      operation: Parameters<AthenaBillingRuntimeDispatch["execute"]>[0],
      payload: unknown,
      principal: Parameters<AthenaBillingRuntimeDispatch["execute"]>[2],
    ) => {
      calls.push({ operation, payload, principal });
      return { operation, userId: principal.userId };
    },
  } as unknown as AthenaBillingRuntimeDispatch;
  const self = {
    checkout: {},
    customer: {},
    entitlements: async () => undefined,
    invoices: {},
    payments: {},
    subscription: {},
  };
  const admin = { marker: "process-owned-admin" };
  const base = { admin, self } as unknown as AthenaBillingModule;
  return { base, calls, runtime };
}

test("request Billing overlays self without changing process-owned ports", async () => {
  const fixture = createFixture();
  const scoped = createRequestScopedBillingFacade({
    base: fixture.base,
    organizationId: "org_a",
    runtime: fixture.runtime,
    userId: "user_a",
  });

  const result = await scoped.self.payments.list({ limit: 10 });

  assert.deepEqual(result, {
    operation: "self.payments.list",
    userId: "user_a",
  });
  assert.equal(scoped.admin, fixture.base.admin);
  assert.notEqual(scoped.self, fixture.base.self);
  assert.equal(fixture.calls[0]?.principal.userId, "user_a");
  assert.equal(fixture.calls[0]?.principal.organizationId, "org_a");
  assert.deepEqual(fixture.calls[0]?.principal.rights, [
    "billing.self.payments.read",
  ]);
});

test("request self ports keep concurrent users isolated", async () => {
  const fixture = createFixture();
  const userA = createRequestScopedBillingFacade({
    base: fixture.base,
    runtime: fixture.runtime,
    userId: "user_a",
  });
  const userB = createRequestScopedBillingFacade({
    base: fixture.base,
    runtime: fixture.runtime,
    userId: "user_b",
  });

  await Promise.all([
    userA.self.checkout.resume({ returnToken: "return_a" }),
    userB.self.checkout.resume({ returnToken: "return_b" }),
  ]);

  assert.deepEqual(
    fixture.calls.map((call) => [call.operation, call.principal.userId]),
    [
      ["self.checkout.resume", "user_a"],
      ["self.checkout.resume", "user_b"],
    ],
  );
});
