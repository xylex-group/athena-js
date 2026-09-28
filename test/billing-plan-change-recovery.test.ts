import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  classifyPlanChangeProviderState,
  type PlanChangeProviderSubscriptionState,
} from "../src/billing/workflows/plan-change/plan-change-reconciliation.ts";
import {
  runPlanChangeCoordinator,
  type PlanChangeCoordinatorContext,
} from "../src/billing/workflows/plan-change/plan-change-coordinator.ts";
import type {
  BillingPlanChangeOperationRecord,
} from "../src/billing/workflows/plan-change/plan-change-repository.ts";
import type {
  BillingProviderEffectRecord,
} from "../src/billing/workflows/plan-change/provider-effect-repository.ts";
import {
  recoverExpiredPlanChanges,
  type PlanChangeRecoveryDependencies,
} from "../src/billing/workflows/plan-change/plan-change-recovery.ts";
import { createPlanChangeRecoveryRuntime } from "../src/billing/workflows/plan-change/plan-change-recovery-runtime.ts";
import { BillingProviderRegistry } from "../src/billing/runtime/local/providers/registry.ts";
import { registerEmbeddedBillingScheduler } from "../src/billing/reconciliation/scheduler.ts";

const BASE_STATE: PlanChangeProviderSubscriptionState = {
  amount: { currency: "EUR", value: "20.00" },
  interval: "month",
  providerSubscriptionId: "sub_live",
  status: "active",
};

const OPERATION_RECORD: BillingPlanChangeOperationRecord = {
  connectionId: "connection-1",
  createdAt: null,
  enrollmentId: null,
  expectedRowVersion: 1,
  fencingEpoch: 0,
  id: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "change-1",
  lastError: null,
  lastOutcome: null,
  leaseExpiresAt: null,
  leaseToken: null,
  nextRetryAt: null,
  ownedSubscriptionId: "owned-subscription",
  priceId: "pro-monthly",
  replacementProviderSubscriptionId: null,
  retryCount: 0,
  state: "requested",
  subjectId: "user-1",
  subjectKind: "user",
  updatedAt: null,
};

const EFFECT_RECORD: BillingProviderEffectRecord = {
  attempts: 0,
  claimedAt: null,
  completedAt: null,
  connectionId: "connection-1",
  createdAt: null,
  effectType: "subscription.update",
  failedAt: null,
  fencingEpoch: 0,
  id: "effect",
  idempotencyKey: "provider-change-1",
  lastError: null,
  leaseExpiresAt: null,
  leaseToken: null,
  observedEvidence: null,
  observedResult: null,
  operationId: "11111111-1111-4111-8111-111111111111",
  provider: "mollie",
  providerResourceId: null,
  requestFingerprint: "fingerprint",
  state: "pending",
  unknownAt: null,
  updatedAt: null,
};

test("provider reconciliation classifies applied, not-applied, conflicting, and unknown", () => {
  const intended = {
    amount: { currency: "EUR", value: "20.00" },
    interval: "month",
    providerSubscriptionId: "sub_live",
    status: "active" as const,
  };
  const previous = {
    amount: { currency: "EUR", value: "10.00" },
    interval: "month",
    providerSubscriptionId: "sub_live",
    status: "active" as const,
  };

  assert.equal(
    classifyPlanChangeProviderState({ actual: BASE_STATE, intended, previous }),
    "applied",
  );
  assert.equal(
    classifyPlanChangeProviderState({
      actual: previous,
      intended,
      previous,
    }),
    "not_applied",
  );
  assert.equal(
    classifyPlanChangeProviderState({
      actual: {
        ...BASE_STATE,
        amount: { currency: "EUR", value: "30.00" },
      },
      intended,
      previous,
    }),
    "conflicting",
  );
  assert.equal(
    classifyPlanChangeProviderState({
      actual: undefined,
      intended,
      previous,
    }),
    "unknown",
  );
});

test("coordinator accepts a durable operation ID and stops only at a terminal state", async () => {
  let calls = 0;
  const context: PlanChangeCoordinatorContext = {
    actions: {
      "subscription.update": {
        effectType: "subscription.update",
        idempotencyKey: "provider-change-1",
        request: { subscriptionId: "sub_live" },
        invoke: async () => {
          calls += 1;
          return {
            evidence: { status: "active" },
            providerResourceId: "sub_live",
            result: { status: "active" },
          };
        },
        observe: async () => ({
          classification: "applied",
          evidence: { status: "active" },
          providerResourceId: "sub_live",
        }),
      },
    },
    commit: async () => ({
      kind: "completed" as const,
      result: { id: "owned-subscription" },
    }),
    connectionId: "connection-1",
    provider: "mollie",
  };
  const result = await runPlanChangeCoordinator({
    context,
    operationId: "11111111-1111-4111-8111-111111111111",
    repositories: {
      effects: {
        complete: async () => ({ ...EFFECT_RECORD, state: "applied" }),
        create: async () => ({ ...EFFECT_RECORD }),
        list: async () => [],
        fail: async () => undefined,
        markApplied: async () => undefined,
        markAttentionRequired: async () => undefined,
        markUnknown: async () => undefined,
        retry: async () => undefined,
        claim: async () => ({
          ...EFFECT_RECORD,
          attempts: 1,
          fencingEpoch: 1,
          leaseToken: "effect-lease",
          state: "claimed",
        }),
      },
      planChanges: {
        claim: async () => ({
          ...OPERATION_RECORD,
          fencingEpoch: 1,
          leaseToken: "operation-lease",
          state: "claimed",
        }),
        complete: async () => ({
          ...OPERATION_RECORD,
          fencingEpoch: 5,
          leaseToken: null,
          state: "completed",
        }),
        load: async () => ({ ...OPERATION_RECORD }),
        fail: async () => undefined,
        attentionRequired: async () => undefined,
        scheduleRetry: async () => undefined,
        transition: async (input) => ({
          ...OPERATION_RECORD,
          fencingEpoch: input.expectedFencingEpoch + 1,
          leaseToken: "operation-lease",
          replacementProviderSubscriptionId: null,
          state: input.state,
        }),
      },
    },
  });

  assert.equal(result.kind, "completed");
  assert.equal(calls, 1);
});

test("recovery entrypoint discovers and resumes expired operations", async () => {
  let resumed = 0;
  const dependencies: PlanChangeRecoveryDependencies = {
    coordinator: async () => {
      resumed += 1;
      return { kind: "completed" };
    },
    repository: {
      claim: async () => ({
        ...OPERATION_RECORD,
        fencingEpoch: 2,
        leaseToken: "recovery-lease",
        state: "claimed",
      }),
      findExpired: async () => [
        {
          expectedFencingEpoch: 1,
          id: "11111111-1111-4111-8111-111111111111",
          retryCount: 0,
        },
      ],
    },
  };

  const result = await recoverExpiredPlanChanges(dependencies);
  assert.equal(result.completed, 1);
  assert.equal(resumed, 1);
});

test("recovery result reports the authoritative recoverable backlog", async () => {
  const result = await recoverExpiredPlanChanges({
    coordinator: async () => ({ kind: "completed" }),
    countRecoverable: async () => 12,
    repository: {
      claim: async () => null,
      findExpired: async () => [],
    },
  } as PlanChangeRecoveryDependencies & {
    countRecoverable: () => Promise<number>;
  });
  assert.equal(result.recoverableOperationBacklog, 12);
});

test("plan-change recovery does not inherit webhook execution mode", () => {
  const materialize = readFileSync(
    join(fileURLToPath(new URL("../src/billing/runtime/local/materialize.ts", import.meta.url))),
    "utf8"
  );
  const recoveryStart = materialize.indexOf("const recoveryScheduler");
  const runtimeReady = materialize.indexOf(
    "BILLING_BOOTSTRAP_EVENT.runtimeReady",
    recoveryStart
  );
  assert.ok(recoveryStart >= 0);
  assert.ok(runtimeReady > recoveryStart);
  assert.doesNotMatch(
    materialize.slice(recoveryStart, runtimeReady),
    /execution: ingestion\.webhooks\.execution/
  );
});

test("recovery runtime scans a bounded batch from durable operations", async () => {
  const queries: Array<{ params: readonly unknown[]; text: string }> = [];
  const runtime = createPlanChangeRecoveryRuntime({
    batchSize: 7,
    registry: new BillingProviderRegistry(),
    sql: {
      async query(text, params = []) {
        queries.push({ params, text });
        return { rows: [] };
      },
    },
  });

  const result = await runtime.run();
  assert.equal(result.scanned, 0);
  const findExpiredQuery = queries.find(({ text }) =>
    text.includes("FROM billing.billing_plan_change_operations")
  );
  assert.ok(findExpiredQuery);
  assert.deepEqual(findExpiredQuery.params, [7]);
});

test("recovery scheduler coalesces runs and drains before shutdown", async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let runs = 0;
  const scheduler = registerEmbeddedBillingScheduler({
    enabled: true,
    execution: "embedded",
    run: async () => {
      runs += 1;
      await blocked;
    },
    schedule: { intervalMs: 60_000, jitterMs: 60_000 },
  });
  assert.ok(scheduler);

  const first = scheduler.runNow("scheduled");
  const second = scheduler.runNow("scheduled");
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);

  scheduler.cancel();
  release();
  await scheduler.drain();
});
