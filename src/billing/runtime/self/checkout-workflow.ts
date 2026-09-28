import type { BillingCheckoutComposition } from "./composition.ts";
import type {
  BillingCheckoutSessionKind,
  BillingCheckoutSessionRecord,
} from "./enrollment-session.ts";

/**
 * Durable checkout workflow identity. Session `kind` stays the two-value
 * recovery discriminator (`one_off` vs enrollment). Mixed recurring +
 * one-off checkout is `composed` and must still persist
 * `subscription_enrollment` so browser resume advances enrollment.
 */
export type BillingCheckoutWorkflow =
  | "one_off"
  | "subscription_enrollment"
  | "composed";

export function resolveCheckoutWorkflow(
  composition: Pick<BillingCheckoutComposition, "oneOffLines" | "recurringLine">
): BillingCheckoutWorkflow {
  if (composition.recurringLine != null) {
    return composition.oneOffLines.length > 0
      ? "composed"
      : "subscription_enrollment";
  }
  return "one_off";
}

export function checkoutSessionKindForWorkflow(
  workflow: BillingCheckoutWorkflow
): BillingCheckoutSessionKind {
  return workflow === "one_off" ? "one_off" : "subscription_enrollment";
}

export function checkoutSessionNeedsEnrollmentAdvance(
  session: Pick<BillingCheckoutSessionRecord, "enrollmentId">
): boolean {
  return session.enrollmentId != null && session.enrollmentId.trim() !== "";
}
