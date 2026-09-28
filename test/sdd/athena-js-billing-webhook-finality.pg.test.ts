import { strict as assert } from "node:assert";
import { test } from "node:test";

import { normalizeAthenaBillingWebhooks } from "../../src/billing/ingestion/config.ts";
import { reconcileBillingWebhookRegistrations } from "../../src/billing/ingestion/reconciliation/coordinator.ts";
import { createPostgresBillingWebhookRegistrationStore } from "../../src/billing/ingestion/reconciliation/repository.ts";
import { createMemoryBillingWebhookSecretStore } from "../../src/billing/ingestion/secrets/memory.ts";
import type { BillingWebhookRegistrationStore } from "../../src/billing/ingestion/reconciliation/repository.ts";
import type {
  BillingProviderExecutionContext,
  BillingProviderWebhook,
  BillingWebhooksPort,
} from "../../src/billing/runtime/local/providers/types.ts";
import type { BillingReconciliationContext } from "../../src/billing/observability/types.ts";
import { createPostgresPool } from "../../src/postgres/driver.ts";

function disposableBillingFinalityUrl(): string | undefined {
  const value = process.env.ATHENA_BILLING_FINALITY_DATABASE_URL?.trim();
  return value && /^postgres(ql)?:\/\//i.test(value) ? value : undefined;
}

function schema(): string {
  return `
    CREATE SCHEMA billing;
    CREATE TABLE billing.billing_provider_connections (
      id uuid PRIMARY KEY
    );
    CREATE TABLE billing.billing_webhook_registrations (
      id uuid PRIMARY KEY,
      connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
      provider text NOT NULL,
      provider_webhook_id text,
      kind text NOT NULL,
      environment text NOT NULL,
      name text NOT NULL,
      url text NOT NULL,
      event_types jsonb NOT NULL,
      status text NOT NULL,
      config_hash text NOT NULL,
      secret_version integer,
      secret_fingerprint text,
      last_reconciled_at timestamptz,
      last_verified_at timestamptz,
      last_delivery_at timestamptz,
      last_error jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      provider_registration_idempotency_key text,
      provider_registration_attempts integer NOT NULL DEFAULT 0,
      secret_persistence_attempts integer NOT NULL DEFAULT 0,
      activation_attempts integer NOT NULL DEFAULT 0,
      last_provider_evidence jsonb,
      lifecycle_error jsonb,
      lifecycle_updated_at timestamptz,
      reconciliation_state text,
      last_accepted_at timestamptz,
      last_rejected_at timestamptz,
      last_rejection_code text,
      last_reconciliation_outcome text,
      last_ingress_stage text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (connection_id, kind)
    );
  `;
}

const connectionId = "00000000-0000-0000-0000-000000000001";
const execution = {} as BillingProviderExecutionContext;
const context: BillingReconciliationContext = {
  connectionId,
  correlationId: "pg-correlation",
  provider: "mollie",
  traceId: "pg-trace",
  trigger: "manual",
};
const webhooks = normalizeAthenaBillingWebhooks({
  enabled: true,
  publicBaseUrl: "https://hooks.example",
  providers: { mollie: { nextGen: { enabled: "required" } } },
});

test("P?: PostgreSQL webhook registration recovery preserves one provider registration", async (t) => {
  const connectionString = disposableBillingFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database"
    );
    return;
  }
  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  try {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.query(schema());
    await pool.query(
      "INSERT INTO billing.billing_provider_connections (id) VALUES ($1::uuid)",
      [connectionId]
    );
    const sql = {
      async query(text: string, values: readonly unknown[] = []) {
        const result = await pool.query(text, [...values]);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const postgresStore = createPostgresBillingWebhookRegistrationStore(sql);
    let crashAfterProviderCreate = false;
    let crashInjected = false;
    const registrations: BillingWebhookRegistrationStore = {
      ...postgresStore,
      async upsert(record) {
        if (crashAfterProviderCreate && !crashInjected) {
          crashInjected = true;
          throw new Error("injected PostgreSQL checkpoint crash");
        }
        await postgresStore.upsert(record);
      },
    };
    const secretStore = createMemoryBillingWebhookSecretStore();
    const remote: BillingProviderWebhook[] = [];
    let createCalls = 0;
    let updateCalls = 0;
    const port: BillingWebhooksPort = {
      kind: "webhooks",
      async create(_execution, input) {
        createCalls += 1;
        const created: BillingProviderWebhook = {
          environment: "test",
          eventTypes: [...input.eventTypes],
          id: "wh_pg_1",
          name: input.name,
          provider: "mollie",
          signingSecret: "secret-pg",
          status: "active",
          url: input.url,
        };
        remote.push(created);
        crashAfterProviderCreate = true;
        return created;
      },
      async list() {
        return { items: [...remote] };
      },
      async update(_execution, input) {
        updateCalls += 1;
        const current = remote[0];
        assert.ok(current);
        const updated = {
          ...current,
          eventTypes: [...(input.eventTypes ?? current.eventTypes)],
          url: input.url ?? current.url,
        };
        remote[0] = updated;
        return updated;
      },
    };
    const reconcile = {
      applicationId: "pg-app",
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

    await assert.rejects(() =>
      reconcileBillingWebhookRegistrations({
        context,
        execution,
        port,
        reconcile,
        registrations,
        secretStore,
      })
    );
    await reconcileBillingWebhookRegistrations({
      context,
      execution,
      port,
      reconcile: { ...reconcile, hasDecryptableLocalSecret: false },
      registrations,
      secretStore,
    });
    const row = await postgresStore.get({ connectionId, kind: "next_gen" });
    assert.equal(createCalls, 1);
    assert.equal(updateCalls, 1);
    assert.equal(row?.providerWebhookId, "wh_pg_1");
    assert.equal(row?.reconciliationState, "active");
    assert.equal(row?.status, "active");
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.end();
  }
});
