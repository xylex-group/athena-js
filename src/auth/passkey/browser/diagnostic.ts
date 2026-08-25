/**
 * Sanitized WebAuthn ceremony diagnostics. Never include challenges,
 * credential IDs, attestation, or assertion payloads.
 */

export const PASSKEY_DISCOVERABILITY_UNKNOWN_DIAGNOSTIC =
  "registration: discoverability unknown → authentication: allowCredentials=[] → browser returned no assertion";

export type PasskeyCeremonyStage =
  | "idle"
  | "generate-register-options"
  | "credentials-create"
  | "verify-registration"
  | "generate-authenticate-options"
  | "credentials-get"
  | "verify-authentication";

export interface PasskeyDiscoverabilityDiagnosticInput {
  allowCredentialsCount: number;
  assertionPresent: boolean;
  residentKey: boolean | null | undefined;
}

export function formatPasskeyDiscoverabilityDiagnostic(
  input: PasskeyDiscoverabilityDiagnosticInput
): string | null {
  const discoverabilityUnknown =
    input.residentKey !== true && input.residentKey !== false;
  if (
    discoverabilityUnknown &&
    input.allowCredentialsCount === 0 &&
    !input.assertionPresent
  ) {
    return PASSKEY_DISCOVERABILITY_UNKNOWN_DIAGNOSTIC;
  }
  return null;
}
