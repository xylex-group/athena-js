import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  ATHENA_BILLING_OPERATION_UNAVAILABLE,
  ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
  AthenaBillingAuthorizationError,
  AthenaBillingCapabilityError,
  AthenaBillingError,
  AthenaBillingProviderError,
  AthenaBillingProviderRequestError,
  type BillingProviderErrorKind,
  type BillingRetryDisposition,
} from "../errors.ts";
import { AthenaBillingSubjectError } from "../subject/errors.ts";

export interface AthenaTransportErrorEnvelope {
  code?: string;
  errorNumber?: number;
  kind?: string;
  message?: string;
  missing?: readonly unknown[];
  operation?: string;
  provider?: string;
  reason?: string;
  retry?: string;
  status?: number;
}

const PROVIDER_KINDS = new Set<BillingProviderErrorKind>([
  "authentication",
  "authorization",
  "invalid_request",
  "not_found",
  "conflict",
  "idempotency_conflict",
  "rate_limited",
  "provider_unavailable",
  "network",
  "timeout",
  "signature_invalid",
  "unsupported_operation",
  "unsupported_currency",
  "unsupported_payment_method",
  "customer_action_required",
  "payment_declined",
  "resource_state_conflict",
  "serialization",
  "unknown",
]);

export function billingErrorFromTransport(
  envelope: AthenaTransportErrorEnvelope | Record<string, unknown>
): Error {
  const record = envelope as AthenaTransportErrorEnvelope;
  const code = typeof record.code === "string" ? record.code : undefined;
  const message =
    typeof record.message === "string" && record.message
      ? record.message
      : "billing request failed";
  const operation =
    typeof record.operation === "string" && record.operation
      ? record.operation
      : "billing";
  const status = typeof record.status === "number" ? record.status : undefined;
  const kind = asProviderKind(record.kind);

  if (
    code === "ATHENA_BILLING_NOT_FOUND" ||
    code === "ATHENA_BILLING_SUBJECT_CONFLICT"
  ) {
    return new AthenaBillingSubjectError({
      code,
      conflict:
        typeof (record as { conflict?: unknown }).conflict === "string"
          ? String((record as { conflict: string }).conflict)
          : undefined,
      message,
      status: status ?? (code === "ATHENA_BILLING_NOT_FOUND" ? 404 : 409),
    });
  }

  if (code === ATHENA_BILLING_AUTHORIZATION_DENIED) {
    const missing = Array.isArray(record.missing)
      ? record.missing.map((entry) => String(entry))
      : [];
    return new AthenaBillingAuthorizationError({
      missing,
      operation,
    });
  }

  if (code === ATHENA_BILLING_OPERATION_UNAVAILABLE) {
    return new AthenaBillingCapabilityError({
      message,
      operation,
      reason:
        typeof record.reason === "string" && record.reason
          ? record.reason
          : "unsupported_operation",
    });
  }

  if (code === ATHENA_BILLING_PROVIDER_NOT_CONFIGURED) {
    return new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
      message,
    });
  }

  if (
    code === "ATHENA_BILLING_WEBHOOK_SIGNATURE_INVALID" ||
    kind === "signature_invalid"
  ) {
    return new AthenaBillingProviderRequestError({
      kind: "signature_invalid",
      message,
      provider:
        typeof record.provider === "string" ? record.provider : "mollie",
      retry: asRetry(record.retry) ?? "never",
      status: status ?? 400,
    });
  }

  if (code === "ATHENA_BILLING_PROVIDER_REQUEST" || kind) {
    return new AthenaBillingProviderRequestError({
      kind: kind ?? "unknown",
      message,
      provider:
        typeof record.provider === "string" ? record.provider : "mollie",
      retry: asRetry(record.retry) ?? "never",
      status: status ?? defaultProviderRequestStatus(kind ?? "unknown"),
    });
  }

  if (
    code === "ATHENA_BILLING_INVALID_REQUEST" ||
    (code && /ATHENA_BILLING_MONEY_|ATHENA_BILLING_IDEMPOTENCY/.test(code))
  ) {
    const error = new AthenaBillingError({
      body: record,
      endpoint: "",
      message,
      method: "POST",
      status: status ?? 400,
    });
    Object.assign(error, { code, errorNumber: record.errorNumber });
    return error;
  }

  if (!code && status === undefined) {
    return new Error(message);
  }

  const error = new AthenaBillingError({
    body: record,
    endpoint: "",
    message,
    method: "POST",
    status: status ?? 500,
  });
  Object.assign(error, { code, errorNumber: record.errorNumber });
  return error;
}

function defaultProviderRequestStatus(kind: BillingProviderErrorKind): number {
  switch (kind) {
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "provider_unavailable":
    case "network":
    case "timeout":
      return 503;
    case "unknown":
      return 500;
    default:
      return 400;
  }
}

function asProviderKind(value: unknown): BillingProviderErrorKind | undefined {
  if (typeof value !== "string") {
    return;
  }
  return PROVIDER_KINDS.has(value as BillingProviderErrorKind)
    ? (value as BillingProviderErrorKind)
    : undefined;
}

function asRetry(value: unknown): BillingRetryDisposition | undefined {
  if (
    value === "never" ||
    value === "safe" ||
    value === "reconcile_first" ||
    value === "customer_action_required"
  ) {
    return value;
  }
}
