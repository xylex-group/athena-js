import { AthenaBillingError } from "../../errors.ts";

const FORBIDDEN_SELF_SELECTORS = [
  "userId",
  "email",
  "customerId",
  "provider",
  "connectionId",
] as const;

export function rejectSelfPayloadSelectors(payload: unknown): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }
  const record = payload as Record<string, unknown>;
  for (const key of FORBIDDEN_SELF_SELECTORS) {
    if (record[key] != null) {
      throw new AthenaBillingError({
        body: { selector: key },
        code: "ATHENA_BILLING_INVALID_REQUEST",
        endpoint: "",
        message: `Customer billing payloads cannot select ${key}.`,
        method: "POST",
        status: 400,
      });
    }
  }
}

export type SelfBillingOperation =
  | "self.invoices.list"
  | "self.invoices.get"
  | "self.payments.list"
  | "self.payments.get"
  | "self.subscription.get"
  | "self.subscription.cancel"
  | "self.subscription.enroll"
  | "self.subscription.change"
  | "self.checkout.create"
  | "self.checkout.resume"
  | "self.customer.get"
  | "self.entitlements";

export function isSelfBillingOperation(
  operation: string
): operation is SelfBillingOperation {
  return (
    operation === "self.invoices.list" ||
    operation === "self.invoices.get" ||
    operation === "self.payments.list" ||
    operation === "self.payments.get" ||
    operation === "self.subscription.get" ||
    operation === "self.subscription.cancel" ||
    operation === "self.subscription.enroll" ||
    operation === "self.subscription.change" ||
    operation === "self.checkout.create" ||
    operation === "self.checkout.resume" ||
    operation === "self.customer.get" ||
    operation === "self.entitlements"
  );
}
