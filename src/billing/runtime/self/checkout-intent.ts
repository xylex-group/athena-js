import type { BillingPrice } from "../../types.ts";

export type BillingCheckoutIntent =
  | {
      kind: "one_time";
      price: BillingPrice;
    }
  | {
      kind: "recurring";
      interval: string;
      price: BillingPrice;
    };

const ONE_TIME_CATALOG_INTERVALS = new Set([
  "one-off",
  "one_off",
  "once",
  "one-time",
]);

/**
 * Recurring enrollment vs one-off checkout. Empty and explicit one-off
 * tokens are one-time; any other non-empty interval is recurring.
 */
export function isRecurringBillingCatalogInterval(
  interval?: string | null
): boolean {
  const value = typeof interval === "string" ? interval.trim() : "";
  if (value.length === 0) {
    return false;
  }
  return !ONE_TIME_CATALOG_INTERVALS.has(value.toLowerCase());
}

/**
 * Catalog interval is the only Athena checkout classifier.
 * Provider adapters must not infer recurring from metadata (CHK-003).
 */
export function resolveBillingCheckoutIntent(
  price: BillingPrice
): BillingCheckoutIntent {
  if (!isRecurringBillingCatalogInterval(price.interval)) {
    return { kind: "one_time", price };
  }
  const interval =
    typeof price.interval === "string" ? price.interval.trim() : "";
  return { interval, kind: "recurring", price };
}
