export {
  ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
  type AthenaAuthEmailAttachmentFailureMode,
  type AthenaAuthEmailDeliveryResult,
  type AthenaAuthEmailFailureRow,
  type AthenaAuthEmailMessage,
  type AthenaAuthEmailProvider,
  type AthenaAuthEmailProviderContext,
  type AthenaAuthEmailRecordRow,
  type AthenaAuthEmailTemplateRow,
  type AthenaAuthResolvedEmailAttachment,
} from "./contract.ts";
export {
  AUTH_EMAIL_EVENT_CATALOG,
  authEmailEvents,
  flattenAuthEmailEvents,
  getAuthEmailEventDefinition,
  type AthenaAuthEmailEventDefinition,
  type AuthEmailEventNested,
} from "./events.ts";
export { renderAuthEmailFragment } from "./renderer.ts";
export { consoleEmailProvider, createTestEmailProvider } from "./provider.ts";
export { AthenaAuthEmailError } from "./errors.ts";
