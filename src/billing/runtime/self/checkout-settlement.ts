import type { BillingMoney } from "../../types.ts";
import type { BillingCheckoutComposition } from "./composition.ts";

/**
 * Mixed `self.checkout.create` is **setup / add-on settlement** (Model B):
 *
 * - Provider payment = one-off catalog lines only.
 * - Recurring first installment is **not** collected in that payment.
 * - After the payment is paid, `self.subscription.enroll` advance creates the
 *   subscription at the recurring price under provider start semantics.
 *
 * Pure `self.subscription.enroll` remains **first-installment** (the first
 * payment equals the recurring price). Those contracts are not the same.
 *
 * Model A (first installment + add-ons, subscription starts next period) is
 * not implemented in this slice.
 */
export const MIXED_CHECKOUT_SETTLEMENT = "setup_addons_only" as const;

export type BillingCheckoutSettlementModel =
  | "one_off_lines"
  | typeof MIXED_CHECKOUT_SETTLEMENT;

export type BillingCheckoutSettlement = {
  includesRecurringFirstInstallment: false;
  model: BillingCheckoutSettlementModel;
  providerPaymentAmount: BillingMoney;
};

export function resolveCheckoutSettlement(
  composition: Pick<BillingCheckoutComposition, "oneOffTotal" | "recurringLine">
): BillingCheckoutSettlement | null {
  const providerPaymentAmount = composition.oneOffTotal;
  if (providerPaymentAmount == null) {
    return null;
  }
  if (composition.recurringLine != null) {
    return {
      includesRecurringFirstInstallment: false,
      model: MIXED_CHECKOUT_SETTLEMENT,
      providerPaymentAmount,
    };
  }
  return {
    includesRecurringFirstInstallment: false,
    model: "one_off_lines",
    providerPaymentAmount,
  };
}
