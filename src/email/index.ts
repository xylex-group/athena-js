export {
  ATHENA_EMAIL_DELIVERY_FAILED,
  ATHENA_EMAIL_MESSAGE_INVALID,
  ATHENA_EMAIL_PROVIDER_INVALID,
  ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
  ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
  AthenaEmailError,
  isAthenaEmailError,
} from "./errors.ts";
export {
  assertAthenaEmailProviderRuntime,
  resolveAthenaEmailRuntime,
} from "./capabilities.ts";
export { createEmailDeliveryPort } from "./delivery-port.ts";
export { createEmailModule } from "./module.ts";
export {
  normalizeAthenaEmailConfig,
  toAthenaEmailDiagnostics,
  type NormalizedAthenaEmailConfig,
} from "./normalize-config.ts";
export {
  defineAthenaEmailProvider,
  isAthenaEmailProvider,
} from "./provider.ts";
export {
  resolveAthenaEmailMessage,
  toPublicEmailDeliveryResult,
} from "./runtime.ts";
export {
  consoleEmailProvider,
  httpEmailProvider,
  resend,
} from "./providers/index.ts";
export type {
  AthenaEmailAttachment,
  AthenaEmailAttachmentFailureMode,
  AthenaEmailAttachmentPolicy,
  AthenaEmailConfig,
  AthenaEmailDefaults,
  AthenaEmailDeliveryKind,
  AthenaEmailDeliveryPort,
  AthenaEmailDeliveryResult,
  AthenaEmailDiagnostics,
  AthenaEmailMessage,
  AthenaEmailModule,
  AthenaEmailProvider,
  AthenaEmailProviderCapabilities,
  AthenaEmailProviderRuntime,
  AthenaResolvedEmailMessage,
} from "./types.ts";
