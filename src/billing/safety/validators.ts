import { AthenaBillingError } from "../errors.ts";
import type { BillingOperation } from "../runtime/capabilities.ts";
import { resolveSelfCheckoutLineRequests } from "../runtime/self/checkout-lines.ts";
import type { BillingMoney } from "../types.ts";
import { assertBillingIdempotencyKey } from "./idempotency.ts";
import { assertBillingMoney, normalizeBillingMoney } from "./money.ts";
import type { BillingOperationSafetyProfile } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requiredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`ATHENA_BILLING_FIELD_REQUIRED:${field}`);
  }
  return value;
}

function requiredMoney(value: unknown): BillingMoney {
  return assertBillingMoney(value);
}

function requiredWebhookEventTypes(
  value: unknown,
  operation: "webhooks.create" | "webhooks.update"
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    throw new AthenaBillingError({
      body: { field: "eventTypes", operation },
      code: "ATHENA_BILLING_INVALID_REQUEST",
      endpoint: "",
      message: "Webhook eventTypes must contain at least one non-empty string.",
      method: operation === "webhooks.create" ? "POST" : "PATCH",
      status: 400,
    });
  }
  return value.map((entry) => entry.trim());
}

export function validateBillingOperationPayload(input: {
  deferIdempotency?: boolean;
  operation: BillingOperation;
  payload: unknown;
  profile: BillingOperationSafetyProfile;
}): Record<string, unknown> {
  if (!isRecord(input.payload)) {
    throw new Error("ATHENA_BILLING_PAYLOAD_INVALID");
  }
  const next: Record<string, unknown> = { ...input.payload };
  if (input.profile.money === "required") {
    next.amount = requiredMoney(next.amount);
  } else if (next.amount != null) {
    next.amount = normalizeBillingMoney(next.amount);
  }
  switch (input.operation) {
    case "refunds.create":
      requiredNonEmptyString(next.paymentId, "paymentId");
      break;
    case "paymentLinks.create":
      requiredNonEmptyString(next.description, "description");
      break;
    case "subscriptions.create":
      requiredNonEmptyString(next.customerId, "customerId");
      requiredNonEmptyString(next.interval, "interval");
      requiredNonEmptyString(next.description, "description");
      break;
    case "checkout.create":
      requiredNonEmptyString(next.successUrl, "successUrl");
      break;
    case "self.checkout.create": {
      const lines = resolveSelfCheckoutLineRequests(next);
      if (lines.length === 0) {
        requiredNonEmptyString(next.priceId, "priceId");
      }
      const hasSuccessUrl =
        typeof next.successUrl === "string" && next.successUrl.trim() !== "";
      const hasCancelUrl =
        typeof next.cancelUrl === "string" && next.cancelUrl.trim() !== "";
      if (!(hasSuccessUrl || hasCancelUrl)) {
        throw new Error("ATHENA_BILLING_FIELD_REQUIRED:successUrl|cancelUrl");
      }
      next.lines = lines;
      next.priceId = lines[0]?.priceId;
      break;
    }
    case "self.checkout.resume":
      requiredNonEmptyString(next.returnToken, "returnToken");
      break;
    case "self.subscription.enroll":
      requiredNonEmptyString(next.priceId, "priceId");
      break;
    case "self.subscription.change":
      requiredNonEmptyString(next.priceId, "priceId");
      break;
    case "webhooks.create":
    case "webhooks.update":
      if (next.eventTypes !== undefined) {
        next.eventTypes = requiredWebhookEventTypes(
          next.eventTypes,
          input.operation
        );
      }
      break;
    default:
      break;
  }
  if (
    input.profile.idempotency === "required_caller_owned" &&
    input.deferIdempotency !== true
  ) {
    assertBillingIdempotencyKey(next.idempotencyKey);
  }
  return next;
}
