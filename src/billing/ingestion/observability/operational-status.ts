import type { BillingWebhookRegistrationRecord } from "../reconciliation/types.ts";
import type { BillingWebhookKind } from "../types.ts";
import type { BillingWebhookDeliveryHealthRow } from "./delivery-health.ts";
import type { BillingWebhookReconciliationOutcome } from "./stages.ts";

export type BillingWebhookRouteMountState = true | false | "unknown";

export type BillingWebhookOperationalHealth =
  | "healthy"
  | "degraded"
  | "unhealthy";

export interface BillingWebhookOperationalStatus {
  connectionId: string;
  delivery: {
    lastAcceptedAt?: Date;
    lastReceivedAt?: Date;
    lastRejectedAt?: Date;
    lastRejectionCode?: string;
    lastRejectionMessage?: string;
  };
  kind: BillingWebhookKind;
  provider: "mollie";
  reconciliation: {
    lastCompletedAt?: Date;
    lastError?: string;
    lastFailedAt?: Date;
    lastOutcome?: BillingWebhookReconciliationOutcome;
    lastStartedAt?: Date;
  };
  registration: {
    health: BillingWebhookOperationalHealth;
    lastReconciledAt?: Date;
    lastVerifiedAt?: Date;
    providerWebhookId?: string;
    status: "pending" | "active" | "error" | "disabled";
  };
  route: {
    endpoint: string;
    mounted: BillingWebhookRouteMountState;
  };
  verification: {
    previousSigningSecretsConfigured: number;
    signingSecretConfigured: boolean;
    strategy: "authoritative_refetch" | "signature_and_refetch";
  };
}

function registrationFailureCode(
  record: BillingWebhookRegistrationRecord | undefined
): string | undefined {
  if (record == null) {
    return;
  }
  if (
    typeof record.lastRejectionCode === "string" &&
    record.lastRejectionCode.length > 0
  ) {
    return record.lastRejectionCode;
  }
  const error = record.lastError;
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (
    error != null &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
}

export function billingWebhookRegistrationOperationalHealth(
  record: BillingWebhookRegistrationRecord | undefined
): BillingWebhookOperationalHealth {
  if (record == null) {
    return "degraded";
  }
  const failure = registrationFailureCode(record);
  if (
    failure === "ATHENA_BILLING_CREDENTIAL_UNAVAILABLE" ||
    record.lastIngressStage === "failed" ||
    record.status === "error"
  ) {
    return "unhealthy";
  }
  if (record.status === "disabled") {
    return "unhealthy";
  }
  if (
    record.status === "drifted" ||
    record.status === "degraded" ||
    record.lastReconciliationOutcome === "failed"
  ) {
    return "degraded";
  }
  if (record.status === "active") {
    return "healthy";
  }
  return "degraded";
}

function registrationStatus(
  status: BillingWebhookRegistrationRecord["status"] | undefined
): BillingWebhookOperationalStatus["registration"]["status"] {
  if (status === "error") {
    return "error";
  }
  if (status === "disabled") {
    return "disabled";
  }
  if (status === "active") {
    return "active";
  }
  return "pending";
}

export function billingWebhookOperationalStatus(input: {
  connectionId: string;
  delivery?: BillingWebhookDeliveryHealthRow;
  endpoint: string;
  kind: BillingWebhookKind;
  mounted: BillingWebhookRouteMountState;
  previousSigningSecretsConfigured: number;
  registration?: BillingWebhookRegistrationRecord;
  signingSecretConfigured: boolean;
}): BillingWebhookOperationalStatus {
  const delivery = input.delivery;
  return {
    connectionId: input.connectionId,
    delivery: {
      ...(delivery?.lastAcceptedAt
        ? { lastAcceptedAt: delivery.lastAcceptedAt }
        : {}),
      ...(delivery?.lastReceivedAt
        ? { lastReceivedAt: delivery.lastReceivedAt }
        : {}),
      ...(delivery?.lastRejectedAt
        ? { lastRejectedAt: delivery.lastRejectedAt }
        : {}),
      ...(delivery?.lastRejectionCode
        ? { lastRejectionCode: delivery.lastRejectionCode }
        : {}),
      ...(delivery?.lastRejectionMessage
        ? { lastRejectionMessage: delivery.lastRejectionMessage }
        : {}),
    },
    kind: input.kind,
    provider: "mollie",
    reconciliation: {
      ...(delivery?.lastReconciliationCompletedAt
        ? { lastCompletedAt: delivery.lastReconciliationCompletedAt }
        : {}),
      ...(delivery?.lastReconciliationError
        ? { lastError: delivery.lastReconciliationError }
        : {}),
      ...(delivery?.lastReconciliationFailedAt
        ? { lastFailedAt: delivery.lastReconciliationFailedAt }
        : {}),
      ...(delivery?.lastReconciliationOutcome
        ? { lastOutcome: delivery.lastReconciliationOutcome }
        : {}),
      ...(delivery?.lastReconciliationStartedAt
        ? { lastStartedAt: delivery.lastReconciliationStartedAt }
        : {}),
    },
    registration: {
      health: billingWebhookRegistrationOperationalHealth(input.registration),
      status: registrationStatus(input.registration?.status),
      ...(input.registration?.lastReconciledAt
        ? { lastReconciledAt: input.registration.lastReconciledAt }
        : {}),
      ...(input.registration?.lastVerifiedAt
        ? { lastVerifiedAt: input.registration.lastVerifiedAt }
        : {}),
      ...(input.registration?.providerWebhookId
        ? { providerWebhookId: input.registration.providerWebhookId }
        : {}),
    },
    route: {
      endpoint: input.endpoint,
      mounted: input.mounted,
    },
    verification: {
      previousSigningSecretsConfigured: input.previousSigningSecretsConfigured,
      signingSecretConfigured: input.signingSecretConfigured,
      strategy:
        input.kind === "classic"
          ? "authoritative_refetch"
          : "signature_and_refetch",
    },
  };
}
