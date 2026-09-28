/**
 * Proves the forward repair from the physical Billing generation that added
 * plan-change fencing to the generation that supplies its timestamp column.
 * Skips unless a disposable PostgreSQL URL is configured.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { AthenaCliUI } from "../../src/cli/ui/index.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { changeSelfSubscription } from "../../src/billing/runtime/self/change.ts";
import { BillingProviderRegistry } from "../../src/billing/runtime/local/providers/registry.ts";
import type {
  BillingProviderRuntime,
  BillingProviderUpdateSubscriptionInput,
} from "../../src/billing/runtime/local/providers/types.ts";
import type {
  BillingPrice,
  BillingSubscription,
} from "../../src/billing/types.ts";
import {
  EMBEDDED_BILLING_LEDGER,
  EMBEDDED_BILLING_MIGRATIONS,
} from "../../src/migrations/embedded-billing/catalog.ts";
import { applyEmbeddedSqlMigrations } from "../../src/migrations/embedded-sql-apply.ts";
import { createPostgresPool } from "../../src/postgres/driver.ts";
import { createPostgresPoolManager } from "../../src/postgres/pool/manager.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const silentUi = { info() {} } as unknown as AthenaCliUI;

const PLAN_CHANGE_PRICE: BillingPrice = {
  amount: { currency: "EUR", value: "20.00" },
  id: "pro-monthly",
  interval: "month",
  metadata: {},
  productId: "pro",
  raw: {},
};

function postgresPlanChangeProvider(
  calls: BillingProviderUpdateSubscriptionInput[]
): BillingProviderRuntime {
  const ports = {
    checkout: false,
    customers: true,
    invoices: false,
    paymentLinks: false,
    payments: true,
    prices: true,
    products: true,
    refunds: false,
    subscriptions: true,
    webhooks: false,
  };
  const subscription = (
    input: BillingProviderUpdateSubscriptionInput
  ): BillingSubscription => ({
    amount: input.amount ?? PLAN_CHANGE_PRICE.amount,
    description: input.description ?? "Pro",
    interval: input.interval ?? "month",
    metadata: input.metadata ?? {},
    provider: "mollie",
    providerCustomerId: input.customerId,
    providerSubscriptionId: input.subscriptionId,
    raw: {},
    status: "active",
  });
  return {
    async getCapabilities() {
      return {
        operations: {
          "customers.create": true,
          "prices.list": true,
          "subscriptions.get": true,
          "subscriptions.list": true,
          "subscriptions.update": true,
        },
        ports,
      };
    },
    prices: {
      kind: "prices",
      async list() {
        return { items: [PLAN_CHANGE_PRICE], nextCursor: null };
      },
    },
    provider: "mollie",
    subscriptions: {
      async cancel() {
        throw new Error("unused");
      },
      async create() {
        throw new Error("unused");
      },
      async get(_context, input) {
        return {
          amount: PLAN_CHANGE_PRICE.amount,
          metadata: {},
          provider: "mollie",
          providerCustomerId: input.customerId,
          providerSubscriptionId: input.subscriptionId,
          raw: {},
          status: "active",
        };
      },
      kind: "subscriptions",
      async list() {
        return { items: [], nextCursor: null };
      },
      async update(_context, input) {
        calls.push(input);
        return subscription(input);
      },
    },
  };
}

function disposableBillingFinalityUrl(): string | undefined {
  const value = process.env.ATHENA_BILLING_FINALITY_DATABASE_URL?.trim();
  return value && /^postgres(ql)?:\/\//i.test(value) ? value : undefined;
}

test("P?: physical Billing generation 28 upgrades with subscription timestamps intact", async (t) => {
  const connectionString = disposableBillingFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database"
    );
    return;
  }

  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const manager = createPostgresPoolManager({ ownership: "borrowed", pool });
  try {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.query("DROP TABLE IF EXISTS athena_billing_migrations");

    const throughGeneration28 = EMBEDDED_BILLING_MIGRATIONS.filter(
      (migration) => migration.version <= 28
    );
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      manager,
      migrations: throughGeneration28,
      ui: silentUi,
    });

    const generation28Columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'billing'
         AND table_name = 'billing_subscriptions'
         AND column_name IN ('row_version', 'updated_at')`
    );
    assert.deepEqual(
      generation28Columns.rows.map((row) => row.column_name).sort(),
      ["row_version"]
    );

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO billing.billing_subscriptions (
         provider,
         provider_subscription_id,
         provider_customer_id,
         status,
         created_at,
         ingested_at
       )
       VALUES ('mollie', 'sub_generation_28', 'cus_generation_28', 'active', $1, $1)
       RETURNING id`,
      ["2026-01-01T00:00:00.000Z"]
    );
    const subscriptionId = inserted.rows[0]?.id;
    assert.ok(subscriptionId);

    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      manager,
      migrations: EMBEDDED_BILLING_MIGRATIONS.filter(
        (migration) => migration.version > 28
      ),
      ui: silentUi,
    });

    const repaired = await pool.query<{
      created_at: string;
      id: string;
      ingested_at: string;
      row_version: number;
      updated_at: string;
    }>(
      `SELECT id, row_version, updated_at, created_at, ingested_at
       FROM billing.billing_subscriptions
       WHERE id = $1`,
      [subscriptionId]
    );
    const updatedAtDefinition = await pool.query<{
      column_default: string | null;
      is_nullable: string;
    }>(
      `SELECT is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'billing'
         AND table_name = 'billing_subscriptions'
         AND column_name = 'updated_at'`
    );
    assert.equal(updatedAtDefinition.rows[0]?.is_nullable, "NO");
    assert.match(updatedAtDefinition.rows[0]?.column_default ?? "", /now\(\)/i);
    const beforeUpdate = repaired.rows[0];
    assert.ok(beforeUpdate);
    assert.equal(beforeUpdate.id, subscriptionId);
    assert.equal(beforeUpdate.row_version, 1);
    assert.equal(
      new Date(beforeUpdate.updated_at).toISOString(),
      new Date(beforeUpdate.ingested_at).toISOString()
    );

    const updated = await pool.query<{
      row_version: number;
      updated_at: string;
    }>(
      `UPDATE billing.billing_subscriptions
       SET status = 'active',
           row_version = row_version + 1,
           updated_at = now()
       WHERE id = $1
         AND row_version = $2
       RETURNING row_version, updated_at`,
      [subscriptionId, beforeUpdate.row_version]
    );
    assert.equal(updated.rowCount, 1);
    assert.equal(updated.rows[0]?.row_version, 2);
    assert.ok(
      new Date(updated.rows[0]?.updated_at ?? 0).getTime() >=
        new Date(beforeUpdate.updated_at).getTime()
    );

    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      manager,
      migrations: EMBEDDED_BILLING_MIGRATIONS,
      ui: silentUi,
    });
    const idempotent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM athena_billing_migrations
       WHERE version IN (32, 33)
       GROUP BY version
       ORDER BY version`
    );
    assert.deepEqual(
      idempotent.rows.map((row) => row.count),
      ["1", "1"]
    );
    const index = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'billing'
         AND indexname = 'billing_plan_change_operations_live_subject_uidx'`
    );
    assert.equal(index.rows.length, 1);
    assert.match(index.rows[0]?.indexdef ?? "", /state/);
    assert.match(index.rows[0]?.indexdef ?? "", /completed/);
  } finally {
    await manager.close();
    await pool.end();
  }
});

test("P?: PostgreSQL changeSelfSubscription uses the owned row connection", async (t) => {
  const connectionString = disposableBillingFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database"
    );
    return;
  }

  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const manager = createPostgresPoolManager({ ownership: "borrowed", pool });
  const connectionId = "11111111-1111-4111-8111-111111111111";
  const enrollmentId = "22222222-2222-4222-8222-222222222222";
  const subscriptionId = "33333333-3333-4333-8333-333333333333";
  const userId = "billing-finality-user";
  try {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.query("DROP TABLE IF EXISTS athena_billing_migrations");
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      manager,
      migrations: EMBEDDED_BILLING_MIGRATIONS,
      ui: silentUi,
    });
    await pool.query(
      `INSERT INTO billing.billing_provider_connections (
         id,
         owner_kind,
         owner_id,
         provider,
         mode,
         environment,
         status,
         credential_kind,
         provider_account_id,
         account_reference,
         credential_reference,
         scopes,
         config,
         metadata
       )
       VALUES (
         $1::uuid,
         'tenant',
         'billing-finality',
         'mollie',
         'test',
         'test',
         'active',
         'api_key',
         NULL,
         'billing-finality-mollie-test',
         'providers.mollie',
         '[]'::jsonb,
         '{}'::jsonb,
         '{}'::jsonb
       )`,
      [connectionId]
    );
    await pool.query(
      `INSERT INTO billing.billing_subscriptions (
         id,
         provider,
         provider_subscription_id,
         provider_customer_id,
         status,
         amount_currency,
         amount_value,
         interval,
         description,
         metadata,
         connection_id,
         subject_kind,
         subject_id,
         ownership_status,
         created_at,
         ingested_at
       )
       VALUES (
         $1::uuid,
         'mollie',
         'sub_generation_28',
         'cus_generation_28',
         'active',
         'EUR',
         10.00,
         'month',
         'Starter',
         '{"priceId":"starter-monthly"}'::jsonb,
         $2::uuid,
         'user',
         $3,
         'resolved',
         '2026-01-01T00:00:00.000Z',
         '2026-01-01T00:00:00.000Z'
       )`,
      [subscriptionId, connectionId, userId]
    );
    await pool.query(
      `INSERT INTO billing.billing_subscription_enrollments (
         id,
         connection_id,
         subject_kind,
         subject_id,
         price_id,
         idempotency_key,
         state,
         provider_subscription_id,
         provider_idempotency_key
       )
       VALUES (
         $1::uuid,
         $2::uuid,
         'user',
         $3,
         'starter-monthly',
         'seed-enrollment',
         'active',
         'sub_generation_28',
         'seed-enrollment'
       )`,
      [enrollmentId, connectionId, userId]
    );

    let crashAfterSubscriptionUpdate = true;
    let transactionCalls = 0;
    const sql = {
      async query(text: string, params: readonly unknown[] = []) {
        const result = await pool.query(text, [...params]);
        return { rows: result.rows as Record<string, unknown>[] };
      },
      async transaction<T>(
        fn: (transaction: BillingSqlExecutor) => Promise<T>
      ): Promise<T> {
        transactionCalls += 1;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({
            async query(text, params = []) {
              const response = await client.query(text, [...params]);
              if (
                crashAfterSubscriptionUpdate &&
                text.includes("UPDATE billing.billing_subscriptions")
              ) {
                crashAfterSubscriptionUpdate = false;
                throw new Error(
                  "injected crash after local subscription update"
                );
              }
              return {
                rows: response.rows as Record<string, unknown>[],
              };
            },
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the original transaction failure.
          }
          throw error;
        } finally {
          client.release();
        }
      },
    };
    const providerCalls: BillingProviderUpdateSubscriptionInput[] = [];
    const configuredProviders = {
      mollie: {
        sdk: FetchMollieSdk,
        testKey: "test_pg_plan_change",
      },
    };
    const principal: AthenaPrincipal = {
      authenticated: true,
      grants: [],
      rights: [],
      userId,
    };
    const firstAttempt = await changeSelfSubscription({
      configuredProviders,
      idempotencyKey: "pg-plan-change",
      planChangeEnabled: { planChange: true },
      priceId: PLAN_CHANGE_PRICE.id,
      principal,
      registry: new BillingProviderRegistry([
        postgresPlanChangeProvider(providerCalls),
      ]),
      sql,
      subscriptionId,
      testMode: true,
    });
    assert.equal("operationId" in firstAttempt, true);
    if (!("operationId" in firstAttempt)) {
      throw new Error("Expected the injected local commit crash to be durable.");
    }
    assert.equal(firstAttempt.status, "processing");
    assert.equal(providerCalls.length, 1);
    const firstPersisted = await pool.query<{
      row_version: number;
    }>(
      `SELECT row_version
       FROM billing.billing_subscriptions
       WHERE id = $1::uuid`,
      [subscriptionId]
    );
    assert.equal(firstPersisted.rows[0]?.row_version, 1);
    await pool.query(
      `UPDATE billing.billing_plan_change_operations
       SET next_retry_at = now() - interval '1 second'
       WHERE id = $1::uuid`,
      [firstAttempt.operationId]
    );

    const changed = await changeSelfSubscription({
      configuredProviders,
      idempotencyKey: "pg-plan-change",
      planChangeEnabled: { planChange: true },
      priceId: PLAN_CHANGE_PRICE.id,
      principal,
      registry: new BillingProviderRegistry([
        postgresPlanChangeProvider(providerCalls),
      ]),
      sql,
      subscriptionId,
      testMode: true,
    });
    if ("operationId" in changed) {
      throw new Error("Expected PostgreSQL plan change recovery to complete.");
    }
    assert.equal(changed.providerSubscriptionId, "sub_generation_28");
    assert.equal(providerCalls.length, 1);
    assert.equal(transactionCalls, 2);

    const persisted = await pool.query<{
      connection_id: string;
      row_version: number;
      updated_at: string;
    }>(
      `SELECT connection_id::text, row_version, updated_at
       FROM billing.billing_subscriptions
       WHERE id = $1::uuid`,
      [subscriptionId]
    );
    assert.equal(persisted.rows[0]?.connection_id, connectionId);
    assert.equal(persisted.rows[0]?.row_version, 2);
    assert.ok(persisted.rows[0]?.updated_at);
  } finally {
    await manager.close();
    await pool.end();
  }
});
