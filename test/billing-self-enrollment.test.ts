import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { PROCESS_BILLING_INVOCATION } from "../src/billing/runtime/invocation-authority.ts";
import { createBillingProviderRegistry } from "../src/billing/runtime/local/providers/create-registry.ts";
import { createLocalBillingRuntime } from "../src/billing/runtime/local/runtime.ts";
import {
  isBillingSelfEnrollmentEnabled,
  isBillingSelfPlanChangeEnabled,
} from "../src/billing/self-enrollment.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const SELF_ENROLLMENT_CAPABILITY_CASES = [
  { config: false, enrollment: false, planChange: false },
  { config: true, enrollment: true, planChange: false },
  {
    config: {},
    enrollment: false,
    planChange: false,
  },
  {
    config: { enabled: false, planChange: false },
    enrollment: false,
    planChange: false,
  },
  {
    config: { enabled: false },
    enrollment: false,
    planChange: false,
  },
  {
    config: { enabled: false, planChange: true },
    enrollment: false,
    planChange: true,
  },
  {
    config: { enabled: true, planChange: false },
    enrollment: true,
    planChange: false,
  },
  {
    config: { enabled: true },
    enrollment: true,
    planChange: false,
  },
  {
    config: { enabled: true, planChange: true },
    enrollment: true,
    planChange: true,
  },
  {
    config: { planChange: false },
    enrollment: false,
    planChange: false,
  },
  {
    config: { planChange: true },
    enrollment: false,
    planChange: true,
  },
] as const;

test("self enrollment kill switch honors explicit config", () => {
  assert.equal(isBillingSelfEnrollmentEnabled(true), true);
  assert.equal(isBillingSelfEnrollmentEnabled(false), false);
  assert.equal(isBillingSelfEnrollmentEnabled({ enabled: true }), true);
  assert.equal(isBillingSelfEnrollmentEnabled({ enabled: false }), false);
});

test("self enrollment capability truth table keeps plan changes explicit", () => {
  for (const {
    config,
    enrollment,
    planChange,
  } of SELF_ENROLLMENT_CAPABILITY_CASES) {
    assert.equal(isBillingSelfEnrollmentEnabled(config), enrollment);
    assert.equal(isBillingSelfPlanChangeEnabled(config), planChange);
  }
});

test("local capabilities mirror the enrollment truth table", async () => {
  for (const {
    config,
    enrollment,
    planChange,
  } of SELF_ENROLLMENT_CAPABILITY_CASES) {
    const configuredProviders = {
      mollie: {
        sdk: FetchMollieSdk,
        testKey: "test_self_enrollment_capabilities",
      },
    };
    const sql = {
      async query(text: string) {
        if (text.includes("FROM billing.billing_provider_connections")) {
          return {
            rows: [
              {
                credential_reference: "providers.mollie",
                environment: "test",
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                owner_id: "app-a",
                owner_kind: "tenant",
                provider: "mollie",
                status: "active",
              },
            ],
          };
        }
        return { rows: [] };
      },
      async transaction<T>(fn: (executor: typeof sql) => Promise<T>) {
        return fn(sql);
      },
    };
    const runtime = createLocalBillingRuntime({
      applicationId: "app-a",
      configuredProviders,
      invocation: PROCESS_BILLING_INVOCATION,
      registry: createBillingProviderRegistry(configuredProviders, {
        prices: [
          {
            amount: { currency: "EUR", value: "10.00" },
            id: "starter-monthly",
            interval: "month",
            productId: "starter",
          },
        ],
        products: [{ id: "starter", name: "Starter" }],
      }),
      selfEnrollmentEnabled: config,
      sql,
      testMode: true,
    });
    const capabilities = await runtime.getCapabilities({ provider: "mollie" });

    assert.equal(
      capabilities.operations["self.subscription.enroll"]?.available,
      enrollment
    );
    assert.equal(
      capabilities.operations["self.subscription.change"]?.available,
      planChange
    );
    assert.equal(
      capabilities.operations["self.subscription.change"]?.safety,
      "disabled"
    );
  }
});

test("local plan-change safety reflects an enabled recovery coordinator", async () => {
  const configuredProviders = {
    mollie: {
      sdk: FetchMollieSdk,
      testKey: "test_self_enrollment_recovery",
    },
  };
  const runtime = createLocalBillingRuntime({
    configuredProviders,
    connectionState: {
      connections: [],
      initialized: true,
      recoveryCoordinatorEnabled: true,
    },
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configuredProviders, {
      prices: [
        {
          amount: { currency: "EUR", value: "10.00" },
          id: "starter-monthly",
          interval: "month",
          productId: "starter",
        },
      ],
      products: [{ id: "starter", name: "Starter" }],
    }),
    selfEnrollmentEnabled: { enabled: true, planChange: true },
    sql: {
      async query() {
        return { rows: [] };
      },
    },
    testMode: true,
  });

  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(
    capabilities.operations["self.subscription.change"]?.reason,
    "provider_connection_missing"
  );
  assert.equal(capabilities.diagnostics?.recoveryCoordinatorEnabled, true);
});
