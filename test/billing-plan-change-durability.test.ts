import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  BILLING_PLAN_CHANGE_STATE_TRANSITIONS,
  BillingPlanChangeTransitionError,
  assertBillingPlanChangeTransition,
  isBillingPlanChangeState,
} from "../src/billing/workflows/plan-change/plan-change-state.ts";
import { createBillingPlanChangeRepository } from "../src/billing/workflows/plan-change/plan-change-repository.ts";
import { createBillingProviderEffectRepository } from "../src/billing/workflows/plan-change/provider-effect-repository.ts";
import {
  EMBEDDED_BILLING_MIGRATIONS,
  EMBEDDED_BILLING_REQUIRED_TABLES,
} from "../src/migrations/embedded-billing/catalog.ts";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

function operationRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    connection_id: CONNECTION_ID,
    enrollment_id: null,
    expected_row_version: 1,
    fencing_epoch: 0,
    id: OPERATION_ID,
    idempotency_key: "change-1",
    last_error: null,
    lease_expires_at: null,
    lease_token: null,
    owned_subscription_id: "33333333-3333-4333-8333-333333333333",
    price_id: "pro-monthly",
    replacement_provider_subscription_id: null,
    state: "requested",
    subject_id: "user-1",
    subject_kind: "user",
    ...overrides,
  };
}

function effectRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    attempts: 0,
    connection_id: CONNECTION_ID,
    effect_type: "subscription.update",
    error: null,
    fencing_epoch: 0,
    id: "44444444-4444-4444-8444-444444444444",
    idempotency_key: "provider-change-1",
    lease_expires_at: null,
    lease_token: null,
    observed_evidence: null,
    observed_result: null,
    operation_id: OPERATION_ID,
    provider: "mollie",
    provider_resource_id: null,
    request_fingerprint: "fingerprint-1",
    state: "pending",
    ...overrides,
  };
}

test("plan-change state transitions reject invalid edges fail closed", () => {
  assert.equal(isBillingPlanChangeState("provider_update_pending"), true);
  assert.equal(isBillingPlanChangeState("not-a-plan-change-state"), false);

  for (const [from, destinations] of Object.entries(
    BILLING_PLAN_CHANGE_STATE_TRANSITIONS
  )) {
    for (const to of destinations) {
      assert.doesNotThrow(() => assertBillingPlanChangeTransition(from, to));
    }
  }

  assert.throws(
    () =>
      assertBillingPlanChangeTransition("completed", "provider_update_pending"),
    (error: unknown) =>
      error instanceof BillingPlanChangeTransitionError &&
      error.code === "ATHENA_BILLING_PLAN_CHANGE_INVALID_TRANSITION"
  );
});

test("plan-change repository creates idempotently and claims with fencing", async () => {
  const statements: Array<{ params: readonly unknown[]; sql: string }> = [];
  let insertCount = 0;
  const sql = {
    async query(text: string, params: readonly unknown[] = []) {
      statements.push({ params, sql: text });
      if (text.includes("INSERT INTO billing.billing_plan_change_operations")) {
        insertCount += 1;
        return {
          rows: insertCount === 1 ? [operationRow()] : [],
        };
      }
      if (text.includes("FROM billing.billing_plan_change_operations")) {
        return { rows: [operationRow()] };
      }
      if (text.includes("UPDATE billing.billing_plan_change_operations")) {
        return {
          rows: [
            operationRow({
              fencing_epoch: 1,
              lease_expires_at: "2099-01-01T00:00:00.000Z",
              lease_token: "claim-1",
              state: "claimed",
            }),
          ],
        };
      }
      return { rows: [] };
    },
  };
  const repository = createBillingPlanChangeRepository(sql);
  const input = {
    connectionId: CONNECTION_ID,
    expectedRowVersion: 1,
    idempotencyKey: "change-1",
    ownedSubscriptionId: "33333333-3333-4333-8333-333333333333",
    priceId: "pro-monthly",
    subjectId: "user-1",
    subjectKind: "user" as const,
  };

  const first = await repository.create(input);
  const second = await repository.create(input);
  assert.equal(first.id, second.id);

  const claimed = await repository.claim({
    expectedFencingEpoch: first.fencingEpoch,
    id: first.id,
    leaseToken: "claim-1",
  });
  assert.equal(claimed?.state, "claimed");
  assert.match(
    statements.find((entry) => entry.sql.includes("UPDATE billing"))?.sql ?? "",
    /fencing_epoch = \$3|fencing_epoch = \$4/
  );
  assert.equal(
    statements.some(
      (entry) =>
        entry.sql.includes("lease_expires_at < now()") &&
        entry.sql.includes("fencing_epoch")
    ),
    true
  );
});

test("plan-change owned subscription loading selects its connection affinity", async () => {
  const statements: string[] = [];
  const sql = {
    async query(text: string) {
      statements.push(text);
      if (text.includes("FROM billing.billing_subscriptions")) {
        return {
          rows: [
            {
              connection_id: CONNECTION_ID,
              id: "33333333-3333-4333-8333-333333333333",
              row_version: 4,
              updated_at: "2026-09-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const repository = createBillingPlanChangeRepository(sql);

  const result = await repository.loadOwnedSubscriptionVersion({
    subjectId: "user-1",
    subjectKind: "user",
    subscriptionId: "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(result?.connectionId, CONNECTION_ID);
  assert.match(
    statements[0] ?? "",
    /SELECT id, connection_id::text AS connection_id, row_version, updated_at/
  );
});

test("plan-change repository refuses a stale claimant before mutation", async () => {
  const statements: string[] = [];
  const sql = {
    async query(text: string) {
      statements.push(text);
      if (text.includes("UPDATE billing.billing_plan_change_operations")) {
        return { rows: [] };
      }
      return { rows: [operationRow({ state: "claimed" })] };
    },
  };
  const repository = createBillingPlanChangeRepository(sql);

  const result = await repository.transition({
    expectedFencingEpoch: 7,
    expectedState: "claimed",
    id: OPERATION_ID,
    leaseToken: "stale-claim",
    state: "provider_update_pending",
  });

  assert.equal(result, undefined);
  assert.match(statements[0] ?? "", /lease_token = \$6/);
  assert.match(statements[0] ?? "", /fencing_epoch = \$7/);
});

test("provider-effect journal creation is idempotent by operation and effect", async () => {
  let insertCount = 0;
  const sql = {
    async query(text: string) {
      if (text.includes("INSERT INTO billing.billing_provider_effects")) {
        insertCount += 1;
        return {
          rows: insertCount === 1 ? [effectRow()] : [],
        };
      }
      if (text.includes("FROM billing.billing_provider_effects")) {
        return { rows: [effectRow()] };
      }
      return { rows: [] };
    },
  };
  const repository = createBillingProviderEffectRepository(sql);
  const input = {
    connectionId: CONNECTION_ID,
    effectType: "subscription.update",
    idempotencyKey: "provider-change-1",
    operationId: OPERATION_ID,
    provider: "mollie",
    requestFingerprint: "fingerprint-1",
  };

  const first = await repository.create(input);
  const second = await repository.create(input);
  assert.equal(first.id, second.id);
  assert.equal(first.state, "pending");
});

test("provider-effect journal completion is fenced and records evidence", async () => {
  const statements: Array<{ params: readonly unknown[]; sql: string }> = [];
  const sql = {
    async query(text: string, params: readonly unknown[] = []) {
      statements.push({ params, sql: text });
      return { rows: [effectRow({ state: "applied" })] };
    },
  };
  const repository = createBillingProviderEffectRepository(sql);

  const result = await repository.complete({
    effectId: "44444444-4444-4444-8444-444444444444",
    expectedFencingEpoch: 1,
    leaseToken: "claim-1",
    observedEvidence: { status: "active" },
    observedResult: { providerSubscriptionId: "sub-1" },
    providerResourceId: "sub-1",
  });

  assert.equal(result?.state, "applied");
  assert.match(statements[0]?.sql ?? "", /lease_token = \$2/);
  assert.match(statements[0]?.sql ?? "", /fencing_epoch = \$3/);
  assert.deepEqual(statements[0]?.params.slice(-3), [
    "sub-1",
    '{"providerSubscriptionId":"sub-1"}',
    '{"status":"active"}',
  ]);
});

test("Embedded Billing migration catalogs the provider-effect journal", () => {
  const journal = EMBEDDED_BILLING_MIGRATIONS.find(
    (migration) => migration.version === 29
  );
  assert.ok(journal);
  assert.equal(journal.filename, "0029_billing_provider_effect_journal.sql");
  assert.equal(
    EMBEDDED_BILLING_REQUIRED_TABLES.includes("billing_provider_effects"),
    true
  );
  assert.match(
    journal.sql,
    /CREATE TABLE IF NOT EXISTS billing\.billing_provider_effects/
  );
  assert.match(journal.sql, /request_fingerprint/);
  assert.match(journal.sql, /observed_result/);
  assert.match(journal.sql, /lease_token/);
});

test("Embedded Billing migration keeps every nonterminal plan-change state serialized", () => {
  const migration = EMBEDDED_BILLING_MIGRATIONS.find(
    (candidate) => candidate.version === 33
  );
  assert.ok(migration);
  assert.equal(
    migration.filename,
    "0033_billing_plan_change_live_states.sql"
  );
  assert.match(
    migration.sql,
    /DROP INDEX IF EXISTS billing\.billing_plan_change_operations_live_subject_uidx/
  );
  assert.match(
    migration.sql,
    /WHERE state NOT IN\s*\(\s*'completed',\s*'attention_required',\s*'failed'\s*\)/s
  );
});

test("plan-change workflow keeps persistence in the repository", () => {
  const workflow = readFileSync(
    new URL(
      "../src/billing/workflows/plan-change/plan-change-repository.ts",
      import.meta.url
    ),
    "utf8"
  );
  const coordinator = readFileSync(
    new URL("../src/billing/runtime/self/change.ts", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /billing_plan_change_operations/);
  assert.doesNotMatch(
    coordinator,
    /billing_(?:plan_change_operations|provider_effects|subscriptions)/
  );
});
