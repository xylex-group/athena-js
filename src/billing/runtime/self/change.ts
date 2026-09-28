import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import {
  AthenaBillingCapabilityError,
  AthenaBillingProviderRequestError,
  isAthenaBillingCapabilityError,
  isAthenaBillingProviderRequestError,
} from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts";
import {
  type BillingSelfEnrollmentSetting,
  isBillingSelfPlanChangeEnabled,
} from "../../self-enrollment.ts";
import {
  billingConfiguredConnectionOwner,
  configuredProvidersForBillingConnection,
  resolveBillingConnectionAffinity,
} from "../../subject/connection-affinity.ts";
import { billingSubjectNotFound } from "../../subject/errors.ts";
import { requireBillingPrincipalUserId } from "../../subject/principal-user.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingSubscription } from "../../types.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import { executeLocalBillingPriceList } from "../local/execute/price-list.ts";
import {
  executeLocalBillingSubscriptionCancel,
  executeLocalBillingSubscriptionCreate,
  executeLocalBillingSubscriptionGet,
  executeLocalBillingSubscriptionList,
  executeLocalBillingSubscriptionUpdate,
} from "../local/execute/subscriptions.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import {
  runPlanChangeCoordinator,
  type PlanChangeCoordinatorContext,
  type PlanChangeProviderErrorKind,
} from "../../workflows/plan-change/plan-change-coordinator.ts";
import {
  classifyPlanChangeProviderState,
  type PlanChangeProviderObservation,
  type PlanChangeProviderSubscriptionState,
} from "../../workflows/plan-change/plan-change-reconciliation.ts";
import { createBillingPlanChangeRepository } from "../../workflows/plan-change/plan-change-repository.ts";
import { createBillingProviderEffectRepository } from "../../workflows/plan-change/provider-effect-repository.ts";
import { resolveBillingCheckoutIntent } from "./checkout-intent.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";
import { persistOwnedSubscription } from "./enroll.ts";
import { ensureActiveCoordinatorForSubscription } from "./enrollment-reservation.ts";
import { getSelfSubscription } from "./subscriptions.ts";
import type { BillingSelfSubscriptionChangeResult } from "../types.ts";

function mollieInterval(interval: string): string {
  const trimmed = interval.trim();
  if (/^\d+\s+\S/.test(trimmed)) {
    return trimmed;
  }
  return `1 ${trimmed}`;
}

export function isProviderSubscriptionUpdateUnsupported(
  error: unknown
): boolean {
  if (isAthenaBillingCapabilityError(error)) {
    return (
      error.reason === "unsupported_by_provider" ||
      error.reason === "provider_operation_unsupported"
    );
  }
  if (isAthenaBillingProviderRequestError(error)) {
    return error.kind === "unsupported_operation";
  }
  if (error instanceof AthenaBillingCapabilityError) {
    return (
      error.reason === "unsupported_by_provider" ||
      error.reason === "provider_operation_unsupported"
    );
  }
  if (error instanceof AthenaBillingProviderRequestError) {
    return error.kind === "unsupported_operation";
  }
  return false;
}

function isUncertainProviderOutcome(error: unknown): boolean {
  if (isAthenaBillingProviderRequestError(error)) {
    return (
      error.retry === "reconcile_first" ||
      error.kind === "timeout" ||
      error.kind === "network" ||
      error.kind === "provider_unavailable"
    );
  }
  return false;
}

function providerErrorKind(
  error: unknown,
  unsupported: boolean
): PlanChangeProviderErrorKind {
  if (isUncertainProviderOutcome(error)) {
    return "uncertain";
  }
  return unsupported ? "unsupported" : "failed";
}

function providerState(
  value: BillingSubscription
): PlanChangeProviderSubscriptionState {
  return {
    amount: value.amount,
    interval: value.interval,
    providerSubscriptionId: value.providerSubscriptionId,
    status: value.status === "canceled" ? "canceled" : "active",
  };
}

function providerObservation(
  value: BillingSubscription,
  intended: PlanChangeProviderSubscriptionState & {
    status: "active" | "canceled";
  },
  previous?: PlanChangeProviderSubscriptionState & {
    status: "active" | "canceled";
  }
): {
  classification: PlanChangeProviderObservation;
  evidence: PlanChangeProviderSubscriptionState;
  providerResourceId: string;
  result: PlanChangeProviderSubscriptionState;
} {
  const actual = providerState(value);
  return {
    classification: classifyPlanChangeProviderState({
      actual,
      intended,
      previous,
    }),
    evidence: actual,
    providerResourceId: value.providerSubscriptionId,
    result: actual,
  };
}

export function isPlanChangeReplacementCandidate(input: {
  candidate: BillingSubscription;
  operationId: string;
  priceId: string;
}): boolean {
  if (
    input.candidate.status === "canceled" ||
    typeof input.candidate.metadata !== "object" ||
    input.candidate.metadata == null
  ) {
    return false;
  }
  return (
    "athenaPlanChange" in input.candidate.metadata &&
    input.candidate.metadata.athenaPlanChange === true &&
    "athenaPlanChangeOperationId" in input.candidate.metadata &&
    input.candidate.metadata.athenaPlanChangeOperationId ===
      input.operationId &&
    "newPriceId" in input.candidate.metadata &&
    input.candidate.metadata.newPriceId === input.priceId
  );
}

export async function changeSelfSubscription(input: {
  applicationId?: string;
  configuredProviders?: BillingProviderConfigMap;
  currentVersion?: string;
  idempotencyKey: string;
  planChangeEnabled?: BillingSelfEnrollmentSetting;
  principal: AthenaPrincipal;
  priceId: string;
  proration?: "none" | "immediate";
  registry?: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  subscriptionId?: string;
  testMode?: boolean;
}): Promise<BillingSelfSubscriptionChangeResult> {
  if (!isBillingSelfPlanChangeEnabled(input.planChangeEnabled)) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.change",
      reason: "self_enrollment_disabled",
    });
  }
  const command = prepareBillingCommand({
    operation: "self.subscription.change",
    payload: {
      currentVersion: input.currentVersion,
      idempotencyKey: input.idempotencyKey,
      priceId: input.priceId,
      proration: input.proration,
      subscriptionId: input.subscriptionId,
    },
  });
  if (input.registry == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.change",
      reason: "runtime_unavailable",
    });
  }
  if (typeof input.sql.transaction !== "function") {
    throw new AthenaBillingCapabilityError({
      message:
        "self.subscription.change requires a transactional Billing SQL runtime.",
      operation: "self.subscription.change",
      reason: "runtime_unavailable",
    });
  }
  const registry = input.registry;
  const subjectId = requireBillingPrincipalUserId(input.principal);
  const current = await getSelfSubscription({
    principal: input.principal,
    sql: input.sql,
    subscriptionId: input.subscriptionId,
  });
  if (current.status === "canceled") {
    throw billingSubjectNotFound("No active subscription to change.");
  }
  if (current.id == null || current.id.length === 0) {
    throw billingSubjectNotFound("No active subscription to change.");
  }
  const ownedSubscriptionId = current.id;
  const planChanges = createBillingPlanChangeRepository(input.sql);
  const ownedVersion = await planChanges.loadOwnedSubscriptionVersion({
    subjectId,
    subjectKind: "user",
    subscriptionId: ownedSubscriptionId,
  });
  if (!ownedVersion?.connectionId) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.change",
      reason: "provider_connection_missing",
    });
  }
  const connectionAffinity = await resolveBillingConnectionAffinity({
    configuredProviders: input.configuredProviders,
    environment: input.testMode === false ? "live" : "test",
    operation: "self.subscription.change",
    ownedConnectionId: ownedVersion.connectionId,
    provider: current.provider,
    sql: input.sql,
    subjectId,
    subjectKind: "user",
    testMode: input.testMode,
    ...(billingConfiguredConnectionOwner(input.applicationId) ?? {}),
  });
  const configuredProviders = configuredProvidersForBillingConnection({
    affinity: connectionAffinity,
    configuredProviders: input.configuredProviders,
    operation: "self.subscription.change",
  });
  const connectionId = connectionAffinity.connectionId;
  const rowVersion = ownedVersion?.rowVersion ?? 1;
  if (
    input.currentVersion != null &&
    input.currentVersion.trim() !== "" &&
    input.currentVersion !== String(rowVersion)
  ) {
    throw new AthenaBillingCapabilityError({
      message: "Subscription version does not match the current plan.",
      operation: "self.subscription.change",
      reason: "unsupported_operation",
    });
  }
  const prices = await executeLocalBillingPriceList({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders,
    payload: {},
    principal: selfDelegatedBillingPrincipal(input.principal, ["prices.list"]),
    registry,
    testMode: input.testMode,
  });
  const price = prices.items.find(
    (item) => item.id === String(command.payload.priceId)
  );
  if (price == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.change",
      reason: "missing_catalog",
    });
  }
  const intent = resolveBillingCheckoutIntent(price);
  if (intent.kind !== "recurring") {
    throw new AthenaBillingCapabilityError({
      message: "Plan changes require a recurring catalog price.",
      operation: "self.subscription.change",
      reason: "unsupported_operation",
    });
  }
  const coordinator = await ensureActiveCoordinatorForSubscription({
    connectionId,
    idempotencyKey: `coordinator:${current.id}`,
    priceId: price.id,
    providerSubscriptionId: current.providerSubscriptionId,
    sql: input.sql,
    subjectId,
    subjectKind: "user",
  });
  if (coordinator.state !== "active") {
    throw new AthenaBillingCapabilityError({
      message: "A pending enrollment must finish before changing plan.",
      operation: "self.subscription.change",
      reason: "unsupported_operation",
    });
  }

  const createdOperation = await planChanges.create({
    connectionId,
    enrollmentId: coordinator.id,
    expectedRowVersion: rowVersion,
    idempotencyKey: input.idempotencyKey,
    ownedSubscriptionId,
    priceId: price.id,
    subjectId,
    subjectKind: "user",
  });
  const providerEffects = createBillingProviderEffectRepository(input.sql);
  if (createdOperation.state === "completed") {
    return current;
  }
  let latestUpdated: BillingSubscription | undefined;
  let latestReplacement: BillingSubscription | undefined;
  const planChangeEffectMetadata = {
    athenaPlanChange: true,
    athenaPlanChangeOperationId: createdOperation.id,
    newPriceId: price.id,
    oldPriceId:
      typeof current.metadata === "object" &&
      current.metadata != null &&
      "priceId" in current.metadata
        ? String((current.metadata as { priceId?: unknown }).priceId ?? "")
        : "",
    proration: input.proration ?? "none",
    providerOperations: ["subscriptions.update"],
  };
  const metadata = {
    ...planChangeEffectMetadata,
    athenaSubjectId: subjectId,
  };
  const replacementTarget = (): PlanChangeProviderSubscriptionState & {
    status: "active";
  } => ({
    amount: price.amount,
    interval: intent.interval,
    providerSubscriptionId:
      latestReplacement?.providerSubscriptionId ??
      createdOperation.replacementProviderSubscriptionId,
    status: "active",
  });
  const loadReplacement = async (
    replacementId: string
  ): Promise<BillingSubscription> =>
    executeLocalBillingSubscriptionGet({
      authority: PROCESS_BILLING_INVOCATION,
      configuredProviders,
      payload: {
        customerId: current.providerCustomerId,
        subscriptionId: replacementId,
      },
      principal: selfDelegatedBillingPrincipal(input.principal, [
        "subscriptions.get",
      ]),
      registry,
      testMode: input.testMode,
    });
  const observeReplacement = async (): Promise<{
    classification: PlanChangeProviderObservation;
    evidence?: unknown;
    providerResourceId?: string;
    result?: PlanChangeProviderSubscriptionState;
  }> => {
    const replacementId =
      latestReplacement?.providerSubscriptionId ??
      createdOperation.replacementProviderSubscriptionId;
    if (replacementId != null) {
      return providerObservation(
        await loadReplacement(replacementId),
        replacementTarget()
      );
    }
    const listed = await executeLocalBillingSubscriptionList({
      authority: PROCESS_BILLING_INVOCATION,
      configuredProviders,
      payload: {
        customerId: current.providerCustomerId,
        limit: 100,
      },
      principal: selfDelegatedBillingPrincipal(input.principal, [
        "subscriptions.list",
      ]),
      registry,
      testMode: input.testMode,
    });
    const replacement = listed.items.find((candidate) => {
      return isPlanChangeReplacementCandidate({
        candidate,
        operationId: createdOperation.id,
        priceId: price.id,
      });
    });
    if (replacement == null) {
      return {
        classification: "not_applied",
        evidence: { listed: listed.items.length },
      };
    }
    return providerObservation(replacement, replacementTarget());
  };
  const context: PlanChangeCoordinatorContext<BillingSubscription> = {
    actions: {
      "subscription.cancel.old": {
        effectType: "subscription.cancel.old",
        idempotencyKey: `${input.idempotencyKey}:old-cancel`,
        request: {
          customerId: current.providerCustomerId,
          subscriptionId: current.providerSubscriptionId,
        },
        invoke: async () => {
          const canceled = await executeLocalBillingSubscriptionCancel({
            authority: PROCESS_BILLING_INVOCATION,
            configuredProviders,
            payload: {
              customerId: current.providerCustomerId,
              subscriptionId: current.providerSubscriptionId,
            },
            principal: selfDelegatedBillingPrincipal(input.principal, [
              "subscriptions.cancel",
            ]),
            registry,
            testMode: input.testMode,
          });
          return {
            evidence: providerState(canceled),
            providerResourceId: canceled.providerSubscriptionId,
            result: providerState(canceled),
          };
        },
        observe: async () =>
          providerObservation(
            await executeLocalBillingSubscriptionGet({
              authority: PROCESS_BILLING_INVOCATION,
              configuredProviders,
              payload: {
                customerId: current.providerCustomerId,
                subscriptionId: current.providerSubscriptionId,
              },
              principal: selfDelegatedBillingPrincipal(input.principal, [
                "subscriptions.get",
              ]),
              registry,
              testMode: input.testMode,
            }),
            {
              providerSubscriptionId: current.providerSubscriptionId,
              status: "canceled",
            },
            {
              amount: current.amount,
              interval: current.interval,
              providerSubscriptionId: current.providerSubscriptionId,
              status: "active",
            }
          ),
        classifyError: (error) => providerErrorKind(error, false),
      },
      "subscription.cancel.replacement": {
        effectType: "subscription.cancel.replacement",
        idempotencyKey: `${input.idempotencyKey}:replacement-cancel`,
        request: {
          customerId: current.providerCustomerId,
          subscriptionId: replacementTarget().providerSubscriptionId,
        },
        invoke: async () => {
          const replacementId = replacementTarget().providerSubscriptionId;
          if (replacementId == null) {
            throw new Error("Replacement subscription id is missing.");
          }
          const canceled = await executeLocalBillingSubscriptionCancel({
            authority: PROCESS_BILLING_INVOCATION,
            configuredProviders,
            payload: {
              customerId: current.providerCustomerId,
              subscriptionId: replacementId,
            },
            principal: selfDelegatedBillingPrincipal(input.principal, [
              "subscriptions.cancel",
            ]),
            registry,
            testMode: input.testMode,
          });
          return {
            evidence: providerState(canceled),
            providerResourceId: canceled.providerSubscriptionId,
            result: providerState(canceled),
          };
        },
        observe: async () => {
          const replacementId = replacementTarget().providerSubscriptionId;
          if (replacementId == null) {
            return { classification: "unknown" as const };
          }
          return providerObservation(
            await loadReplacement(replacementId),
            {
              providerSubscriptionId: replacementId,
              status: "canceled",
            },
            replacementTarget()
          );
        },
        classifyError: (error) => providerErrorKind(error, false),
      },
      "subscription.create.replacement": {
        effectType: "subscription.create.replacement",
        idempotencyKey: `${input.idempotencyKey}:replacement`,
        request: {
          amount: price.amount,
          customerId: current.providerCustomerId,
          interval: mollieInterval(intent.interval),
          metadata: planChangeEffectMetadata,
        },
        invoke: async () => {
          const replacement = await executeLocalBillingSubscriptionCreate({
            authority: PROCESS_BILLING_INVOCATION,
            configuredProviders,
            payload: {
              amount: price.amount,
              customerId: current.providerCustomerId,
              description: `Athena plan ${price.id}`,
              idempotencyKey: `${input.idempotencyKey}:replacement`,
              interval: mollieInterval(intent.interval),
              metadata,
            },
            principal: selfDelegatedBillingPrincipal(input.principal, [
              "subscriptions.create",
            ]),
            registry,
            testMode: input.testMode,
          });
          latestReplacement = replacement;
          return {
            evidence: providerState(replacement),
            providerResourceId: replacement.providerSubscriptionId,
            result: providerState(replacement),
          };
        },
        observe: observeReplacement,
        classifyError: (error) => providerErrorKind(error, false),
      },
      "subscription.update": {
        effectType: "subscription.update",
        idempotencyKey: input.idempotencyKey,
        request: {
          amount: price.amount,
          customerId: current.providerCustomerId,
          interval: mollieInterval(intent.interval),
          metadata: planChangeEffectMetadata,
          subscriptionId: current.providerSubscriptionId,
        },
        invoke: async () => {
          const updated = await executeLocalBillingSubscriptionUpdate({
            authority: PROCESS_BILLING_INVOCATION,
            configuredProviders,
            payload: {
              amount: price.amount,
              customerId: current.providerCustomerId,
              description: `Athena plan ${price.id}`,
              interval: mollieInterval(intent.interval),
              metadata,
              subscriptionId: current.providerSubscriptionId,
            },
            principal: selfDelegatedBillingPrincipal(input.principal, [
              "subscriptions.update",
            ]),
            registry,
            testMode: input.testMode,
          });
          latestUpdated = updated;
          return {
            evidence: providerState(updated),
            providerResourceId: updated.providerSubscriptionId,
            result: providerState(updated),
          };
        },
        observe: async () =>
          providerObservation(
            await executeLocalBillingSubscriptionGet({
              authority: PROCESS_BILLING_INVOCATION,
              configuredProviders,
              payload: {
                customerId: current.providerCustomerId,
                subscriptionId: current.providerSubscriptionId,
              },
              principal: selfDelegatedBillingPrincipal(input.principal, [
                "subscriptions.get",
              ]),
              registry,
              testMode: input.testMode,
            }),
            {
              amount: price.amount,
              interval: intent.interval,
              providerSubscriptionId: current.providerSubscriptionId,
              status: "active",
            },
            {
              amount: current.amount,
              interval: current.interval,
              providerSubscriptionId: current.providerSubscriptionId,
              status: "active",
            }
          ),
        classifyError: (error) =>
          providerErrorKind(
            error,
            isProviderSubscriptionUpdateUnsupported(error)
          ),
      },
    },
    commit: async ({ operation, phase, sql: commitSql }) => {
      try {
        const commitPlanChanges = commitSql
          ? createBillingPlanChangeRepository(commitSql)
          : planChanges;
        const localSql = commitSql ?? input.sql;
        if (phase === "direct") {
          const updated = latestUpdated ?? {
            ...current,
            amount: price.amount,
            description: `Athena plan ${price.id}`,
            interval: intent.interval,
          };
          const persisted = await commitPlanChanges.updateOwnedSubscription({
            amountCurrency: price.amount.currency,
            amountValue: price.amount.value,
            description: updated.description ?? `Athena plan ${price.id}`,
            expectedRowVersion: rowVersion,
            interval: intent.interval,
            metadata,
            subjectId,
            subjectKind: "user",
            subscriptionId: ownedSubscriptionId,
          });
          if (!persisted) {
            return {
              error: "subscription_version_conflict",
              kind: "attention_required" as const,
            };
          }
          return {
            kind: "completed" as const,
            result: {
              ...current,
              ...updated,
              amount: price.amount,
              description: updated.description ?? `Athena plan ${price.id}`,
              id: current.id,
            },
          };
        }
        const replacementId = operation.replacementProviderSubscriptionId;
        if (replacementId == null) {
          return {
            error: "replacement_subscription_id_missing",
            kind: "attention_required" as const,
          };
        }
        const replacement =
          latestReplacement?.providerSubscriptionId === replacementId
            ? latestReplacement
            : await loadReplacement(replacementId);
        const persisted = await persistOwnedSubscription({
          connectionId,
          interval: intent.interval,
          operation: "self.subscription.change",
          principal: input.principal,
          sql: localSql,
          subscription: replacement,
        });
        const canceled = await commitPlanChanges.markOwnedSubscriptionCanceled({
          expectedRowVersion: rowVersion,
          subjectId,
          subscriptionId: ownedSubscriptionId,
        });
        if (!canceled) {
          return {
            error: "subscription_version_conflict",
            kind: "attention_required" as const,
          };
        }
        return { kind: "completed" as const, result: persisted };
      } catch (error) {
        return { error, kind: "retry_required" as const };
      }
    },
    connectionId,
    provider: current.provider,
  };

  const coordinated = await runPlanChangeCoordinator<BillingSubscription>({
    context,
    operationId: createdOperation.id,
    repositories: {
      effects: providerEffects,
      planChanges,
    },
  });
  if (coordinated.kind === "completed") {
    if (coordinated.result == null) {
      throw new Error("Plan-change coordinator completed without a result.");
    }
    return coordinated.result;
  }
  return {
    ...(coordinated.error
      ? {
          error:
            coordinated.error instanceof Error
              ? coordinated.error.message
              : String(coordinated.error),
        }
      : {}),
    operationId: coordinated.operation.id,
    priceId: coordinated.operation.priceId,
    state: coordinated.operation.state,
    status:
      coordinated.kind === "attention_required"
        ? "attention_required"
        : coordinated.kind === "failed"
          ? "failed"
          : "processing",
    ...(coordinated.operation.updatedAt
      ? { updatedAt: coordinated.operation.updatedAt }
      : {}),
  };
}
