import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  type PlanChangeCoordinatorRepositories,
  type PlanChangeProviderAction,
  runPlanChangeCoordinator,
} from "../src/billing/workflows/plan-change/plan-change-coordinator.ts";
import {
  recoverExpiredPlanChanges,
  type PlanChangeRecoveryDependencies,
} from "../src/billing/workflows/plan-change/plan-change-recovery.ts";
import type {
  BillingPlanChangeOperationRecord,
  BillingPlanChangeRepository,
} from "../src/billing/workflows/plan-change/plan-change-repository.ts";
import type {
  BillingProviderEffectRecord,
  BillingProviderEffectRepository,
} from "../src/billing/workflows/plan-change/provider-effect-repository.ts";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

type CrashPoint =
  | "direct_commit"
  | "effect_claim"
  | "replacement_create"
  | "update";

function operationRecord(): BillingPlanChangeOperationRecord {
  return {
    connectionId: CONNECTION_ID,
    createdAt: null,
    enrollmentId: null,
    expectedRowVersion: 1,
    fencingEpoch: 0,
    id: OPERATION_ID,
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
}

function effectRecord(
  operationId: string,
  effectType: BillingProviderEffectRecord["effectType"],
  id: string,
): BillingProviderEffectRecord {
  return {
    attempts: 0,
    claimedAt: null,
    completedAt: null,
    connectionId: CONNECTION_ID,
    createdAt: null,
    effectType,
    failedAt: null,
    fencingEpoch: 0,
    id,
    idempotencyKey: `${effectType}-key`,
    lastError: null,
    leaseExpiresAt: null,
    leaseToken: null,
    observedEvidence: null,
    observedResult: null,
    operationId,
    provider: "mollie",
    providerResourceId: null,
    requestFingerprint: `${effectType}-fingerprint`,
    state: "pending",
    unknownAt: null,
    updatedAt: null,
  };
}

function createHarness(crashPoint?: CrashPoint) {
  const operation = operationRecord();
  const effects: BillingProviderEffectRecord[] = [];
  const oldSubscription = {
    amount: { currency: "EUR", value: "10.00" },
    interval: "month",
    providerSubscriptionId: "sub-old",
    status: "active",
  };
  const targetSubscription = {
    amount: { currency: "EUR", value: "20.00" },
    interval: "month",
    providerSubscriptionId: "sub-old",
    status: "active",
  };
  let providerOld = { ...oldSubscription };
  let providerReplacement:
    | typeof targetSubscription & { providerSubscriptionId: "sub-new" }
    | undefined;
  let localCommitted = false;
  let injected = false;
  let updateCalls = 0;
  let replacementCreateCalls = 0;

  const cloneOperation = () => ({ ...operation });
  const cloneEffect = (effect: BillingProviderEffectRecord) => ({
    ...effect,
  });
  const planChanges = {
    attentionRequired: async (input: {
      error: string;
      expectedFencingEpoch: number;
      expectedState: BillingPlanChangeOperationRecord["state"];
      id: string;
      leaseToken: string;
    }) => {
      if (
        input.id !== operation.id ||
        operation.state !== input.expectedState ||
        operation.leaseToken !== input.leaseToken ||
        operation.fencingEpoch !== input.expectedFencingEpoch
      ) {
        return undefined;
      }
      operation.state = "attention_required";
      operation.lastError = input.error;
      operation.fencingEpoch += 1;
      return cloneOperation();
    },
    claim: async (input: {
      expectedFencingEpoch: number;
      expectedState?: BillingPlanChangeOperationRecord["state"];
      id: string;
      leaseToken: string;
    }) => {
      if (
        input.id !== operation.id ||
        input.expectedFencingEpoch !== operation.fencingEpoch ||
        (input.expectedState != null &&
          input.expectedState !== operation.state) ||
        (operation.leaseToken != null &&
          operation.leaseExpiresAt !== "expired")
      ) {
        return undefined;
      }
      operation.state =
        operation.state === "requested" ? "claimed" : operation.state;
      operation.leaseToken = input.leaseToken;
      operation.leaseExpiresAt = "active";
      operation.fencingEpoch += 1;
      return cloneOperation();
    },
    complete: async (input: {
      expectedFencingEpoch: number;
      expectedState: BillingPlanChangeOperationRecord["state"];
      id: string;
      leaseToken: string;
    }) => {
      if (
        input.id !== operation.id ||
        operation.state !== input.expectedState ||
        operation.leaseToken !== input.leaseToken ||
        operation.fencingEpoch !== input.expectedFencingEpoch
      ) {
        return undefined;
      }
      operation.state = "completed";
      operation.leaseToken = null;
      operation.leaseExpiresAt = null;
      operation.fencingEpoch += 1;
      return cloneOperation();
    },
    fail: async (input: {
      error: string;
      expectedFencingEpoch: number;
      expectedState: BillingPlanChangeOperationRecord["state"];
      id: string;
      leaseToken: string;
    }) => {
      if (
        input.id !== operation.id ||
        operation.state !== input.expectedState ||
        operation.leaseToken !== input.leaseToken ||
        operation.fencingEpoch !== input.expectedFencingEpoch
      ) {
        return undefined;
      }
      operation.state = "failed";
      operation.lastError = input.error;
      operation.leaseToken = null;
      operation.leaseExpiresAt = null;
      operation.fencingEpoch += 1;
      return cloneOperation();
    },
    findExpired: async () =>
      operation.state !== "completed" &&
      operation.state !== "attention_required" &&
      operation.state !== "failed" &&
      operation.leaseToken == null &&
      (operation.nextRetryAt == null ||
        new Date(operation.nextRetryAt).getTime() <= Date.now())
        ? [
            {
              expectedFencingEpoch: operation.fencingEpoch,
              id: operation.id,
              retryCount: operation.retryCount ?? 0,
            },
          ]
        : [],
    load: async () => cloneOperation(),
    scheduleRetry: async (input: {
      expectedFencingEpoch: number;
      id: string;
      lastError?: string | null;
      leaseToken: string;
      nextRetryAt: string;
      retryCount: number;
      state: BillingPlanChangeOperationRecord["state"];
    }) => {
      if (
        input.id !== operation.id ||
        operation.state !== input.state ||
        operation.leaseToken !== input.leaseToken ||
        operation.fencingEpoch !== input.expectedFencingEpoch
      ) {
        return undefined;
      }
      operation.retryCount = input.retryCount;
      operation.nextRetryAt = input.nextRetryAt;
      operation.lastError = input.lastError ?? null;
      operation.lastOutcome = "retry_scheduled";
      operation.leaseToken = null;
      operation.leaseExpiresAt = null;
      return cloneOperation();
    },
    transition: async (input: {
      expectedFencingEpoch: number;
      expectedState: BillingPlanChangeOperationRecord["state"];
      id: string;
      lastError?: string | null;
      leaseToken: string;
      replacementProviderSubscriptionId?: string | null;
      state: BillingPlanChangeOperationRecord["state"];
    }) => {
      if (
        input.id !== operation.id ||
        operation.state !== input.expectedState ||
        operation.leaseToken !== input.leaseToken ||
        operation.fencingEpoch !== input.expectedFencingEpoch
      ) {
        return undefined;
      }
      operation.state = input.state;
      operation.lastError = input.lastError ?? operation.lastError;
      operation.replacementProviderSubscriptionId =
        input.replacementProviderSubscriptionId ??
        operation.replacementProviderSubscriptionId;
      operation.fencingEpoch += 1;
      return cloneOperation();
    },
  } satisfies PlanChangeCoordinatorRepositories["planChanges"] &
    Pick<BillingPlanChangeRepository, "findExpired">;

  const providerEffects = {
    claim: async (input: {
      effectId: string;
      expectedFencingEpoch: number;
      leaseToken: string;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        (effect.state !== "pending" &&
          (effect.state !== "claimed" ||
            (effect.leaseExpiresAt != null &&
              new Date(effect.leaseExpiresAt).getTime() >= Date.now())))
      ) {
        return undefined;
      }
      effect.state = "claimed";
      effect.leaseToken = input.leaseToken;
      effect.leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
      effect.fencingEpoch += 1;
      effect.attempts += 1;
      if (crashPoint === "effect_claim" && !injected) {
        injected = true;
        effect.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
        throw new Error("crash after provider effect claim");
      }
      return cloneEffect(effect);
    },
    complete: async (input: {
      effectId: string;
      expectedFencingEpoch: number;
      leaseToken: string;
      observedEvidence?: unknown;
      observedResult?: unknown;
      providerResourceId?: string | null;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        effect.leaseToken !== input.leaseToken ||
        effect.state !== "claimed"
      ) {
        return undefined;
      }
      effect.state = "applied";
      effect.providerResourceId = input.providerResourceId ?? null;
      effect.observedEvidence = input.observedEvidence ?? null;
      effect.observedResult = input.observedResult ?? null;
      effect.leaseToken = null;
      effect.leaseExpiresAt = null;
      effect.fencingEpoch += 1;
      return cloneEffect(effect);
    },
    create: async (input: {
      connectionId: string;
      effectType: string;
      idempotencyKey: string;
      operationId: string;
      provider: string;
      requestFingerprint: string;
    }) => {
      const existing = effects.find(
        (effect) =>
          effect.operationId === input.operationId &&
          effect.effectType === input.effectType,
      );
      if (existing) {
        return cloneEffect(existing);
      }
      const effect = effectRecord(
        input.operationId,
        input.effectType as BillingProviderEffectRecord["effectType"],
        `effect-${effects.length + 1}`,
      );
      effect.connectionId = input.connectionId;
      effect.idempotencyKey = input.idempotencyKey;
      effect.provider = input.provider;
      effect.requestFingerprint = input.requestFingerprint;
      effects.push(effect);
      return cloneEffect(effect);
    },
    fail: async (input: {
      effectId: string;
      error: string;
      expectedFencingEpoch: number;
      leaseToken: string;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        effect.leaseToken !== input.leaseToken ||
        effect.state !== "claimed"
      ) {
        return undefined;
      }
      effect.state = "failed";
      effect.lastError = input.error;
      effect.leaseToken = null;
      effect.fencingEpoch += 1;
      return cloneEffect(effect);
    },
    list: async (operationId: string) =>
      effects
        .filter((effect) => effect.operationId === operationId)
        .map(cloneEffect),
    markApplied: async (input: {
      effectId: string;
      expectedFencingEpoch: number;
      observedEvidence?: unknown;
      observedResult?: unknown;
      providerResourceId?: string | null;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        effect.state !== "unknown"
      ) {
        return undefined;
      }
      effect.state = "applied";
      effect.providerResourceId = input.providerResourceId ?? null;
      effect.observedEvidence = input.observedEvidence ?? null;
      effect.observedResult = input.observedResult ?? null;
      effect.fencingEpoch += 1;
      return cloneEffect(effect);
    },
    markAttentionRequired: async (input: {
      effectId: string;
      error: string;
      expectedFencingEpoch: number;
      observedEvidence?: unknown;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        effect.state !== "unknown"
      ) {
        return undefined;
      }
      effect.state = "attention_required";
      effect.lastError = input.error;
      effect.observedEvidence = input.observedEvidence ?? null;
      effect.fencingEpoch += 1;
      return cloneEffect(effect);
    },
    markUnknown: async (input: {
      effectId: string;
      error: string;
      expectedFencingEpoch: number;
      leaseToken: string;
      observedEvidence?: unknown;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        effect.leaseToken !== input.leaseToken ||
        effect.state !== "claimed"
      ) {
        return undefined;
      }
      effect.state = "unknown";
      effect.lastError = input.error;
      effect.observedEvidence = input.observedEvidence ?? null;
      effect.leaseToken = null;
      effect.fencingEpoch += 1;
      return cloneEffect(effect);
    },
    retry: async (input: {
      effectId: string;
      expectedFencingEpoch: number;
    }) => {
      const effect = effects.find((candidate) => candidate.id === input.effectId);
      if (
        !effect ||
        effect.fencingEpoch !== input.expectedFencingEpoch ||
        effect.state !== "unknown"
      ) {
        return undefined;
      }
      effect.state = "pending";
      effect.fencingEpoch += 1;
      return cloneEffect(effect);
    },
  } satisfies PlanChangeCoordinatorRepositories["effects"] &
    Pick<BillingProviderEffectRepository, "fail">;

  const makeAction = (
    effectType: PlanChangeProviderAction["effectType"],
  ): PlanChangeProviderAction => {
    if (effectType === "subscription.update") {
      return {
        classifyError: (error) => {
          if (error instanceof Error && error.message === "unsupported") {
            return "unsupported";
          }
          return error instanceof Error && error.message === "timeout"
            ? "uncertain"
            : "failed";
        },
        effectType,
        idempotencyKey: "update-key",
        invoke: async () => {
          updateCalls += 1;
          if (crashPoint === "update" && !injected) {
            injected = true;
            providerOld = { ...targetSubscription };
            throw new Error("timeout");
          }
          if (crashPoint === "replacement_create" || crashPoint == null) {
            if (crashPoint === "replacement_create") {
              throw new Error("unsupported");
            }
          }
          providerOld = { ...targetSubscription };
          return {
            evidence: providerOld,
            providerResourceId: providerOld.providerSubscriptionId,
            result: providerOld,
          };
        },
        observe: async () => ({
          classification:
            providerOld.amount.value === targetSubscription.amount.value
              ? ("applied" as const)
              : ("not_applied" as const),
          evidence: providerOld,
          providerResourceId: providerOld.providerSubscriptionId,
          result: providerOld,
        }),
        request: { target: targetSubscription },
      };
    }
    if (effectType === "subscription.create.replacement") {
      return {
        classifyError: (error) =>
          error instanceof Error && error.message === "timeout"
            ? "uncertain"
            : "failed",
        effectType,
        idempotencyKey: "replacement-key",
        invoke: async () => {
          replacementCreateCalls += 1;
          providerReplacement = {
            ...targetSubscription,
            providerSubscriptionId: "sub-new",
          };
          if (crashPoint === "replacement_create" && !injected) {
            injected = true;
            throw new Error("timeout");
          }
          return {
            evidence: providerReplacement,
            providerResourceId: providerReplacement.providerSubscriptionId,
            result: providerReplacement,
          };
        },
        observe: async () =>
          providerReplacement
            ? {
                classification: "applied" as const,
                evidence: providerReplacement,
                providerResourceId: providerReplacement.providerSubscriptionId,
                result: providerReplacement,
              }
            : { classification: "not_applied" as const },
        request: { target: targetSubscription },
      };
    }
    if (effectType === "subscription.cancel.old") {
      return {
        classifyError: () => "failed",
        effectType,
        idempotencyKey: "old-cancel-key",
        invoke: async () => {
          providerOld = { ...providerOld, status: "canceled" };
          return {
            evidence: providerOld,
            providerResourceId: providerOld.providerSubscriptionId,
            result: providerOld,
          };
        },
        observe: async () => ({
          classification:
            providerOld.status === "canceled"
              ? ("applied" as const)
              : ("not_applied" as const),
          evidence: providerOld,
          providerResourceId: providerOld.providerSubscriptionId,
          result: providerOld,
        }),
        request: { subscriptionId: "sub-old", status: "canceled" },
      };
    }
    return {
      classifyError: () => "failed",
      effectType,
      idempotencyKey: "replacement-cancel-key",
      invoke: async () => {
        if (!providerReplacement) {
          throw new Error("replacement missing");
        }
        providerReplacement = { ...providerReplacement, status: "canceled" };
        return {
          evidence: providerReplacement,
          providerResourceId: providerReplacement.providerSubscriptionId,
          result: providerReplacement,
        };
      },
      observe: async () =>
        providerReplacement
          ? {
              classification:
                providerReplacement.status === "canceled"
                  ? ("applied" as const)
                  : ("not_applied" as const),
              evidence: providerReplacement,
              providerResourceId: providerReplacement.providerSubscriptionId,
              result: providerReplacement,
            }
          : { classification: "unknown" as const },
      request: { subscriptionId: "sub-new", status: "canceled" },
    };
  };

  const context = {
    actions: {
      "subscription.cancel.old": makeAction("subscription.cancel.old"),
      "subscription.cancel.replacement": makeAction(
        "subscription.cancel.replacement",
      ),
      "subscription.create.replacement": makeAction(
        "subscription.create.replacement",
      ),
      "subscription.update": makeAction("subscription.update"),
    },
    commit: async () => {
      if (crashPoint === "direct_commit" && !injected) {
        localCommitted = true;
        injected = true;
        throw new Error("crash after local commit");
      }
      localCommitted = true;
      return {
        kind: "completed" as const,
        result: {
          id: "owned-subscription",
          localCommitted,
        },
      };
    },
    connectionId: CONNECTION_ID,
    provider: "mollie" as const,
  };

  const repositories = {
    effects: providerEffects,
    planChanges,
  } satisfies PlanChangeCoordinatorRepositories;
  const run = () =>
    runPlanChangeCoordinator({
      context,
      operationId: OPERATION_ID,
      repositories,
    });
  const expire = () => {
    operation.leaseToken = null;
    operation.leaseExpiresAt = null;
    operation.nextRetryAt = new Date(Date.now() - 1_000).toISOString();
    for (const effect of effects) {
      if (effect.state === "claimed") {
        effect.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
      }
    }
  };
  const activeSubscriptions = () =>
    [providerOld, providerReplacement].filter(
      (subscription) => subscription?.status === "active",
    );
  const recovery: PlanChangeRecoveryDependencies = {
    coordinator: async () => {
      const result = await run();
      return { kind: result.kind };
    },
    repository: {
      claim: planChanges.claim,
      findExpired: planChanges.findExpired,
    },
  };

  return {
    activeSubscriptions,
    effects,
    expire,
    localCommitted: () => localCommitted,
    recovery,
    replacementCreateCalls: () => replacementCreateCalls,
    run,
    updateCalls: () => updateCalls,
    operation: () => operation,
  };
}

test("direct update crash after provider mutation reconciles without a duplicate", async () => {
  const harness = createHarness("update");
  const first = await harness.run();
  assert.equal(first.kind, "retry_required");
  assert.equal(harness.updateCalls(), 1);
  harness.expire();

  const recovered = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(recovered.completed, 1);
  assert.equal(harness.operation().state, "completed");
  assert.equal(harness.localCommitted(), true);
  assert.equal(harness.updateCalls(), 1);
  assert.equal(harness.activeSubscriptions().length, 1);

  const repeated = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(repeated.scanned, 0);
  assert.equal(harness.updateCalls(), 1);
});

test("provider effect claim crash is reclaimed before provider execution", async () => {
  const harness = createHarness("effect_claim");
  await assert.rejects(() => harness.run(), /crash after provider effect claim/);
  assert.equal(harness.updateCalls(), 0);
  harness.expire();

  const firstRecovery = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(firstRecovery.retried, 1);
  assert.equal(harness.updateCalls(), 0);
  harness.expire();

  const finalRecovery = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(
    finalRecovery.completed,
    1,
    JSON.stringify({ finalRecovery, operation: harness.operation() })
  );
  assert.equal(harness.updateCalls(), 1);
  assert.equal(harness.activeSubscriptions().length, 1);
});

test("direct local-commit crash resumes from durable local_commit_pending", async () => {
  const harness = createHarness("direct_commit");
  await assert.rejects(() => harness.run(), /crash after local commit/);
  assert.equal(harness.localCommitted(), true);
  harness.expire();

  const recovered = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(recovered.completed, 1);
  assert.equal(harness.operation().state, "completed");
  assert.equal(harness.updateCalls(), 1);
  assert.equal(harness.activeSubscriptions().length, 1);
});

test("replacement-create crash is observed and converges without duplicate active subscriptions", async () => {
  const harness = createHarness("replacement_create");
  const first = await harness.run();
  assert.equal(first.kind, "retry_required");
  assert.equal(harness.replacementCreateCalls(), 1);
  harness.expire();

  const recovered = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(recovered.completed, 1);
  assert.equal(harness.operation().state, "completed");
  assert.equal(harness.replacementCreateCalls(), 1);
  assert.equal(harness.activeSubscriptions().length, 1);

  const repeated = await recoverExpiredPlanChanges(harness.recovery);
  assert.equal(repeated.scanned, 0);
  assert.equal(harness.replacementCreateCalls(), 1);
});
