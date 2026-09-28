import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingProduct } from "../../types.ts";

export type BillingPaymentPresentationKind = "checkout" | "first_payment";

export interface BillingPaymentPresentationLine {
  priceId: string;
  productId: string;
  productName: string;
  quantity: number;
}

export interface BillingPaymentPresentation {
  description: string;
  lines: readonly BillingPaymentPresentationLine[];
}

export interface BillingPaymentPresentationLineInput {
  interval?: string | null;
  priceId: string;
  productId: string;
  quantity: number;
}

function paymentPresentationLabel(
  line: BillingPaymentPresentationLine,
): string {
  return line.quantity === 1
    ? line.productName
    : `${line.quantity} x ${line.productName}`;
}

export function freezeBillingPaymentPresentation(input: {
  kind: BillingPaymentPresentationKind;
  lines: readonly BillingPaymentPresentationLineInput[];
  operation: string;
  products: readonly Pick<BillingProduct, "id" | "name">[];
}): BillingPaymentPresentation {
  const productsById = new Map<string, number>();
  for (const product of input.products) {
    productsById.set(product.id, (productsById.get(product.id) ?? 0) + 1);
  }
  const lines = input.lines.map((line) => {
    const productCount = productsById.get(line.productId) ?? 0;
    const product = input.products.find(
      (candidate) => candidate.id === line.productId,
    );
    const productName = product?.name.trim() ?? "";
    if (
      productCount !== 1 ||
      productName.length === 0 ||
      line.priceId.trim().length === 0 ||
      line.productId.trim().length === 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1
    ) {
      throw new AthenaBillingCapabilityError({
        operation: input.operation,
        reason: "missing_catalog",
      });
    }
    return {
      priceId: line.priceId,
      productId: line.productId,
      productName,
      quantity: line.quantity,
    };
  });
  if (lines.length === 0) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "missing_catalog",
    });
  }
  const prefix =
    input.kind === "checkout" ? "Athena checkout" : "Athena first payment";
  return {
    description: `${prefix} ${lines
      .map(paymentPresentationLabel)
      .join(" + ")}`,
    lines,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseBillingPaymentPresentation(
  value: unknown,
): BillingPaymentPresentation | null {
  if (!isRecord(value) || typeof value.description !== "string") {
    return null;
  }
  if (!Array.isArray(value.lines) || value.lines.length === 0) {
    return null;
  }
  const lines: BillingPaymentPresentationLine[] = [];
  for (const candidate of value.lines) {
    if (!isRecord(candidate)) {
      return null;
    }
    const { priceId, productId, productName, quantity } = candidate;
    if (
      typeof priceId !== "string" ||
      typeof productId !== "string" ||
      typeof productName !== "string" ||
      typeof quantity !== "number" ||
      priceId.trim().length === 0 ||
      productId.trim().length === 0 ||
      productName.trim().length === 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      return null;
    }
    lines.push({ priceId, productId, productName, quantity });
  }
  return {
    description: value.description,
    lines,
  };
}
