import { AthenaBillingCapabilityError } from "../../../../errors.ts";
import type { MollieBillingCredentialKind } from "../../../../providers/types.ts";
import type { BillingPayment } from "../../../../types.ts";

export function resolveMollieRequestProfileId(input: {
  configuredProfileId?: string | null;
  credentialKind: MollieBillingCredentialKind;
  requestedProfileId?: string | null;
}): string | undefined {
  if (input.credentialKind === "api_key") {
    return;
  }
  const requested = input.requestedProfileId;
  if (requested != null && requested.length > 0) {
    return requested;
  }
  const configured = input.configuredProfileId;
  if (configured != null && configured.length > 0) {
    return configured;
  }
}

export function mollieCreateHasProfileSelector(input: {
  configuredProfileId?: string | null;
  credentialKind?: string | null;
  requestedProfileId?: string | null;
}): boolean {
  if (input.credentialKind == null || input.credentialKind === "api_key") {
    return true;
  }
  return (
    resolveMollieRequestProfileId({
      configuredProfileId: input.configuredProfileId,
      credentialKind: "advanced_access_token",
      requestedProfileId: input.requestedProfileId,
    }) != null
  );
}

export function requestedMollieProfileId(
  requestedProfileId?: string | null
): string | undefined {
  if (requestedProfileId != null && requestedProfileId.length > 0) {
    return requestedProfileId;
  }
}

export function rejectUnenforcedMollieProfileTarget(input: {
  operation: string;
  requestedProfileId?: string | null;
}): void {
  if (requestedMollieProfileId(input.requestedProfileId) == null) {
    return;
  }
  throw new AthenaBillingCapabilityError({
    operation: input.operation,
    reason: "unsupported_operation",
  });
}

export function assertMolliePaymentMatchesSelectedProfile(input: {
  operation: string;
  payment: BillingPayment;
  selectedProfileId: string | undefined;
}): void {
  if (input.selectedProfileId == null) {
    return;
  }
  if (input.payment.providerProfileId !== input.selectedProfileId) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "missing_provider_scope",
    });
  }
}
