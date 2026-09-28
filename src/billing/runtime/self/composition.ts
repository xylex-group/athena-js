/**
 * Mixed checkout composition is a directed addon graph from the primary
 * product (first requested line). `upsell` and `upgrade` are catalog
 * recommendations, not permission to purchase both products. `requires`
 * and `incompatible` remain constraints over the selected set. There is
 * no transitive walk: A→B and B→C does not admit C on a cart whose
 * primary is A.
 */
import { AthenaBillingCapabilityError } from "../../errors.ts";
import {
  addBillingMoney,
  scaleBillingMoney,
} from "../../safety/money.ts";
import type {
  BillingCatalogRelation,
  BillingMoney,
  BillingPrice,
} from "../../types.ts";
import { resolveBillingCheckoutIntent } from "./checkout-intent.ts";
import type { BillingSelfCheckoutLineRequest } from "./checkout-lines.ts";

/** Only `addon` may be purchased with the primary product. */
const COMPOSITION_EDGES = new Set(["addon"]);

export interface BillingCheckoutCompositionLine {
  amount: BillingMoney;
  interval?: string | null;
  price: BillingPrice;
  productId: string;
  quantity: number;
  relationId?: string;
}

export interface BillingCheckoutComposition {
  basePrice: BillingPrice;
  oneOffLines: readonly BillingCheckoutCompositionLine[];
  /**
   * Catalog sum of one-off lines only. The mixed provider payment is
   * `resolveCheckoutSettlement`, not this field plus the recurring line.
   */
  oneOffTotal: BillingMoney | null;
  recurringLine: BillingCheckoutCompositionLine | null;
}

function compositionError(message: string): AthenaBillingCapabilityError {
  return new AthenaBillingCapabilityError({
    message,
    operation: "self.checkout.create",
    reason: "unsupported_operation",
  });
}

function lineAmount(price: BillingPrice, quantity: number): BillingMoney {
  return scaleBillingMoney(price.amount, quantity);
}

function relationForTarget(input: {
  primaryProductId: string;
  relations: readonly BillingCatalogRelation[];
  targetProductId: string;
}): BillingCatalogRelation | undefined {
  return input.relations.find(
    (relation) =>
      COMPOSITION_EDGES.has(relation.type) &&
      relation.targetProductId === input.targetProductId &&
      relation.sourceProductId === input.primaryProductId
  );
}

export function planSelfCheckoutComposition(input: {
  lines: readonly BillingSelfCheckoutLineRequest[];
  prices: readonly BillingPrice[];
  relations: readonly BillingCatalogRelation[];
}): BillingCheckoutComposition {
  if (input.lines.length === 0) {
    throw compositionError("Self checkout requires at least one catalog price.");
  }
  const byPriceId = new Map(input.prices.map((price) => [price.id, price]));
  const resolved: BillingCheckoutCompositionLine[] = [];
  for (const request of input.lines) {
    const price = byPriceId.get(request.priceId);
    if (price == null) {
      throw new AthenaBillingCapabilityError({
        operation: "self.checkout.create",
        reason: "missing_catalog",
      });
    }
    resolved.push({
      amount: lineAmount(price, request.quantity),
      interval: price.interval,
      price,
      productId: price.productId,
      quantity: request.quantity,
    });
  }

  const currency = resolved[0]?.amount.currency;
  if (
    currency == null ||
    resolved.some((line) => line.amount.currency !== currency)
  ) {
    throw compositionError(
      "Self checkout lines must share a single currency."
    );
  }

  const oneOffLines: BillingCheckoutCompositionLine[] = [];
  const recurringLines: BillingCheckoutCompositionLine[] = [];
  for (const line of resolved) {
    const intent = resolveBillingCheckoutIntent(line.price);
    if (intent.kind === "recurring") {
      recurringLines.push(line);
    } else {
      oneOffLines.push(line);
    }
  }
  if (recurringLines.length > 1) {
    throw compositionError(
      "Self checkout accepts at most one recurring catalog price."
    );
  }
  if (oneOffLines.length === 0) {
    throw compositionError(
      "Recurring catalog prices require recurring enrollment and must not execute as one-off payments."
    );
  }

  const selectedProductIds = new Set(resolved.map((line) => line.productId));
  const primaryProductId = resolved[0]?.productId ?? "";
  if (selectedProductIds.size > 1) {
    const extras = [...selectedProductIds].filter(
      (productId) => productId !== primaryProductId
    );
    for (const extra of extras) {
      const relation = relationForTarget({
        primaryProductId,
        relations: input.relations,
        targetProductId: extra,
      });
      if (relation == null) {
        throw compositionError(
          "Self checkout lines must follow catalog relations from the primary product."
        );
      }
      for (const line of resolved) {
        if (line.productId === extra && line.relationId == null) {
          line.relationId = relation.id;
        }
      }
      const extraQty = resolved
        .filter((line) => line.productId === extra)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (
        relation.constraints?.minQuantityContext != null &&
        extraQty < relation.constraints.minQuantityContext
      ) {
        throw compositionError(
          `Self checkout quantity for ${extra} is below the relation minimum.`
        );
      }
      if (
        relation.constraints?.maxQuantityContext != null &&
        extraQty > relation.constraints.maxQuantityContext
      ) {
        throw compositionError(
          `Self checkout quantity for ${extra} exceeds the relation maximum.`
        );
      }
    }
  }

  for (const relation of input.relations) {
    if (relation.type === "incompatible") {
      if (
        selectedProductIds.has(relation.sourceProductId) &&
        selectedProductIds.has(relation.targetProductId)
      ) {
        throw compositionError(
          "Self checkout includes incompatible catalog products."
        );
      }
    }
    if (relation.type === "requires") {
      if (
        selectedProductIds.has(relation.sourceProductId) &&
        !selectedProductIds.has(relation.targetProductId)
      ) {
        throw compositionError(
          "Self checkout is missing a required related catalog product."
        );
      }
    }
  }

  let oneOffTotal: BillingMoney | null = null;
  for (const line of oneOffLines) {
    oneOffTotal =
      oneOffTotal == null ? line.amount : addBillingMoney(oneOffTotal, line.amount);
  }

  const basePrice = resolved[0]?.price;
  if (basePrice == null) {
    throw compositionError("Self checkout requires at least one catalog price.");
  }

  return {
    basePrice,
    oneOffLines,
    oneOffTotal,
    recurringLine: recurringLines[0] ?? null,
  };
}
