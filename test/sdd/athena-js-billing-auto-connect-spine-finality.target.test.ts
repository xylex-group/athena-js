import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  configuredBillingConnectionIntents,
  retryConfiguredBillingConnectionMaterialize,
  singleFlightConfiguredBillingConnectionMaterialize,
} from "../../src/billing/runtime/local/connections/materialize.ts";
import { createBillingAdminPort } from "../../src/billing/runtime/admin/execute.ts";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { createBillingProviderRegistry } from "../../src/billing/runtime/local/providers/create-registry.ts";
import {
  configuredBillingCredentialReferences,
  mollieConfigForCredentialReference,
} from "../../src/billing/runtime/local/providers/connection-binding.ts";
import { createConnectionProviderExecutionContext } from "../../src/billing/runtime/local/providers/connection-binding.ts";
import { normalizeBillingProviderConfiguration } from "../../src/billing/runtime/local/providers/configuration/index.ts";
import { createLocalBillingRuntime } from "../../src/billing/runtime/local/runtime.ts";
import { createLocalBillingRuntimeBinding } from "../../src/billing/runtime/local/materialize.ts";
import { PROCESS_OWNED_BILLING_PRINCIPAL } from "../../src/billing/runtime/rights.ts";
import { createAthenaRuntimeReadiness } from "../../src/runtime/readiness/index.ts";
import { configuredProvidersForBillingConnection } from "../../src/billing/subject/connection-affinity.ts";
import { runEmbeddedBillingRuntimeRecoveryOnce } from "../../src/billing/runtime/local/process-ownership.ts";

const mollieConfig = {
  testKey: "test_mollie",
  sdk: class {},
};

const stripeConfig = {
  testKey: "test_stripe",
};

test("failed bootstrap can be retried in a later convergence generation", async () => {
  let attempts = 0;
  const key = `billing-retry-${Date.now()}-${Math.random()}`;

  await assert.rejects(
    singleFlightConfiguredBillingConnectionMaterialize(key, async () => {
      attempts += 1;
      throw new Error("bootstrap failed");
    }),
    /bootstrap failed/
  );

  const recovered = await retryConfiguredBillingConnectionMaterialize(
    key,
    async () => {
      attempts += 1;
      return { connections: [] };
    }
  );

  assert.deepEqual(recovered, { connections: [] });
  assert.equal(attempts, 2);
});

test("retry waits for an in-flight startup generation before starting recovery", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  const key = `billing-overlap-${Date.now()}-${Math.random()}`;
  const startup = singleFlightConfiguredBillingConnectionMaterialize(
    key,
    async () => {
      attempts += 1;
      await gate;
      throw new Error("startup failed");
    },
  );
  const recovery = retryConfiguredBillingConnectionMaterialize(key, async () => {
    attempts += 1;
    return { connections: [] };
  });

  release();
  await assert.rejects(startup, /startup failed/);
  assert.deepEqual(await recovery, { connections: [] });
  assert.equal(attempts, 2);
});

test("recovery coalesces across runtime bindings sharing an owner key", async () => {
  let attempts = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = async () => {
    attempts += 1;
    await gate;
    return { recovered: true };
  };

  const first = runEmbeddedBillingRuntimeRecoveryOnce("app\0db", run);
  const second = runEmbeddedBillingRuntimeRecoveryOnce("app\0db", run);
  release();

  assert.deepEqual(await Promise.all([first, second]), [
    { recovered: true },
    { recovered: true },
  ]);
  assert.equal(attempts, 1);
});

test("provider and account slots remain separate namespaces", () => {
  const intents = configuredBillingConnectionIntents({
    applicationId: "app",
    configuredProviders: {
      mollie: mollieConfig,
      mollieAccounts: {
        eu: mollieConfig,
      },
      stripe: stripeConfig,
    },
    testMode: true,
  });

  test("canonical and legacy declarations cannot silently merge a provider slot", () => {
    assert.throws(
      () =>
        configuredBillingConnectionIntents({
          applicationId: "app",
          configuredProviders: {
            mollie: {
              accounts: { eu: mollieConfig },
              default: mollieConfig,
            },
            mollieAccounts: { eu: mollieConfig },
          } as never,
          testMode: true,
        }),
      (error: unknown) =>
        error != null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ATHENA_BILLING_PROVIDER_SLOT_CONFLICT"
    );
  });

  test("trimmed canonical account key duplicates fail closed", () => {
    assert.throws(
      () =>
        normalizeBillingProviderConfiguration({
          configuredProviders: {
            mollie: {
              accounts: {
                " eu": mollieConfig,
                eu: mollieConfig,
              },
            },
          } as never,
          environment: "test",
        }),
      (error: unknown) =>
        error != null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ATHENA_BILLING_PROVIDER_SLOT_CONFLICT",
    );
  });

  test("accounts-only canonical wrappers do not synthesize a default slot", () => {
    const configured = normalizeBillingProviderConfiguration({
      configuredProviders: {
        mollie: { accounts: { eu: mollieConfig } },
      } as never,
      environment: "test",
    });

    test("canonical default credential kind reaches the required next-gen ingestion guard", () => {
      assert.doesNotThrow(() =>
        createLocalBillingRuntimeBinding({
          appUrl: "https://app.example",
          applicationId: "app",
          configuredProviders: {
            mollie: {
              default: {
                accessToken: "access_test",
                credentialKind: "advanced_access_token",
                sdk: mollieConfig.sdk,
              },
            },
          },
          ingestion: {
            webhooks: {
              enabled: true,
              management: "automatic",
              publicBaseUrl: "https://hooks.example",
              providers: {
                mollie: {
                  nextGen: { enabled: "required" },
                },
              },
            },
          },
          mode: "local",
        }),
      );
    });
    const provider = configured.providers.get("mollie");

    assert.ok(provider);
    assert.equal(provider.defaultSlot, undefined);
    assert.equal(provider.slots.get("eu")?.credentialReference, "providers.mollie:eu");
  });

  test("canonical named slots are consumed by credential readers", () => {
    const configured = {
      mollie: { accounts: { eu: mollieConfig } },
    } as never;

    assert.deepEqual(
      configuredBillingCredentialReferences({
        configuredProviders: configured,
        environment: "test",
        provider: "mollie",
      }),
      ["providers.mollie:eu"]
    );
    assert.equal(
      mollieConfigForCredentialReference(configured, "providers.mollie:eu"),
      mollieConfig
    );
  });

  test("canonical named slots are projected for affinity-selected execution", () => {
    const config = {
      mollie: {
        accounts: { eu: mollieConfig },
        default: mollieConfig,
      },
    } as never;
    const projected = configuredProvidersForBillingConnection({
      affinity: {
        connectionId: "connection-eu",
        credentialReference: "providers.mollie:eu",
        environment: "test",
        provider: "mollie",
        source: "eligible_connection",
      },
      configuredProviders: config,
      operation: "self.payments.list",
    });

    assert.equal(projected.mollie, mollieConfig);
  });

  test("named-slot-only providers register execution runtimes", () => {
    const registry = createBillingProviderRegistry({
      stripeAccounts: { platform: { testKey: "test_stripe" } },
    });

    assert.equal(registry.has("stripe"), true);
  });

  test("heterogeneous named Mollie slots route execution to the selected runtime", async () => {
    const observed: Record<string, unknown>[] = [];
    const sdk = (id: string) =>
      class {
        customers = {
          ...resource(),
          create: async () => ({ id: `customer_${id}`, resource: "customer" }),
        };
        invoices = resource();
        paymentLinks = resource();
        payments = resource();
        refunds = resource();
        salesInvoices = resource();
        subscriptions = resource();
        webhooks = resource();

        constructor(options: Record<string, unknown>) {
          observed.push({ id, options });
        }
      };
    function resource(): Record<string, () => Promise<unknown>> {
      return {
        cancel: async () => ({}),
        create: async () => ({}),
        delete: async () => ({}),
        get: async () => ({}),
        list: async () => ({}),
        update: async () => ({}),
      };
    }
    const configured = {
      mollieAccounts: {
        api: { sdk: sdk("api"), testKey: "test_api" },
        access: {
          accessToken: "access_test",
          credentialKind: "advanced_access_token" as const,
          sdk: sdk("access"),
        },
      },
    } as never;
    const registry = createBillingProviderRegistry(configured);
    const runtime = registry.require("mollie");
    const context = createConnectionProviderExecutionContext({
      configuredProviders: configured,
      connection: {
        credentialReference: "providers.mollie:access",
        environment: "test",
        id: "connection-access",
        provider: "mollie",
        testMode: true,
      } as never,
    });

    const result = await runtime.customers?.create(context, {
      idempotencyKey: "customer-access",
    });

    assert.equal(result?.providerCustomerId, "customer_access");
    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.id, "access");
    assert.equal(
      (observed[0]?.options as { security?: { advancedAccessToken?: string } })
        .security?.advancedAccessToken,
      "access_test",
    );
  });

  test("explicit persisted binding to a missing slot fails closed", async () => {
    const registry = createBillingProviderRegistry({
      mollie: mollieConfig,
    });
    const runtime = registry.require("mollie");

    assert.throws(
      () =>
        runtime.getCapabilities({
          kind: "connection",
          credentialReference: "providers.mollie:missing",
        } as never),
      /No provider runtime is registered/,
    );
  });

  assert.deepEqual(
    intents.map((intent) => `${intent.provider}:${intent.identity.scopeKey ?? "default"}`),
    ["mollie:default", "mollie:eu", "stripe:default"]
  );
});

test("billing runtime does not own embedded schema DDL", () => {
  const source = readFileSync(
    new URL(
      "../../src/billing/runtime/local/connections/materialize.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  assert.doesNotMatch(source, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
});

test("bootstrap retry uses the complete convergence pipeline", () => {
  const source = readFileSync(
    new URL("../../src/billing/runtime/local/materialize.ts", import.meta.url),
    "utf8"
  );
  const retryStart = source.indexOf("connectionState.bootstrapRetry");
  const pipelineStart = source.indexOf("const runBootstrapGeneration");
  const pipelineEnd = source.indexOf(
    "void runExclusiveEmbeddedBillingRuntime(",
    pipelineStart
  );
  assert.ok(retryStart >= 0);
  assert.ok(pipelineStart > retryStart);
  assert.ok(pipelineEnd > pipelineStart);
  const retrySource = source.slice(retryStart, pipelineStart);
  const pipelineSource = source.slice(pipelineStart, pipelineEnd);

  assert.match(retrySource, /runBootstrapGeneration/);
  assert.match(pipelineSource, /registerEmbeddedBillingScheduler/);
  assert.match(pipelineSource, /runAutomaticBillingWebhookReconcileIfEnabled/);
});

test("connection persistence SQL uses parameters instead of interpolated values", () => {
  const source = readFileSync(
    new URL(
      "../../src/billing/runtime/local/connections/materialize.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /\$\{applicationId\}|\$\{credentialReference\}/);
  assert.match(source, /\$1/);
});

test("bootstrap retry is a control-plane operation independent of operational readiness", async () => {
  let retries = 0;
  const admin = createBillingAdminPort({
    authority: PROCESS_BILLING_INVOCATION,
    options: {
      applicationId: "app",
      bootstrapRetry: async () => {
        retries += 1;
        return {
          connections: [],
          generation: 2,
          phase: "ready",
          recoveredAt: new Date().toISOString(),
        };
      },
      registry: createBillingProviderRegistry(),
    },
    principal: PROCESS_OWNED_BILLING_PRINCIPAL,
  });

  test("local runtime exposes bootstrap retry after operational readiness fails", async () => {
    const operationalFailure = Promise.reject(new Error("bootstrap failed"));
    operationalFailure.catch(() => undefined);
    const runtime = createLocalBillingRuntime({
      connectionState: {
        bootstrapRetry: async () => ({
          connections: [],
          generation: 2,
          phase: "ready",
          recoveredAt: new Date().toISOString(),
        }),
        connections: [],
        initializationFailed: true,
        initialized: false,
      },
      invocation: PROCESS_BILLING_INVOCATION,
      ready: operationalFailure,
      registry: createBillingProviderRegistry(),
      waitForOperational: () => operationalFailure,
    });

    const result = await runtime.admin.bootstrap.retry();

    assert.equal(result.generation, 2);
  });

  test("failed capabilities keep bootstrap retry advertised when recovery is available", async () => {
    const operationalFailure = Promise.reject(new Error("bootstrap failed"));
    operationalFailure.catch(() => undefined);
    const runtime = createLocalBillingRuntime({
      connectionState: {
        bootstrapRetry: async () => ({
          connections: [],
          generation: 2,
          phase: "ready",
          recoveredAt: new Date().toISOString(),
        }),
        connections: [],
        initializationFailed: true,
        initialized: false,
      },
      invocation: PROCESS_BILLING_INVOCATION,
      ready: operationalFailure,
      registry: createBillingProviderRegistry(),
      sql: {
        async query() {
          return { rows: [] };
        },
      },
      waitForOperational: () => operationalFailure,
    });

    const capabilities = await runtime.getCapabilities({ provider: "mollie" });

    assert.equal(capabilities.operations["admin.bootstrap.retry"]?.available, true);
    assert.equal(
      capabilities.operations["admin.bootstrap.retry"]?.effectiveAvailable,
      true,
    );
  });

  test("Billing runtime readiness can reset and recover after a failed generation", async () => {
    const readiness = createAthenaRuntimeReadiness();
    const initialFailure = new Error("bootstrap failed");
    readiness.fail("billing", initialFailure);
    await assert.rejects(readiness.waitFor("billing"), /bootstrap failed/);

    readiness.reset("billing");
    readiness.ready("billing");

    await readiness.waitFor("billing");
  });

  const result = await admin.bootstrap.retry();

  assert.equal(result.phase, "ready");
  assert.equal(retries, 1);
});

test("materialization rejects an unregistered provider instead of falling back", async () => {
  const admin = createBillingAdminPort({
    authority: PROCESS_BILLING_INVOCATION,
    options: {
      applicationId: "app",
      registry: createBillingProviderRegistry(),
      sql: {
        async query() {
          return { rows: [] };
        },
      },
    },
    principal: PROCESS_OWNED_BILLING_PRINCIPAL,
  });

  await assert.rejects(
    admin.connections.materialize({ provider: "stripe" }),
    (error: unknown) =>
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "provider_materialization_unsupported"
  );
});
