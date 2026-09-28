import { createHash } from "node:crypto";

import { AthenaBillingError } from "../../errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingCheckoutComposition } from "./composition.ts";
import {
  type BillingCheckoutSessionLineRecord,
  type BillingCheckoutSessionRecord,
  listCheckoutSessionLines,
} from "./enrollment-session.ts";

export const CHECKOUT_INTENT_HASH_METADATA_KEY = "checkoutIntentHash";

export interface CheckoutIntentDigestLine {
  amountCurrency: string;
  amountValue: string;
  interval: string | null;
  priceId: string;
  productId: string;
  quantity: number;
  relationId: string | null;
}

export function digestLinesFromComposition(
  composition: Pick<BillingCheckoutComposition, "oneOffLines" | "recurringLine">
): CheckoutIntentDigestLine[] {
  const lines = [
    ...composition.oneOffLines,
    ...(composition.recurringLine ? [composition.recurringLine] : []),
  ];
  return lines.map((line) => ({
    amountCurrency: line.amount.currency,
    amountValue: line.amount.value,
    interval: line.interval ?? null,
    priceId: line.price.id,
    productId: line.productId,
    quantity: line.quantity,
    relationId: line.relationId ?? null,
  }));
}

export function digestLinesFromRecords(
  lines: readonly BillingCheckoutSessionLineRecord[]
): CheckoutIntentDigestLine[] {
  return lines.map((line) => ({
    amountCurrency: line.amountCurrency,
    amountValue: line.amountValue,
    interval: line.interval,
    priceId: line.priceId,
    productId: line.productId,
    quantity: line.quantity,
    relationId: line.relationId,
  }));
}

export function hashCheckoutRequestIdentity(
  lines: readonly { priceId: string; quantity: number }[]
): string {
  const canonical = [...lines]
    .map((line) => ({
      priceId: line.priceId,
      quantity: line.quantity,
    }))
    .sort((left, right) => {
      const price = left.priceId.localeCompare(right.priceId);
      if (price !== 0) {
        return price;
      }
      return left.quantity - right.quantity;
    });
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

export function hashCheckoutIntent(
  lines: readonly CheckoutIntentDigestLine[]
): string {
  const canonical = [...lines]
    .map((line) => ({
      amount: {
        currency: line.amountCurrency,
        value: line.amountValue,
      },
      interval: line.interval ?? null,
      priceId: line.priceId,
      productId: line.productId,
      quantity: line.quantity,
      relationId: line.relationId ?? null,
    }))
    .sort((left, right) => {
      const price = left.priceId.localeCompare(right.priceId);
      if (price !== 0) {
        return price;
      }
      const product = left.productId.localeCompare(right.productId);
      if (product !== 0) {
        return product;
      }
      return left.quantity - right.quantity;
    });
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

export function checkoutIdempotencyConflict(
  sessionId: string
): AthenaBillingError {
  return new AthenaBillingError({
    body: { sessionId },
    code: "ATHENA_BILLING_IDEMPOTENCY_CONFLICT",
    endpoint: "",
    message:
      "This idempotencyKey already identifies a different checkout purchase.",
    method: "POST",
    status: 409,
  });
}

export async function assertMatchingCheckoutRequest(input: {
  existing: BillingCheckoutSessionRecord;
  requests: readonly { priceId: string; quantity: number }[];
  sql: BillingSqlExecutor;
}): Promise<void> {
  const lines = await listCheckoutSessionLines({
    checkoutSessionId: input.existing.id,
    sql: input.sql,
  });
  if (lines.length === 0) {
    return;
  }
  if (
    hashCheckoutRequestIdentity(input.requests) !==
    hashCheckoutRequestIdentity(
      lines.map((line) => ({
        priceId: line.priceId,
        quantity: line.quantity,
      }))
    )
  ) {
    throw checkoutIdempotencyConflict(input.existing.id);
  }
}

export async function assertMatchingCheckoutIntent(input: {
  existing: BillingCheckoutSessionRecord;
  intentHash: string;
  sql: BillingSqlExecutor;
}): Promise<void> {
  const stored = storedCheckoutIntentHash(input.existing);
  if (stored != null) {
    if (stored !== input.intentHash) {
      throw checkoutIdempotencyConflict(input.existing.id);
    }
    return;
  }
  const lines = await listCheckoutSessionLines({
    checkoutSessionId: input.existing.id,
    sql: input.sql,
  });
  if (lines.length === 0) {
    return;
  }
  if (hashCheckoutIntent(digestLinesFromRecords(lines)) !== input.intentHash) {
    throw checkoutIdempotencyConflict(input.existing.id);
  }
}

function storedCheckoutIntentHash(
  session: BillingCheckoutSessionRecord
): string | null {
  const value = session.metadata[CHECKOUT_INTENT_HASH_METADATA_KEY];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
