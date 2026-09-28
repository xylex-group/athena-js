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
export type { CreateEmailModuleOptions } from "./module.ts";
export {
  bindAthenaEmailTemplateStore,
  createEmailModule,
} from "./module.ts";
export {
  type NormalizedAthenaEmailConfig,
  normalizeAthenaEmailConfig,
  toAthenaEmailDiagnostics,
} from "./normalize-config.ts";
export {
  defineAthenaEmailProvider,
  isAthenaEmailProvider,
} from "./provider.ts";
export {
  consoleEmailProvider,
  httpEmailProvider,
  resend,
} from "./providers/index.ts";
export {
  resolveAthenaEmailMessage,
  toPublicEmailDeliveryResult,
} from "./runtime.ts";
export { createAthenaEmailTemplates } from "./templates.ts";
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
