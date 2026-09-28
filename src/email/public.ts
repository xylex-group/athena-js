/**
 * Browser/edge-safe public email surface.
 * SMTP lives in `@xylex-group/athena/email/node` and must not be imported here.
 */

export {
  assertAthenaEmailProviderRuntime,
  resolveAthenaEmailRuntime,
} from "./capabilities.ts";
export { createEmailDeliveryPort } from "./delivery-port.ts";
export {
  ATHENA_EMAIL_DELIVERY_FAILED,
  ATHENA_EMAIL_MESSAGE_INVALID,
  ATHENA_EMAIL_PROVIDER_INVALID,
  ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
  ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
  ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED,
  ATHENA_EMAIL_TEMPLATE_INVALID,
  ATHENA_EMAIL_TEMPLATE_NOT_FOUND,
  ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE,
  ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING,
  AthenaEmailError,
  isAthenaEmailError,
} from "./errors.ts";
export {
  defineAthenaEmailProvider,
  isAthenaEmailProvider,
} from "./provider.ts";
export type {
  ConsoleEmailProviderOptions,
  HttpEmailProviderOptions,
  ResendEmailProviderOptions,
} from "./providers/index.ts";
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
  AthenaEmailTemplate,
  AthenaEmailTemplateRenderInput,
  AthenaEmailTemplateSelector,
  AthenaEmailTemplateSendInput,
  AthenaEmailTemplateStore,
  AthenaEmailTemplatesConfig,
  AthenaEmailTemplatesModule,
  AthenaEmailTemplateVariableBinding,
  AthenaRenderedEmailTemplate,
  AthenaResolvedEmailMessage,
} from "./types.ts";
