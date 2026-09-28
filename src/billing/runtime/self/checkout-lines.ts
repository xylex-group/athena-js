export interface BillingSelfCheckoutLineRequest {
  priceId: string;
  quantity: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function resolveSelfCheckoutLineRequests(
  payload: Record<string, unknown>
): BillingSelfCheckoutLineRequest[] {
  const rawLines = payload.lines;
  if (Array.isArray(rawLines) && rawLines.length > 0) {
    return rawLines.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`ATHENA_BILLING_FIELD_REQUIRED:lines[${index}].priceId`);
      }
      const priceId = entry.priceId;
      if (typeof priceId !== "string" || priceId.trim() === "") {
        throw new Error(`ATHENA_BILLING_FIELD_REQUIRED:lines[${index}].priceId`);
      }
      const quantity = entry.quantity;
      if (quantity == null) {
        return { priceId: priceId.trim(), quantity: 1 };
      }
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`ATHENA_BILLING_FIELD_REQUIRED:lines[${index}].quantity`);
      }
      return { priceId: priceId.trim(), quantity };
    });
  }
  const priceId = payload.priceId;
  if (typeof priceId === "string" && priceId.trim() !== "") {
    return [{ priceId: priceId.trim(), quantity: 1 }];
  }
  return [];
}
