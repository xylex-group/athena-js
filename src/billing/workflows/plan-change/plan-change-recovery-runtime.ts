import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { BillingSelfSubscriptionChangeResult } from "../../runtime/types.ts";
import { changeSelfSubscription } from "../../runtime/self/change.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingProviderRegistry } from "../../runtime/local/providers/registry.ts";
import {
  recoverExpiredPlanChanges,
  type PlanChangeRecoveryDiagnostic,
  type PlanChangeRecoveryResult,
} from "./plan-change-recovery.ts";
import { createBillingPlanChangeRepository } from "./plan-change-repository.ts";

export interface PlanChangeRecoveryRuntimeInput {
  batchSize?: number;
  configuredProviders?: BillingProviderConfigMap;
  diagnostics?: (event: PlanChangeRecoveryDiagnostic) => void;
  registry: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}

export interface PlanChangeRecoveryRuntime {
  run(): Promise<PlanChangeRecoveryResult>;
}

function recoveryPrincipal(subjectId: string): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [],
    userId: subjectId,
  };
}

function resultKind(
  result: BillingSelfSubscriptionChangeResult
): "attention_required" | "completed" | "failed" | "retry_required" {
  if (!("operationId" in result)) {
    return "completed";
  }
  if (result.status === "attention_required") {
    return "attention_required";
  }
  if (result.status === "failed") {
    return "failed";
  }
  if (result.status === "completed") {
    return "completed";
  }
  return "retry_required";
}

export function createPlanChangeRecoveryRuntime(
  input: PlanChangeRecoveryRuntimeInput
): PlanChangeRecoveryRuntime {
  const repository = createBillingPlanChangeRepository(input.sql);
  return {
    async run() {
      return recoverExpiredPlanChanges({
        coordinator: async (operationId) => {
          const operation = await repository.load(operationId);
          if (operation == null) {
            throw new Error("Plan-change operation disappeared before recovery.");
          }
          if (operation.subjectKind !== "user") {
            throw new Error(
              `Plan-change recovery does not support subject kind "${operation.subjectKind}".`
            );
          }
          const result = await changeSelfSubscription({
            configuredProviders: input.configuredProviders,
            idempotencyKey: operation.idempotencyKey,
            planChangeEnabled: { enabled: true, planChange: true },
            principal: recoveryPrincipal(operation.subjectId),
            priceId: operation.priceId,
            registry: input.registry,
            sql: input.sql,
            subscriptionId: operation.ownedSubscriptionId,
            testMode: input.testMode,
          });
          return { kind: resultKind(result) };
        },
        countRecoverable: repository.countRecoverable,
        diagnostics: input.diagnostics,
        limit: input.batchSize,
        repository,
      });
    },
  };
}
