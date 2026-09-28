import { canonicalizeBillingPaymentStatus } from "../../../../canonical/status.ts";
import { AthenaBillingProviderRequestError } from "../../../../errors.ts";
import { normalizeBillingMoney } from "../../../../safety/money.ts";
import { billingRetryDisposition } from "../../../../safety/retry.ts";
import type {
  BillingMoney,
  BillingPayment,
  BillingPaymentStatus,
} from "../../../../types.ts";

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
    operation: "payments.get",
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

function unknownStatusError(status: string): AthenaBillingProviderRequestError {
  return new AthenaBillingProviderRequestError({
    kind: "serialization",
    message: `Mollie payment status "${status}" is not supported.`,
    provider: "mollie",
    retry: serializationRetry(),
  });
}

export function projectMolliePaymentStatus(
  status: string
): BillingPaymentStatus {
  if (status === "open" || status === "pending") {
    return "pending";
  }
  if (status === "authorized") {
    return "authorized";
  }
  if (status === "paid") {
    return "paid";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  if (status === "expired") {
    return "failed";
  }
  throw unknownStatusError(status);
}

export function projectMolliePayment(raw: unknown): BillingPayment {
  if (!isRecord(raw) || typeof raw.id !== "string") {
    throw new AthenaBillingProviderRequestError({
      kind: "serialization",
      message: "Mollie payment response is missing a payment id.",
      provider: "mollie",
      retry: serializationRetry(),
    });
  }
  const amount = projectMoney(raw.amount);
  if (amount == null) {
    throw new AthenaBillingProviderRequestError({
      kind: "serialization",
      message: "Mollie payment response is missing amount.",
      provider: "mollie",
      retry: serializationRetry(),
    });
  }
  const providerStatus = typeof raw.status === "string" ? raw.status : "";
  const status =
    providerStatus.length > 0
      ? projectMolliePaymentStatus(providerStatus)
      : projectMolliePaymentStatus("");
  return {
    amount,
    amountRefunded: projectMoney(raw.amountRefunded) ?? null,
    canonicalStatus: canonicalizeBillingPaymentStatus({
      providerStatus: providerStatus || status,
    }),
    createdAt: optionalString(raw.createdAt),
    description: optionalString(raw.description),
    id: raw.id,
    metadata: raw.metadata,
    paidAt: optionalString(raw.paidAt),
    provider: "mollie",
    providerCustomerId: optionalString(raw.customerId),
    providerPaymentId: raw.id,
    providerPaymentLinkId: optionalString(raw.paymentLinkId),
    providerProfileId: optionalString(raw.profileId),
    providerStatus: providerStatus || status,
    providerSubscriptionId: optionalString(raw.subscriptionId),
    raw,
    status,
  };
}
