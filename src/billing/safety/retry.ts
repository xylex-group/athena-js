import type {
  BillingProviderErrorKind,
  BillingRetryDisposition,
} from "../errors.ts";

import { BILLING_OPERATION_SAFETY } from "./registry.ts";
import type {
  BillingExecutionCertainty,
  BillingOperationSafetyProfile,
  BillingRequestDispatchState,
  BillingRetryDispositionInput,
} from "./types.ts";

const TRANSIENT_KINDS = new Set<string>([
  "network",
  "timeout",
  "rate_limited",
  "provider_unavailable",
]);

function profileFor(
  operation: string
): BillingOperationSafetyProfile | undefined {
  const table: Record<string, BillingOperationSafetyProfile> =
    BILLING_OPERATION_SAFETY;
  return table[operation];
}

export function billingExecutionCertainty(input: {
  kind: string;
  requestDispatchState: BillingRequestDispatchState;
}): BillingExecutionCertainty {
  if (input.requestDispatchState === "not_dispatched") {
    return "definitely_not_executed";
  }
  switch (input.kind) {
    case "authentication":
    case "authorization":
    case "invalid_request":
    case "not_found":
    case "unsupported_operation":
    case "unsupported_currency":
    case "unsupported_payment_method":
      return "definitely_not_executed";
    case "customer_action_required":
    case "payment_declined":
    case "idempotency_conflict":
    case "resource_state_conflict":
    case "conflict":
      return "definitely_executed";
    case "serialization":
      return input.requestDispatchState === "dispatched"
        ? "definitely_executed"
        : "definitely_not_executed";
    case "rate_limited":
      return input.requestDispatchState === "unknown"
        ? "outcome_unknown"
        : "definitely_not_executed";
    case "timeout":
    case "network":
    case "provider_unavailable":
    case "unknown":
      return "outcome_unknown";
    default:
      return input.requestDispatchState === "dispatched"
        ? "outcome_unknown"
        : "definitely_not_executed";
  }
}

function isFinancialWrite(profile: BillingOperationSafetyProfile): boolean {
  return (
    profile.mutationClass === "financial_create" ||
    profile.mutationClass === "financial_cancel"
  );
}

/**
 * Operation-aware retry policy. Kind-only helpers are forbidden.
 */
export function billingRetryDisposition(
  input: BillingRetryDispositionInput
): BillingRetryDisposition {
  const kind = input.kind as BillingProviderErrorKind;
  if (kind === "customer_action_required" || kind === "payment_declined") {
    return "customer_action_required";
  }
  if (kind === "idempotency_conflict" || kind === "resource_state_conflict") {
    return "reconcile_first";
  }
  const certainty = billingExecutionCertainty({
    kind: input.kind,
    requestDispatchState: input.requestDispatchState,
  });
  const profile = profileFor(input.operation);
  const transient = TRANSIENT_KINDS.has(input.kind);
  if (profile?.mutationClass === "read" && transient) {
    return "safe";
  }
  if (certainty === "definitely_not_executed" && transient) {
    return "safe";
  }
  if (certainty === "definitely_executed") {
    return "never";
  }
  if (certainty === "outcome_unknown") {
    const replayOk =
      profile?.replayGuarantee === "provider_same_key" &&
      input.idempotencyKeyPresent === true;
    if (profile != null && isFinancialWrite(profile)) {
      if (profile.mutationClass === "financial_create" && replayOk) {
        return "safe";
      }
      return "reconcile_first";
    }
    if (replayOk) {
      return "safe";
    }
    return "reconcile_first";
  }
  return "never";
}
