import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import {
  createPostgresBillingPlanChangeRepository,
} from "../../src/billing/workflows/plan-change/plan-change-repository.ts";
import {
  runPlanChangeCoordinator,
  type PlanChangeCoordinatorContext,
} from "../../src/billing/workflows/plan-change/plan-change-coordinator.ts";
import { createPostgresBillingProviderEffectRepository } from "../../src/billing/workflows/plan-change/provider-effect-repository.ts";
import { recoverExpiredPlanChanges } from "../../src/billing/workflows/plan-change/plan-change-recovery.ts";
import { createPostgresPool } from "../../src/postgres/driver.ts";

function disposableBillingFinalityUrl(): string | undefined {
  const connectionString =
    process.env.ATHENA_BILLING_FINALITY_DATABASE_URL?.trim();
  return connectionString && /^postgres(ql)?:\/\//i.test(connectionString)
    ? connectionString
    : undefined;
}

function billingSqlFromPool(
  pool: Awaited<ReturnType<typeof createPostgresPool>>,
): BillingSqlExecutor {
  return {
    async query(text, params = []) {
      const result = await pool.query(text, [...params]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

test("P?: PostgreSQL plan-change claims fence concurrent and stale claimants", async (t) => {
  const connectionString = disposableBillingFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database",
    );
    return;
  }

  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const sql = billingSqlFromPool(pool);
  try {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.query(`
      CREATE SCHEMA billing;
      CREATE TABLE billing.billing_provider_connections (
        id uuid PRIMARY KEY
      );
      CREATE TABLE billing.billing_plan_change_operations (
        id uuid PRIMARY KEY,
        connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
        subject_kind text NOT NULL,
        subject_id text NOT NULL,
        owned_subscription_id uuid NOT NULL,
        enrollment_id uuid,
        idempotency_key text NOT NULL,
        expected_row_version integer NOT NULL,
        fencing_epoch integer NOT NULL DEFAULT 0,
        state text NOT NULL,
        price_id text NOT NULL,
        replacement_provider_subscription_id text,
        lease_token text,
        lease_expires_at timestamptz,
        last_error text,
        retry_count integer NOT NULL DEFAULT 0,
        next_retry_at timestamptz,
        last_outcome text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (subject_kind, subject_id, idempotency_key)
      );
      CREATE UNIQUE INDEX billing_plan_change_operations_live_subject_uidx
        ON billing.billing_plan_change_operations (subject_kind, subject_id)
      WHERE state NOT IN ('completed', 'attention_required', 'failed');
    `);
    await pool.query(
      "INSERT INTO billing.billing_provider_connections (id) VALUES ($1::uuid)",
      ["22222222-2222-4222-8222-222222222222"],
    );

    const first = createPostgresBillingPlanChangeRepository(sql);
    const second = createPostgresBillingPlanChangeRepository(sql);
    const operationInput = {
      connectionId: "22222222-2222-4222-8222-222222222222",
      expectedRowVersion: 1,
      ownedSubscriptionId: "33333333-3333-4333-8333-333333333333",
      priceId: "pro-monthly",
      subjectId: "user-1",
      subjectKind: "user",
    } as const;
    const created = await Promise.allSettled([
      first.create({ ...operationInput, idempotencyKey: "concurrent-change-a" }),
      second.create({ ...operationInput, idempotencyKey: "concurrent-change-b" }),
    ]);
    const winners = created.filter(
      (result): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof first.create>>
      > => result.status === "fulfilled"
    );
    assert.equal(winners.length, 1);
    const operation = winners[0]?.value;
    assert.ok(operation);
    const rejected = created.find((result) => result.status === "rejected");
    assert.equal(
      (rejected as PromiseRejectedResult | undefined)?.reason?.code,
      "23505"
    );

    const [claimA, claimB] = await Promise.all([
      first.claim({
        expectedFencingEpoch: operation.fencingEpoch,
        expectedState: "requested",
        id: operation.id,
        leaseToken: "claim-a",
      }),
      second.claim({
        expectedFencingEpoch: operation.fencingEpoch,
        expectedState: "requested",
        id: operation.id,
        leaseToken: "claim-b",
      }),
    ]);
    assert.equal(Number(Boolean(claimA)) + Number(Boolean(claimB)), 1);

    const winner = claimA ?? claimB;
    assert.ok(winner);
    await pool.query(
      "UPDATE billing.billing_plan_change_operations SET lease_expires_at = now() - interval '1 second' WHERE id = $1::uuid",
      [operation.id],
    );
    const reclaimed = await second.claim({
      expectedFencingEpoch: winner.fencingEpoch,
      id: operation.id,
      leaseToken: "claim-reclaimed",
    });
    assert.equal(reclaimed?.fencingEpoch, winner.fencingEpoch + 1);

    const staleTransition = await first.transition({
      expectedFencingEpoch: winner.fencingEpoch,
      expectedState: "claimed",
      id: operation.id,
      leaseToken: winner.leaseToken ?? "claim-a",
      state: "provider_update_pending",
    });
    assert.equal(staleTransition, undefined);

    const currentTransition = await second.transition({
      expectedFencingEpoch: reclaimed?.fencingEpoch ?? -1,
      expectedState: "claimed",
      id: operation.id,
      leaseToken: "claim-reclaimed",
      state: "provider_update_pending",
    });
    assert.equal(currentTransition?.state, "provider_update_pending");
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.end();
  }
});

test("P?: PostgreSQL coordinator recovers a timed-out provider update without replaying it", async (t) => {
  const connectionString = disposableBillingFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database",
    );
    return;
  }

  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const sql = billingSqlFromPool(pool);
  try {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.query(`
      CREATE SCHEMA billing;
      CREATE TABLE billing.billing_provider_connections (
        id uuid PRIMARY KEY
      );
      CREATE TABLE billing.billing_plan_change_operations (
        id uuid PRIMARY KEY,
        connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
        subject_kind text NOT NULL,
        subject_id text NOT NULL,
        owned_subscription_id uuid NOT NULL,
        enrollment_id uuid,
        idempotency_key text NOT NULL,
        expected_row_version integer NOT NULL,
        fencing_epoch integer NOT NULL DEFAULT 0,
        state text NOT NULL,
        price_id text NOT NULL,
        replacement_provider_subscription_id text,
        lease_token text,
        lease_expires_at timestamptz,
        last_error text,
        retry_count integer NOT NULL DEFAULT 0,
        next_retry_at timestamptz,
        last_outcome text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (subject_kind, subject_id, idempotency_key)
      );
      CREATE TABLE billing.billing_provider_effects (
        id uuid PRIMARY KEY,
        operation_id uuid NOT NULL,
        effect_type text NOT NULL,
        provider text NOT NULL,
        connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
        idempotency_key text NOT NULL,
        state text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        provider_resource_id text,
        request_fingerprint text NOT NULL,
        observed_result jsonb,
        observed_evidence jsonb,
        lease_token text,
        lease_expires_at timestamptz,
        fencing_epoch integer NOT NULL DEFAULT 0,
        last_error text,
        claimed_at timestamptz,
        completed_at timestamptz,
        unknown_at timestamptz,
        failed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (operation_id, effect_type)
      );
    `);
    await pool.query(
      "INSERT INTO billing.billing_provider_connections (id) VALUES ($1::uuid)",
      ["22222222-2222-4222-8222-222222222222"],
    );
    await pool.query(
      `INSERT INTO billing.billing_plan_change_operations (
         id, connection_id, subject_kind, subject_id, owned_subscription_id,
         idempotency_key, expected_row_version, state, price_id
       ) VALUES ($1::uuid, $2::uuid, 'user', 'user-1', $3::uuid, $4, 1, 'requested', 'pro-monthly')`,
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "change-1",
      ],
    );

    let providerCalls = 0;
    let providerApplied = false;
    const context: PlanChangeCoordinatorContext = {
      actions: {
        "subscription.update": {
          classifyError: () => "uncertain",
          effectType: "subscription.update",
          idempotencyKey: "provider-change-1",
          invoke: async () => {
            providerCalls += 1;
            providerApplied = true;
            throw new Error("timeout");
          },
          observe: async () => ({
            classification: providerApplied ? "applied" : "unknown",
            evidence: { providerApplied },
            providerResourceId: "sub-live",
            result: { providerApplied },
          }),
          request: { subscriptionId: "sub-live", priceId: "pro-monthly" },
        },
      },
      commit: async () => ({
        kind: "completed",
        result: { id: "owned-subscription" },
      }),
      connectionId: "22222222-2222-4222-8222-222222222222",
      provider: "mollie",
    };
    const planChanges = createPostgresBillingPlanChangeRepository(sql);
    const effects = createPostgresBillingProviderEffectRepository(sql);
    const run = () =>
      runPlanChangeCoordinator({
        context,
        operationId: "11111111-1111-4111-8111-111111111111",
        repositories: { effects, planChanges },
      });
    const first = await run();
    assert.equal(first.kind, "retry_required");
    assert.equal(providerCalls, 1);

    await pool.query(
      "UPDATE billing.billing_plan_change_operations SET next_retry_at = now() - interval '1 second' WHERE id = $1::uuid",
      ["11111111-1111-4111-8111-111111111111"],
    );
    const recovered = await recoverExpiredPlanChanges({
      coordinator: async () => {
        const result = await run();
        return { kind: result.kind };
      },
      repository: planChanges,
    });
    assert.equal(recovered.completed, 1);
    assert.equal(providerCalls, 1);

    const finalOperation = await pool.query<{
      state: string;
    }>(
      "SELECT state FROM billing.billing_plan_change_operations WHERE id = $1::uuid",
      ["11111111-1111-4111-8111-111111111111"],
    );
    const finalEffect = await pool.query<{
      state: string;
    }>(
      `SELECT state
       FROM billing.billing_provider_effects
       WHERE operation_id = $1::uuid AND effect_type = 'subscription.update'`,
      ["11111111-1111-4111-8111-111111111111"],
    );
    assert.equal(finalOperation.rows[0]?.state, "completed");
    assert.equal(finalEffect.rows[0]?.state, "applied");
    assert.equal((await recoverExpiredPlanChanges({
      coordinator: async () => ({ kind: "completed" }),
      repository: planChanges,
    })).scanned, 0);
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.end();
  }
});
