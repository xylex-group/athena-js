export { inspectPasskeyBrowserCapabilities } from "./capabilities.ts";
export {
  applyPasskeyRegistrationOverrides,
  createPasskeyCredential,
  creationOptionsFromWire,
  getPasskeyCredential,
  isAlreadyPendingWebAuthnError,
  noAssertionDiagnostic,
  type PasskeyCreationOptionsWithHints,
  requestOptionsFromWire,
  resetWebAuthnCeremonyLockForTests,
} from "./ceremony.ts";
export {
  formatPasskeyDiscoverabilityDiagnostic,
  PASSKEY_DISCOVERABILITY_UNKNOWN_DIAGNOSTIC,
  type PasskeyCeremonyStage,
  type PasskeyDiscoverabilityDiagnosticInput,
} from "./diagnostic.ts";
export {
  type PasskeyBrowserOptionsInput,
  type PasskeyBrowserRpIdFallback,
  resolvePasskeyRpId,
  toPublicKeyCredentialCreationOptions,
  toPublicKeyCredentialRequestOptions,
} from "./options.ts";
export {
  type AthenaPasskeyAuthenticationWire,
  type AthenaPasskeyRegistrationWire,
  serializeAssertedPasskey,
  serializeAuthenticationCredential,
  serializeCreatedPasskey,
  serializeRegistrationCredential,
} from "./serialize.ts";
