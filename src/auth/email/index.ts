export { builtinAuthEmailBody, builtinTemplateRow } from "./builtins.ts";
export {
	type AuthEmailApplicationView,
	type AuthEmailTemplateView,
	type AuthEmailUserView,
	assertAuthEmailRequiredVariables,
	type ChangeEmailTemplateData,
	type DeleteUserConfirmationTemplateData,
	flattenAuthEmailTemplateData,
	type OrganizationInvitationTemplateData,
	type OtpTemplateData,
	type PasswordResetTemplateData,
	resolveAuthEmailTemplate,
	type VerifyEmailTemplateData,
} from "./catalog.ts";
export {
	ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
	type AthenaAuthEmailAttachmentFailureMode,
	type AthenaAuthEmailFailureRow,
	type AthenaAuthEmailRecordRow,
	type AthenaAuthEmailTemplateRow,
} from "./contract.ts";
export {
	createTransactionalMailer,
	type EmitAuthEmailContext,
	type EmitAuthEmailInput,
	emitAuthEmail,
	type LegacyAuthEmailSend,
} from "./emit.ts";
export { AthenaAuthEmailError } from "./errors.ts";
export {
	type AthenaAuthEmailEventDefinition,
	AUTH_EMAIL_EVENT_CATALOG,
	type AuthEmailEventNested,
	authEmailEvents,
	flattenAuthEmailEvents,
	getAuthEmailEventDefinition,
} from "./events.ts";
export { createTestEmailDeliveryPort } from "./provider.ts";
export { renderAuthEmailFragment } from "./renderer.ts";
