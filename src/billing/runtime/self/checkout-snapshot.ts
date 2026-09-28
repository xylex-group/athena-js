import { addBillingMoney } from "../../safety/money.ts";
import type { BillingMoney, BillingPrice } from "../../types.ts";
import { isRecurringBillingCatalogInterval } from "./checkout-intent.ts";
import type { BillingCheckoutSessionLineRecord } from "./enrollment-session.ts";

/**
 * Snapshot lines that settle on the provider payment.
 *
 * Mixed checkout uses setup/add-on settlement: recurring catalog lines are
 * recorded on the session but are not part of this payment. Enrollment-only
 * first-installment snapshots have no one-off lines, so the recurring line
 * remains payable.
 */

export function payableCheckoutSnapshotLines(
  lines: readonly BillingCheckoutSessionLineRecord[]
): readonly BillingCheckoutSessionLineRecord[] {
  const oneOff = lines.filter(
    (line) => !isRecurringBillingCatalogInterval(line.interval)
  );
  return oneOff.length > 0 ? oneOff : lines;
}

export function paymentAmountFromCheckoutSnapshot(
  lines: readonly BillingCheckoutSessionLineRecord[]
): BillingMoney | null {
  const payable = payableCheckoutSnapshotLines(lines);
  if (payable.length === 0) {
    return null;
  }
  let total: BillingMoney | null = null;
  for (const line of payable) {
    const amount = {
      currency: line.amountCurrency,
      value: line.amountValue,
    };
    total = total == null ? amount : addBillingMoney(total, amount);
  }
  return total;
}

export function recurringPriceFromCheckoutSnapshot(
  lines: readonly BillingCheckoutSessionLineRecord[]
): BillingPrice | null {
  const recurring = lines.find((line) =>
    isRecurringBillingCatalogInterval(line.interval)
  );
  if (recurring == null) {
    return null;
  }
  return {
    amount: {
      currency: recurring.amountCurrency,
      value: recurring.amountValue,
    },
    id: recurring.priceId,
    interval: recurring.interval,
    metadata: {},
    productId: recurring.productId,
    raw: {},
  };
}
