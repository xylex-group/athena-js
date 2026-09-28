import { randomUUID } from "node:crypto";

import type {
  BillingPlanChangeRecoveryCandidate,
  BillingPlanChangeRepository,
} from "./plan-change-repository.ts";
import type {
  PlanChangeCoordinatorResult,
} from "./plan-change-coordinator.ts";

export interface PlanChangeRecoveryDiagnostic {
  event: "plan_change_recovery";
  error?: string;
  operationId: string;
  outcome: "attention_required" | "completed" | "failed" | "retry_required" | "claim_unavailable";
  retryCount: number;
}

export interface PlanChangeRecoveryDependencies {
  coordinator: (
    operationId: string,
  ) => Promise<Pick<PlanChangeCoordinatorResult, "kind">>;
  countRecoverable?: () => Promise<number>;
  diagnostics?: (event: PlanChangeRecoveryDiagnostic) => void;
  repository: Pick<BillingPlanChangeRepository, "claim" | "findExpired">;
  limit?: number;
}

export interface PlanChangeRecoveryResult {
  attentionRequired: number;
  completed: number;
  failed: number;
  recoverableOperationBacklog?: number;
  retried: number;
  scanned: number;
}

function emit(
  diagnostics: ((event: PlanChangeRecoveryDiagnostic) => void) | undefined,
  candidate: BillingPlanChangeRecoveryCandidate,
  outcome: PlanChangeRecoveryDiagnostic["outcome"],
  error?: string,
): void {
  diagnostics?.({
    event: "plan_change_recovery",
    ...(error ? { error } : {}),
    operationId: candidate.id,
    outcome,
    retryCount: candidate.retryCount,
  });
}

function safeRecoveryError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "recovery coordinator failed";
  if (/access_|live_|test_|sk_|secret|password|token/i.test(message)) {
    return "recovery coordinator failed";
  }
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

export async function recoverExpiredPlanChanges(
  input: PlanChangeRecoveryDependencies,
): Promise<PlanChangeRecoveryResult> {
  const candidates = await input.repository.findExpired({
    limit: input.limit,
  });
  const result: PlanChangeRecoveryResult = {
    attentionRequired: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    scanned: candidates.length,
  };

  for (const candidate of candidates) {
    const claimed = await input.repository.claim({
      expectedFencingEpoch: candidate.expectedFencingEpoch,
      id: candidate.id,
      leaseToken: randomUUID(),
    });
    if (!claimed) {
      emit(input.diagnostics, candidate, "claim_unavailable");
      continue;
    }
    let outcome: Pick<PlanChangeCoordinatorResult, "kind">;
    try {
      outcome = await input.coordinator(candidate.id);
    } catch (error) {
      emit(input.diagnostics, candidate, "retry_required", safeRecoveryError(error));
      result.retried += 1;
      continue;
    }
    emit(input.diagnostics, candidate, outcome.kind);
    if (outcome.kind === "completed") {
      result.completed += 1;
    } else if (outcome.kind === "failed") {
      result.failed += 1;
    } else if (outcome.kind === "attention_required") {
      result.attentionRequired += 1;
    } else {
      result.retried += 1;
    }
  }
  const recoverableOperationBacklog = input.countRecoverable
    ? await input.countRecoverable()
    : undefined;
  return {
    ...result,
    ...(recoverableOperationBacklog === undefined
      ? {}
      : { recoverableOperationBacklog }),
  };
}

export const recoverPlanChanges = recoverExpiredPlanChanges;
