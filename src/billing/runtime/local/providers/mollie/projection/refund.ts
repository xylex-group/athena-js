import { AthenaBillingProviderRequestError } from "../../../../../errors.ts";
import { normalizeBillingMoney } from "../../../../../safety/money.ts";
import { billingRetryDisposition } from "../../../../../safety/retry.ts";
import type {
  BillingMoney,
  BillingRefund,
  BillingRefundStatus,
} from "../../../../../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null | undefined {
  if (value == null) {
    return value === undefined ? undefined : null;
  }
  if (typeof value === "string") {
    return value;
  }
}

function serializationRetry() {
  return billingRetryDisposition({
    idempotencyKeyPresent: false,
    kind: "serialization",
    operation: "refunds.get",
    requestDispatchState: "dispatched",
  });
}

function projectMoney(value: unknown): BillingMoney | undefined {
  if (!isRecord(value)) {
    return;
  }
  if (typeof value.currency !== "string" || typeof value.value !== "string") {
    return;
  }
  try {
    return normalizeBillingMoney(value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ATHENA_BILLING_MONEY_INVALID";
    throw new AthenaBillingProviderRequestError({
      kind: "serialization",
      message,
      provider: "mollie",
      retry: serializationRetry(),
    });
  }
}

export function projectMollieRefundStatus(status: string): BillingRefundStatus {
  if (
    status === "queued" ||
    status === "pending" ||
    status === "processing" ||
    status === "refunded" ||
    status === "failed" ||
    status === "canceled"
  ) {
    return status;
  }
  throw new AthenaBillingProviderRequestError({
    kind: "serialization",
    message: `Mollie refund status "${status}" is not supported.`,
    provider: "mollie",
    retry: serializationRetry(),
  });
}

export function projectMollieRefund(raw: unknown): BillingRefund {
  if (!isRecord(raw) || typeof raw.id !== "string") {
    throw new AthenaBillingProviderRequestError({
      kind: "serialization",
      message: "Mollie refund response is missing a refund id.",
      provider: "mollie",
      retry: serializationRetry(),
    });
  }
  if (typeof raw.status !== "string") {
    throw new AthenaBillingProviderRequestError({
      kind: "serialization",
      message: "Mollie refund response is missing status.",
      provider: "mollie",
      retry: serializationRetry(),
    });
  }
  const status = projectMollieRefundStatus(raw.status);
  return {
    amount: projectMoney(raw.amount) ?? null,
    description: optionalString(raw.description),
    metadata: raw.metadata,
    provider: "mollie",
    providerPaymentId: optionalString(raw.paymentId),
    providerRefundId: raw.id,
    raw,
    status,
  };
}
