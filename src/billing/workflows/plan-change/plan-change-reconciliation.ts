import type { BillingMoney } from "../../types.ts";

export type PlanChangeProviderObservation =
  | "applied"
  | "conflicting"
  | "not_applied"
  | "unknown";

export interface PlanChangeProviderSubscriptionState {
  amount?: BillingMoney | null;
  interval?: string | null;
  providerSubscriptionId?: string | null;
  status?: string | null;
}

export interface PlanChangeProviderSubscriptionTarget
  extends PlanChangeProviderSubscriptionState {
  status: "active" | "canceled";
}

function normalizedInterval(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.replace(/^1\s+/, "");
}

function sameAmount(
  actual: BillingMoney | null | undefined,
  intended: BillingMoney | null | undefined,
): boolean {
  return (
    actual?.currency === intended?.currency && actual?.value === intended?.value
  );
}

function matchesTarget(
  actual: PlanChangeProviderSubscriptionState,
  intended: PlanChangeProviderSubscriptionTarget,
): boolean {
  if (
    intended.providerSubscriptionId != null &&
    actual.providerSubscriptionId !== intended.providerSubscriptionId
  ) {
    return false;
  }
  if (intended.amount != null && !sameAmount(actual.amount, intended.amount)) {
    return false;
  }
  if (
    intended.interval != null &&
    normalizedInterval(actual.interval) !== normalizedInterval(intended.interval)
  ) {
    return false;
  }
  return actual.status === intended.status;
}

export function classifyPlanChangeProviderState(input: {
  actual: PlanChangeProviderSubscriptionState | undefined;
  intended: PlanChangeProviderSubscriptionTarget;
  previous?: PlanChangeProviderSubscriptionTarget;
}): PlanChangeProviderObservation {
  if (input.actual == null || input.actual.status == null) {
    return "unknown";
  }
  if (matchesTarget(input.actual, input.intended)) {
    return "applied";
  }
  if (
    input.intended.status === "canceled" &&
    input.actual.status !== "canceled" &&
    input.actual.status !== "cancelled"
  ) {
    return input.actual.status === "active" ? "not_applied" : "unknown";
  }
  if (
    input.previous != null &&
    matchesTarget(input.actual, input.previous)
  ) {
    return "not_applied";
  }
  return "conflicting";
}
