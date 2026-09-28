import { randomUUID } from "node:crypto";

import {
  createBillingPlanChangeRepository,
  type BillingPlanChangeOperationRecord,
} from "./plan-change-repository.ts";
import type { BillingProviderEffectRecord } from "./provider-effect-repository.ts";
import type { BillingPlanChangeRepository } from "./plan-change-repository.ts";
import type { BillingProviderName } from "../../types.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type {
  BillingProviderEffectCreateInput,
  BillingProviderEffectRepository,
} from "./provider-effect-repository.ts";
import { fingerprintBillingProviderEffect } from "./provider-effect-repository.ts";
import type {
  PlanChangeProviderObservation as PlanChangeProviderObservationKind,
} from "./plan-change-reconciliation.ts";
import type { BillingPlanChangeState } from "./plan-change-state.ts";
import {
  isBillingPlanChangeState,
  transitionBillingPlanChangeState,
} from "./plan-change-state.ts";

export type PlanChangeProviderEffectType =
  | "subscription.cancel.old"
  | "subscription.cancel.replacement"
  | "subscription.create.replacement"
  | "subscription.update";

export type PlanChangeProviderErrorKind =
  | "failed"
  | "uncertain"
  | "unsupported";

export interface PlanChangeProviderMutationResult {
  evidence?: unknown;
  providerResourceId?: string | null;
  result?: unknown;
}

export interface PlanChangeProviderObservation {
  classification: PlanChangeProviderObservationKind;
  evidence?: unknown;
  providerResourceId?: string | null;
  result?: unknown;
}

export interface PlanChangeProviderAction {
  classifyError?: (error: unknown) => PlanChangeProviderErrorKind;
  effectType: PlanChangeProviderEffectType;
  idempotencyKey: string;
  invoke: () => Promise<PlanChangeProviderMutationResult>;
  observe: () => Promise<PlanChangeProviderObservation>;
  request: unknown;
}

export type PlanChangeCommitResult<TResult = unknown> =
  | { kind: "attention_required"; error: string }
  | { kind: "completed"; result: TResult }
  | { error?: unknown; kind: "retry_required" };

export interface PlanChangeCoordinatorContext<TResult = unknown> {
  actions: Partial<
    Record<PlanChangeProviderEffectType, PlanChangeProviderAction>
  >;
  commit: (input: {
    operation: BillingPlanChangeOperationRecord;
    phase: "direct" | "replacement";
    sql?: BillingSqlExecutor;
  }) => Promise<PlanChangeCommitResult<TResult>>;
  connectionId: string;
  provider: BillingProviderName;
}

export interface PlanChangeCoordinatorRepositories {
  effects: Pick<
    BillingProviderEffectRepository,
    | "claim"
    | "complete"
    | "create"
    | "fail"
    | "list"
    | "markApplied"
    | "markAttentionRequired"
    | "markUnknown"
    | "retry"
  >;
  planChanges: Pick<
    BillingPlanChangeRepository,
    | "attentionRequired"
    | "claim"
    | "complete"
    | "fail"
    | "load"
    | "scheduleRetry"
    | "transaction"
    | "transition"
  >;
}

export interface PlanChangeCoordinatorDiagnostic {
  action: string;
  event: "plan_change_coordinator";
  operationId: string;
  outcome: string;
  state: BillingPlanChangeState;
}

export interface PlanChangeCoordinatorResult<TResult = unknown> {
  error?: unknown;
  kind: "attention_required" | "completed" | "failed" | "retry_required";
  operation: BillingPlanChangeOperationRecord;
  result?: TResult;
  steps: number;
}

export interface PlanChangeRetryPolicy {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetries?: number;
}

export class PlanChangeCoordinatorError extends Error {
  readonly code = "ATHENA_BILLING_PLAN_CHANGE_COORDINATOR_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "PlanChangeCoordinatorError";
  }
}

class PlanChangeTransactionRollback extends Error {
  constructor() {
    super("Plan-change transaction must be rolled back.");
    this.name = "PlanChangeTransactionRollback";
  }
}

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_RETRY_POLICY: Required<PlanChangeRetryPolicy> = {
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  maxRetries: 5,
};

type EffectOutcome =
  | {
      effect: BillingProviderEffectRecord;
      kind: "applied";
    }
  | { error: unknown; kind: "conflicting" }
  | { error: unknown; kind: "failed" }
  | { error: unknown; kind: "retry_required" }
  | { error: unknown; kind: "unknown" }
  | { error: unknown; kind: "unsupported" };

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function defaultErrorKind(error: unknown): PlanChangeProviderErrorKind {
  return error instanceof Error &&
    /timeout|network|unavailable|econn|fetch/i.test(error.message)
    ? "uncertain"
    : "failed";
}

function emit(
  input: {
    action: string;
    diagnostics?: (event: PlanChangeCoordinatorDiagnostic) => void;
    operation: BillingPlanChangeOperationRecord;
    outcome: string;
  },
): void {
  input.diagnostics?.({
    action: input.action,
    event: "plan_change_coordinator",
    operationId: input.operation.id,
    outcome: input.outcome,
    state: input.operation.state,
  });
}

function retryDelay(
  retryCount: number,
  policy: Required<PlanChangeRetryPolicy>,
): number {
  return Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, retryCount - 1),
  );
}

export async function runPlanChangeCoordinator<TResult = unknown>(input: {
  context: PlanChangeCoordinatorContext<TResult>;
  diagnostics?: (event: PlanChangeCoordinatorDiagnostic) => void;
  maxSteps?: number;
  operationId: string;
  repositories: PlanChangeCoordinatorRepositories;
  retryPolicy?: PlanChangeRetryPolicy;
}): Promise<PlanChangeCoordinatorResult<TResult>> {
  const policy = { ...DEFAULT_RETRY_POLICY, ...input.retryPolicy };
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const loadedOperation = await input.repositories.planChanges.load(
    input.operationId,
  );
  if (!loadedOperation) {
    throw new PlanChangeCoordinatorError(
      `Plan-change operation ${input.operationId} was not found.`,
    );
  }
  let operation: BillingPlanChangeOperationRecord = loadedOperation;

  let steps = 0;
  const transition = async (
    state: BillingPlanChangeState,
    lastError?: string,
    replacementProviderSubscriptionId?: string,
  ): Promise<boolean> => {
    transitionBillingPlanChangeState(operation.state, state);
    const next = await input.repositories.planChanges.transition({
      expectedFencingEpoch: operation.fencingEpoch,
      expectedState: operation.state,
      id: operation.id,
      lastError,
      leaseToken: operation.leaseToken ?? "",
      replacementProviderSubscriptionId,
      state,
    });
    if (!next) {
      return false;
    }
    operation = next;
    return true;
  };

  const terminalResult = (
    kind: PlanChangeCoordinatorResult<TResult>["kind"],
    error?: unknown,
    result?: TResult,
  ): PlanChangeCoordinatorResult<TResult> => ({
    ...(error === undefined ? {} : { error }),
    kind,
    operation,
    ...(result === undefined ? {} : { result }),
    steps,
  });

  const scheduleRetry = async (
    error?: unknown,
  ): Promise<PlanChangeCoordinatorResult<TResult>> => {
    const retryCount = (operation.retryCount ?? 0) + 1;
    if (retryCount > policy.maxRetries) {
      const attention = await input.repositories.planChanges.attentionRequired({
        error: errorText(error, "plan_change_retry_budget_exhausted"),
        expectedFencingEpoch: operation.fencingEpoch,
        expectedState: operation.state,
        id: operation.id,
        leaseToken: operation.leaseToken ?? "",
      });
      if (!attention) {
        throw new PlanChangeCoordinatorError(
          "Plan-change lease was lost while recording retry exhaustion.",
        );
      }
      operation = attention;
      return terminalResult("attention_required", error);
    }
    const nextRetryAt = new Date(
      Date.now() + retryDelay(retryCount, policy),
    ).toISOString();
    const scheduled = await input.repositories.planChanges.scheduleRetry({
      expectedFencingEpoch: operation.fencingEpoch,
      id: operation.id,
      lastError: errorText(error, "plan_change_retry_required"),
      leaseToken: operation.leaseToken ?? "",
      nextRetryAt,
      retryCount,
      state: operation.state,
    });
    if (!scheduled) {
      throw new PlanChangeCoordinatorError(
        "Plan-change lease was lost while scheduling retry.",
      );
    }
    operation = scheduled;
    return terminalResult("retry_required", error);
  };

  const reconcileEffect = async (
    action: PlanChangeProviderAction,
    effect: BillingProviderEffectRecord,
  ): Promise<"applied" | "conflicting" | "not_applied" | "unknown"> => {
    let observation: PlanChangeProviderObservation;
    try {
      observation = await action.observe();
    } catch {
      emit({
        action: action.effectType,
        diagnostics: input.diagnostics,
        operation,
        outcome: "observation_failed",
      });
      return "unknown";
    }
    if (observation.classification === "applied") {
      const applied = await input.repositories.effects.markApplied({
        effectId: effect.id,
        expectedFencingEpoch: effect.fencingEpoch,
        observedEvidence: observation.evidence,
        observedResult: observation.result,
        providerResourceId: observation.providerResourceId,
      });
      return applied ? "applied" : "unknown";
    }
    if (observation.classification === "not_applied") {
      const reset = await input.repositories.effects.retry({
        effectId: effect.id,
        expectedFencingEpoch: effect.fencingEpoch,
      });
      return reset ? "not_applied" : "unknown";
    }
    if (observation.classification === "conflicting") {
      const attention = await input.repositories.effects.markAttentionRequired({
        effectId: effect.id,
        error: "provider_state_conflict",
        expectedFencingEpoch: effect.fencingEpoch,
        observedEvidence: observation.evidence,
      });
      if (!attention) {
        return "unknown";
      }
    }
    return observation.classification;
  };

  const executeEffect = async (
    action: PlanChangeProviderAction,
    effects: readonly BillingProviderEffectRecord[],
  ): Promise<EffectOutcome> => {
    let effect = effects.find(
      (candidate) => candidate.effectType === action.effectType,
    );
    let claimedEffect: BillingProviderEffectRecord | undefined;
    if (effect?.state === "applied") {
      return { effect, kind: "applied" };
    }
    if (effect?.state === "unknown") {
      const observation = await reconcileEffect(action, effect);
      if (observation === "applied") {
        const refreshed = await input.repositories.effects.list(operation.id);
        const applied = refreshed.find(
          (candidate) => candidate.effectType === action.effectType,
        );
        if (applied?.state === "applied") {
          return { effect: applied, kind: "applied" };
        }
      }
      if (observation === "not_applied") {
        return {
          error: "provider_effect_not_applied",
          kind: "retry_required",
        };
      }
      if (observation === "conflicting") {
        return { error: "provider_state_conflict", kind: "conflicting" };
      }
      return { error: "provider_outcome_unknown", kind: "unknown" };
    }
    if (effect?.state === "claimed") {
      const leaseExpiresAt =
        effect.leaseExpiresAt == null
          ? undefined
          : new Date(effect.leaseExpiresAt).getTime();
      if (
        leaseExpiresAt !== undefined &&
        (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt > Date.now())
      ) {
        return { error: "provider_effect_claimed", kind: "retry_required" };
      }
      const leaseToken = randomUUID();
      claimedEffect = await input.repositories.effects.claim({
        effectId: effect.id,
        expectedFencingEpoch: effect.fencingEpoch,
        leaseToken,
      });
      if (!claimedEffect) {
        return { error: "provider_effect_claimed", kind: "retry_required" };
      }
      const markedUnknown = await input.repositories.effects.markUnknown({
        effectId: claimedEffect.id,
        error: "provider_effect_lease_expired",
        expectedFencingEpoch: claimedEffect.fencingEpoch,
        leaseToken,
        observedEvidence: {
          outcome: "unknown",
          reason: "expired_claim",
        },
      });
      if (!markedUnknown) {
        return { error: "provider_effect_lease_lost", kind: "retry_required" };
      }
      return { error: "provider_outcome_unknown", kind: "unknown" };
    }
    if (effect?.state === "failed" || effect?.state === "attention_required") {
      return {
        error: effect.lastError ?? "provider_effect_terminal",
        kind: "failed",
      };
    }
    if (!effect) {
      const createInput: BillingProviderEffectCreateInput = {
        connectionId: input.context.connectionId,
        effectType: action.effectType,
        idempotencyKey: action.idempotencyKey,
        operationId: operation.id,
        provider: input.context.provider,
        requestFingerprint: fingerprintBillingProviderEffect(action.request),
      };
      effect = await input.repositories.effects.create(createInput);
    }
    if (effect.state === "claimed") {
      return { error: "provider_effect_claimed", kind: "retry_required" };
    }
    if (effect.state !== "pending") {
      return { error: "provider_effect_not_pending", kind: "failed" };
    }
    if (!claimedEffect) {
      const leaseToken = randomUUID();
      claimedEffect = await input.repositories.effects.claim({
        effectId: effect.id,
        expectedFencingEpoch: effect.fencingEpoch,
        leaseToken,
      });
      if (!claimedEffect) {
        return { error: "provider_effect_claimed", kind: "retry_required" };
      }
    }
    const leaseToken = claimedEffect.leaseToken ?? "";
    try {
      const mutation = await action.invoke();
      const completed = await input.repositories.effects.complete({
        effectId: claimedEffect.id,
        expectedFencingEpoch: claimedEffect.fencingEpoch,
        leaseToken,
        observedEvidence: mutation.evidence,
        observedResult: mutation.result,
        providerResourceId: mutation.providerResourceId,
      });
      if (!completed) {
        return { error: "provider_effect_completion_lost", kind: "retry_required" };
      }
      return { effect: completed, kind: "applied" };
    } catch (error) {
      const kind = action.classifyError?.(error) ?? defaultErrorKind(error);
      if (kind === "uncertain") {
        const unknown = await input.repositories.effects.markUnknown({
          effectId: claimedEffect.id,
          error: "provider_outcome_unknown",
          expectedFencingEpoch: claimedEffect.fencingEpoch,
          leaseToken,
          observedEvidence: { outcome: "unknown" },
        });
        return unknown
          ? { error, kind: "unknown" }
          : { error: "provider_effect_lease_lost", kind: "retry_required" };
      }
      const failed = await input.repositories.effects.fail({
        effectId: claimedEffect.id,
        error: errorText(error, "provider_mutation_failed"),
        expectedFencingEpoch: claimedEffect.fencingEpoch,
        leaseToken,
      });
      return failed
        ? { error, kind: kind === "unsupported" ? "unsupported" : "failed" }
        : { error: "provider_effect_lease_lost", kind: "retry_required" };
    }
  };

  while (steps < maxSteps) {
    steps += 1;
    const effects = await input.repositories.effects.list(operation.id);
    if (!isBillingPlanChangeState(operation.state)) {
      throw new PlanChangeCoordinatorError(
        `Invalid plan-change state for ${operation.id}.`,
      );
    }
    if (
      operation.state !== "completed" &&
      operation.state !== "attention_required" &&
      operation.state !== "failed" &&
      operation.leaseToken == null
    ) {
      const claimed = await input.repositories.planChanges.claim({
        expectedFencingEpoch: operation.fencingEpoch,
        expectedState:
          operation.state === "requested" ? "requested" : undefined,
        id: operation.id,
        leaseToken: randomUUID(),
      });
      if (!claimed) {
        return terminalResult("retry_required", "plan_change_claim_unavailable");
      }
      operation = claimed;
      emit({
        action: "claim",
        diagnostics: input.diagnostics,
        operation,
        outcome: "claimed",
      });
      continue;
    }

    switch (operation.state) {
      case "requested":
        continue;
      case "claimed":
        if (!(await transition("provider_update_pending"))) {
          return scheduleRetry("plan_change_transition_lost");
        }
        continue;
      case "provider_update_pending":
      case "replacement_create_pending":
      case "old_cancel_pending":
      case "compensation_pending": {
        const effectType =
          operation.state === "provider_update_pending"
            ? "subscription.update"
            : operation.state === "replacement_create_pending"
              ? "subscription.create.replacement"
              : operation.state === "old_cancel_pending"
                ? "subscription.cancel.old"
                : "subscription.cancel.replacement";
        const action = input.context.actions[effectType];
        if (!action) {
          throw new PlanChangeCoordinatorError(
            `No provider action is registered for ${effectType}.`,
          );
        }
        const outcome = await executeEffect(action, effects);
        emit({
          action: effectType,
          diagnostics: input.diagnostics,
          operation,
          outcome: outcome.kind,
        });
        if (outcome.kind === "applied") {
          const nextState =
            operation.state === "provider_update_pending"
              ? "provider_update_applied"
              : operation.state === "replacement_create_pending"
                ? "replacement_created"
                : operation.state === "old_cancel_pending"
                  ? "old_cancelled"
                  : "compensation_applied";
          if (
            !(await transition(
              nextState,
              undefined,
              operation.state === "replacement_create_pending"
                ? outcome.effect.providerResourceId ?? undefined
                : undefined,
            ))
          ) {
            return scheduleRetry("plan_change_transition_lost");
          }
          continue;
        }
        if (outcome.kind === "unknown") {
          const nextState =
            operation.state === "provider_update_pending"
              ? "provider_update_unknown"
              : operation.state === "replacement_create_pending"
                ? "replacement_create_unknown"
                : operation.state === "old_cancel_pending"
                  ? "old_cancel_unknown"
                  : "compensation_unknown";
          if (!(await transition(nextState, errorText(outcome.error, "unknown")))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          return scheduleRetry(outcome.error);
        }
        if (outcome.kind === "retry_required") {
          return scheduleRetry(outcome.error);
        }
        if (outcome.kind === "conflicting") {
          if (!(await transition("attention_required", errorText(outcome.error, "provider_state_conflict")))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          return terminalResult("attention_required", outcome.error);
        }
        if (
          outcome.kind === "unsupported" &&
          operation.state === "provider_update_pending"
        ) {
          if (!(await transition("replacement_create_pending"))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          continue;
        }
        const failureState =
          operation.state === "old_cancel_pending"
            ? "compensating"
            : operation.state === "compensation_pending"
              ? "attention_required"
              : "failed";
        if (!(await transition(failureState, errorText(outcome.error, "failed")))) {
          return scheduleRetry("plan_change_transition_lost");
        }
        if (failureState === "compensating") {
          continue;
        }
        return terminalResult(
          failureState === "attention_required" ? "attention_required" : "failed",
          outcome.error,
        );
      }
      case "provider_update_unknown":
      case "replacement_create_unknown":
      case "old_cancel_unknown":
      case "compensation_unknown": {
        const effectType =
          operation.state === "provider_update_unknown"
            ? "subscription.update"
            : operation.state === "replacement_create_unknown"
              ? "subscription.create.replacement"
              : operation.state === "old_cancel_unknown"
                ? "subscription.cancel.old"
                : "subscription.cancel.replacement";
        const action = input.context.actions[effectType];
        const effect = effects.find(
          (candidate) => candidate.effectType === effectType,
        );
        if (!action || !effect) {
          throw new PlanChangeCoordinatorError(
            `Missing provider evidence for ${effectType}.`,
          );
        }
        const observation = await reconcileEffect(action, effect);
        emit({
          action: effectType,
          diagnostics: input.diagnostics,
          operation,
          outcome: observation,
        });
        if (observation === "applied") {
          const appliedEffect = (
            await input.repositories.effects.list(operation.id)
          ).find((candidate) => candidate.effectType === effectType);
          const nextState =
            operation.state === "provider_update_unknown"
              ? "provider_update_applied"
              : operation.state === "replacement_create_unknown"
                ? "replacement_created"
                : operation.state === "old_cancel_unknown"
                  ? "old_cancelled"
                  : "compensation_applied";
          if (
            !(await transition(
              nextState,
              undefined,
              operation.state === "replacement_create_unknown"
                ? appliedEffect?.providerResourceId ?? undefined
                : undefined,
            ))
          ) {
            return scheduleRetry("plan_change_transition_lost");
          }
          continue;
        }
        if (observation === "not_applied") {
          const nextState =
            operation.state === "provider_update_unknown"
              ? "provider_update_pending"
              : operation.state === "replacement_create_unknown"
                ? "replacement_create_pending"
                : operation.state === "old_cancel_unknown"
                  ? "old_cancel_pending"
                  : "compensation_pending";
          if (!(await transition(nextState))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          continue;
        }
        if (observation === "conflicting") {
          if (!(await transition("attention_required", "provider_state_conflict"))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          return terminalResult("attention_required", "provider_state_conflict");
        }
        return scheduleRetry("provider_outcome_unknown");
      }
      case "provider_update_applied":
        if (!(await transition("local_commit_pending"))) {
          return scheduleRetry("plan_change_transition_lost");
        }
        continue;
      case "replacement_created":
        if (!(await transition("old_cancel_pending"))) {
          return scheduleRetry("plan_change_transition_lost");
        }
        continue;
      case "old_cancelled":
        if (!(await transition("local_commit_pending"))) {
          return scheduleRetry("plan_change_transition_lost");
        }
        continue;
      case "compensating":
        if (!(await transition("compensation_pending"))) {
          return scheduleRetry("plan_change_transition_lost");
        }
        continue;
      case "local_commit_pending": {
        let commit: PlanChangeCommitResult<TResult> | undefined;
        const phase = operation.replacementProviderSubscriptionId
          ? "replacement"
          : "direct";
        const transaction = input.repositories.planChanges.transaction;
        if (transaction) {
          try {
            await transaction(async (sql) => {
              commit = await input.context.commit({ operation, phase, sql });
              if (commit.kind !== "completed") {
                throw new PlanChangeTransactionRollback();
              }
              const completed = await createBillingPlanChangeRepository(
                sql
              ).complete({
                expectedFencingEpoch: operation.fencingEpoch,
                expectedState: operation.state,
                id: operation.id,
                leaseToken: operation.leaseToken ?? "",
              });
              if (!completed) {
                commit = {
                  error: "plan_change_completion_lost",
                  kind: "retry_required",
                };
                throw new PlanChangeTransactionRollback();
              }
              operation = completed;
            });
          } catch (error) {
            if (!(error instanceof PlanChangeTransactionRollback)) {
              throw error;
            }
          }
        } else {
          commit = await input.context.commit({ operation, phase });
          if (commit.kind === "completed") {
            const completed = await input.repositories.planChanges.complete({
              expectedFencingEpoch: operation.fencingEpoch,
              expectedState: operation.state,
              id: operation.id,
              leaseToken: operation.leaseToken ?? "",
            });
            if (!completed) {
              return scheduleRetry("plan_change_completion_lost");
            }
            operation = completed;
          }
        }
        if (!commit) {
          throw new PlanChangeCoordinatorError(
            `Plan-change commit did not produce an outcome for ${operation.id}.`
          );
        }
        if (commit.kind === "completed") {
          return terminalResult("completed", undefined, commit.result);
        }
        if (commit.kind === "attention_required") {
          if (!(await transition("attention_required", commit.error))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          return terminalResult("attention_required", commit.error);
        }
        return scheduleRetry(commit.error);
      }
      case "compensation_applied":
        {
          const failureError = operation.lastError ?? "compensation_applied";
          if (!(await transition("failed", failureError))) {
            return scheduleRetry("plan_change_transition_lost");
          }
          return terminalResult("failed", failureError);
        }
      case "completed":
        return terminalResult("completed");
      case "attention_required":
        return terminalResult("attention_required", operation.lastError);
      case "failed":
        return terminalResult("failed", operation.lastError);
    }
  }

  return scheduleRetry("plan_change_step_budget_exhausted");
}
