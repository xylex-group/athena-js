import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryBillingWebhookSecretStore } from "../src/billing/ingestion/secrets/memory.ts";
import { normalizeAthenaBillingWebhooks } from "../src/billing/ingestion/config.ts";
import { createMemoryBillingWebhookRegistrationStore } from "../src/billing/ingestion/reconciliation/repository.ts";
import { reconcileBillingWebhookRegistrations } from "../src/billing/ingestion/reconciliation/coordinator.ts";
import type { BillingWebhookRegistrationStore } from "../src/billing/ingestion/reconciliation/repository.ts";
import type {
  BillingProviderExecutionContext,
  BillingWebhooksPort,
} from "../src/billing/runtime/local/providers/types.ts";
import type { BillingProviderWebhook } from "../src/billing/runtime/local/providers/types.ts";
import type { BillingReconciliationContext } from "../src/billing/observability/types.ts";

const connectionId = "00000000-0000-0000-0000-000000000001";
const execution = {} as BillingProviderExecutionContext;
const context: BillingReconciliationContext = {
  connectionId,
  correlationId: "correlation-1",
  provider: "mollie",
  traceId: "trace-1",
  trigger: "manual",
};
const webhooks = normalizeAthenaBillingWebhooks({
  enabled: true,
  publicBaseUrl: "https://hooks.example",
  providers: {
    mollie: { nextGen: { enabled: "required" } },
  },
});
const reconcile = {
  applicationId: "app-1",
  capability: { classic: true, nextGen: { available: true } },
  connectionId,
  endpoints: {
    classic: "https://hooks.example/classic",
    classicUrl: "https://hooks.example/classic",
    eventsUrl: "https://hooks.example/events",
    nextGen: "https://hooks.example/events",
  },
  environment: "test" as const,
  management: "automatic" as const,
  provider: "mollie",
  webhooks,
};

function providerPort(input: {
  createCalls: { idempotencyKey: string }[];
  remote: BillingProviderWebhook[];
  updateCalls: number;
}): BillingWebhooksPort {
  return {
    kind: "webhooks",
    async create(_context, request) {
      input.createCalls.push({ idempotencyKey: request.idempotencyKey });
      const created: BillingProviderWebhook = {
        environment: "test",
        eventTypes: [...request.eventTypes],
        id: "wh_1",
        name: request.name,
        provider: "mollie",
        signingSecret: "secret-1",
        status: "active",
        url: request.url,
      };
      input.remote.push(created);
      return created;
    },
    async list() {
      return { items: [...input.remote] };
    },
    async update(_context, request) {
      input.updateCalls += 1;
      const current = input.remote[0];
      assert.ok(current);
      const updated = {
        ...current,
        eventTypes: [...(request.eventTypes ?? current.eventTypes)],
        name: request.name ?? current.name,
        signingSecret: "secret-1",
        url: request.url ?? current.url,
      };
      input.remote[0] = updated;
      return updated;
    },
  };
}

function failingRegistrationStore(failOnUpsert: number): {
  rows: ReturnType<typeof createMemoryBillingWebhookRegistrationStore>["rows"];
  store: BillingWebhookRegistrationStore;
} {
  const memory = createMemoryBillingWebhookRegistrationStore();
  let upserts = 0;
  return {
    rows: memory.rows,
    store: {
      ...memory.store,
      async upsert(record) {
        upserts += 1;
        if (upserts === failOnUpsert) {
          throw new Error("injected persistence crash");
        }
        await memory.store.upsert(record);
      },
    },
  };
}

async function runReconcile(input: {
  hasDecryptableLocalSecret?: boolean;
  port: BillingWebhooksPort;
  registrations: BillingWebhookRegistrationStore;
  secretStore: ReturnType<typeof createMemoryBillingWebhookSecretStore>;
  webhooks?: typeof webhooks;
}) {
  return reconcileBillingWebhookRegistrations({
    context,
    execution,
    port: input.port,
    reconcile: {
      ...reconcile,
      ...(input.webhooks ? { webhooks: input.webhooks } : {}),
      ...(input.hasDecryptableLocalSecret === undefined
        ? {}
        : { hasDecryptableLocalSecret: input.hasDecryptableLocalSecret }),
    },
    registrations: input.registrations,
    secretStore: input.secretStore,
  });
}

test("reconciliation reuses the durable registration idempotency key after a create crash", async () => {
  const registrations = failingRegistrationStore(2);
  const secretStore = createMemoryBillingWebhookSecretStore();
  const state = {
    createCalls: [] as { idempotencyKey: string }[],
    remote: [] as BillingProviderWebhook[],
    updateCalls: 0,
  };
  const port = providerPort(state);

  await assert.rejects(() =>
    runReconcile({ port, registrations: registrations.store, secretStore })
  );
  assert.equal(state.createCalls.length, 1);

  await runReconcile({
    hasDecryptableLocalSecret: false,
    port,
    registrations: registrations.store,
    secretStore,
  });
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.updateCalls, 1);
  assert.equal(registrations.rows[0]?.status, "active");
  assert.equal((await secretStore.resolve(connectionId)).current, "secret-1");
  await runReconcile({
    hasDecryptableLocalSecret: true,
    port,
    registrations: registrations.store,
    secretStore,
  });
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.updateCalls, 1);
});

test("reconciliation activates a secret persisted before an activation crash without another provider mutation", async () => {
  const registrations = failingRegistrationStore(3);
  const secretStore = createMemoryBillingWebhookSecretStore();
  const state = {
    createCalls: [] as { idempotencyKey: string }[],
    remote: [] as BillingProviderWebhook[],
    updateCalls: 0,
  };
  const port = providerPort(state);

  await assert.rejects(() =>
    runReconcile({ port, registrations: registrations.store, secretStore })
  );
  assert.equal((await secretStore.resolve(connectionId)).current, "secret-1");
  assert.equal(
    registrations.rows[0]?.reconciliationState,
    "provider_registered_secret_pending"
  );

  await runReconcile({
    hasDecryptableLocalSecret: true,
    port,
    registrations: registrations.store,
    secretStore,
  });
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.updateCalls, 0);
  assert.equal(registrations.rows[0]?.status, "active");
  assert.equal(registrations.rows[0]?.reconciliationState, "active");
});

test("reconciliation retries a provider create that failed before dispatch", async () => {
  const registrations = createMemoryBillingWebhookRegistrationStore();
  const secretStore = createMemoryBillingWebhookSecretStore();
  const state = {
    createCalls: [] as { idempotencyKey: string }[],
    remote: [] as BillingProviderWebhook[],
    updateCalls: 0,
  };
  const basePort = providerPort(state);
  let failCreate = true;
  const port: BillingWebhooksPort = {
    ...basePort,
    async create(context, request) {
      if (failCreate) {
        failCreate = false;
        state.createCalls.push({ idempotencyKey: request.idempotencyKey });
        throw new Error("injected provider failure before dispatch");
      }
      return basePort.create(context, request);
    },
  };

  await assert.rejects(() =>
    runReconcile({ port, registrations: registrations.store, secretStore })
  );
  await runReconcile({ port, registrations: registrations.store, secretStore });
  assert.equal(state.createCalls.length, 2);
  assert.equal(
    state.createCalls[0]?.idempotencyKey,
    state.createCalls[1]?.idempotencyKey
  );
  assert.equal(state.remote.length, 1);
  assert.equal(registrations.rows[0]?.status, "active");
});

test("reconciliation resumes when secret persistence fails before the provider state is active", async () => {
  const registrations = createMemoryBillingWebhookRegistrationStore();
  const secretStore = createMemoryBillingWebhookSecretStore();
  const originalStoreCurrent = secretStore.storeCurrent.bind(secretStore);
  let failSecretPersistence = true;
  secretStore.storeCurrent = async (input) => {
    if (failSecretPersistence) {
      failSecretPersistence = false;
      throw new Error("injected secret persistence crash");
    }
    await originalStoreCurrent(input);
  };
  const state = {
    createCalls: [] as { idempotencyKey: string }[],
    remote: [] as BillingProviderWebhook[],
    updateCalls: 0,
  };
  const port = providerPort(state);

  await assert.rejects(() =>
    runReconcile({ port, registrations: registrations.store, secretStore })
  );
  await runReconcile({
    hasDecryptableLocalSecret: false,
    port,
    registrations: registrations.store,
    secretStore,
  });
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.updateCalls, 1);
  assert.equal(registrations.rows[0]?.status, "active");
});

test("reconciliation resumes after activation persistence fails", async () => {
  const registrations = failingRegistrationStore(5);
  const secretStore = createMemoryBillingWebhookSecretStore();
  const state = {
    createCalls: [] as { idempotencyKey: string }[],
    remote: [] as BillingProviderWebhook[],
    updateCalls: 0,
  };
  const port = providerPort(state);

  await assert.rejects(() =>
    runReconcile({ port, registrations: registrations.store, secretStore })
  );
  assert.equal(
    registrations.rows[0]?.reconciliationState,
    "verification_pending"
  );
  await runReconcile({
    hasDecryptableLocalSecret: true,
    port,
    registrations: registrations.store,
    secretStore,
  });
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.updateCalls, 0);
  assert.equal(registrations.rows[0]?.status, "active");
});

test("reconciliation resumes a rotation after provider update before local activation", async () => {
  const memory = createMemoryBillingWebhookRegistrationStore();
  const secretStore = createMemoryBillingWebhookSecretStore();
  let failRotationCheckpoint = true;
  const registrations: BillingWebhookRegistrationStore = {
    ...memory.store,
    async upsert(record) {
      if (
        failRotationCheckpoint &&
        record.reconciliationState === "rotation_secret_pending"
      ) {
        failRotationCheckpoint = false;
        throw new Error("injected rotation checkpoint crash");
      }
      await memory.store.upsert(record);
    },
  };
  const state = {
    createCalls: [] as { idempotencyKey: string }[],
    remote: [] as BillingProviderWebhook[],
    updateCalls: 0,
  };
  const port = providerPort(state);
  await runReconcile({
    port,
    registrations,
    secretStore,
  });
  const rotatedWebhooks = normalizeAthenaBillingWebhooks({
    enabled: true,
    publicBaseUrl: "https://hooks.example",
    providers: {
      mollie: {
        nextGen: {
          enabled: "required",
          eventTypes: ["payment.failed"],
        },
      },
    },
  });

  await assert.rejects(() =>
    runReconcile({
      hasDecryptableLocalSecret: true,
      port,
      registrations,
      secretStore,
      webhooks: rotatedWebhooks,
    })
  );
  assert.equal(state.updateCalls, 1);
  await runReconcile({
    hasDecryptableLocalSecret: true,
    port,
    registrations,
    secretStore,
    webhooks: rotatedWebhooks,
  });
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.updateCalls, 1);
  assert.equal(memory.rows[0]?.status, "active");
  assert.equal(memory.rows[0]?.reconciliationState, "active");
});
