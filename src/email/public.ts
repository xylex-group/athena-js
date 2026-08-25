/**
 * Browser/edge-safe public email surface.
 * SMTP lives in `@xylex-group/athena/email/node` and must not be imported here.
 */

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
export {
  defineAthenaEmailProvider,
  isAthenaEmailProvider,
} from "./provider.ts";
export {
  consoleEmailProvider,
  httpEmailProvider,
  resend,
} from "./providers/index.ts";
export type {
  ConsoleEmailProviderOptions,
  HttpEmailProviderOptions,
  ResendEmailProviderOptions,
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
