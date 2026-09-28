export {
  authorizationAffordancesFromRights,
  capabilitiesFromRights,
} from "../runtime/authorization/capabilities.ts";
export {
  ATHENA_AUTHORIZATION_SNAPSHOT_INVALID,
  AuthorizationSnapshotInvalidError,
  parseAuthorizationSnapshot,
} from "../runtime/authorization/parse-snapshot.ts";
export type {
  AthenaAuthorizationRightDefinition,
  AthenaAuthorizationRoleDetail,
  AuthorizationCapabilities,
  AuthorizationSnapshot,
  RoleDescriptor,
} from "../runtime/authorization/types.ts";
export type { AthenaAuthorizationAssignmentConflictError } from "./authorization/result.ts";
export {
  AthenaAuthOperationError,
  isAuthorizationAssignmentConflict,
  requireAthenaAuthResult,
} from "./authorization/result.ts";
export type { BetterAuthCompatibilityAdapter } from "./better-auth-adapter.ts";
export { createBetterAuthCompatibilityAdapter } from "./better-auth-adapter.ts";
export type {
  AthenaAuthCapabilitiesFeatures,
  AthenaAuthCapabilitiesResult,
  AthenaAuthCapabilitiesSource,
  AthenaAuthCapabilitiesStatus,
  AthenaAuthCapabilitiesStore,
  AthenaAuthPasskeyCapabilityDetail,
} from "./capabilities.ts";
export {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  createAthenaAuthCapabilitiesStore,
  createEmbeddedCapabilitySnapshot,
  isCapabilityEnabled,
  isPasskeyOnboardingEnabled,
  isSocialCapabilityEnabled,
  resolveSocialProvidersForUi,
} from "./capabilities.ts";
export {
  AUTH_EMAIL_EVENT_CATALOG,
  authEmailEvents,
  flattenAuthEmailEvents,
  renderAuthEmailFragment,
} from "./email/index.ts";
export type {
  AthenaAuthAfterHookPayload,
  AthenaAuthBeforeHookPayload,
  AthenaAuthDomainEvent,
  AthenaAuthHookActor,
  AthenaAuthHookContext,
  AthenaAuthHookErrorInput,
  AthenaAuthHooks,
  AthenaAuthImplementedDomainEvent,
  AthenaAuthReservedDomainEvent,
} from "./hooks/index.ts";
export {
  ATHENA_AUTH_DOMAIN_EVENTS,
  ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS,
  ATHENA_AUTH_RESERVED_DOMAIN_EVENTS,
  defineAthenaAuthHooks,
} from "./hooks/index.ts";
export type { AthenaAuthAdminLimits } from "./limits.ts";
export {
  ATHENA_AUTH_ADMIN_LIMITS,
  ATHENA_AUTH_MAX_ADMIN_JSON_BYTES,
  ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH,
  ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH,
  ATHENA_AUTH_MAX_TEMPLATE_VARIABLES,
} from "./limits.ts";
export {
  createAuthReactEmailInput,
  defineAuthEmailTemplate,
  renderAthenaReactEmail,
} from "./react-email.ts";
export type {
  AthenaAuthBaseURLConfig,
  AthenaAuthContext,
  AthenaAuthCookieRuntimeInput,
  AthenaAuthDatabaseFactory,
  AthenaAuthHandlerResult,
  AthenaAuthPlugin,
  AthenaAuthPluginContext,
  AthenaAuthPluginHandlerContext,
  AthenaAuthRequestContext,
  AthenaAuthServer,
  AthenaAuthServerApi,
  AthenaAuthServerConfig,
  AthenaAuthServerRuntimeOptions,
  AthenaAuthSocialProviderConfig,
  AthenaAuthTrustedOrigins,
  AthenaAuthTrustedProviders,
} from "./server.ts";
export {
  ATHENA_AUTH_BASE_ERROR_CODES,
  athenaAuth,
  defineAthenaAuthConfig,
} from "./server.ts";
export type { AthenaAuthSessionController } from "./session-controller.ts";
export { createAthenaAuthSessionController } from "./session-controller.ts";
export type {
  AthenaSessionData,
  ToSessionDataOptions,
} from "./session-data.ts";
export { toSessionData } from "./session-data.ts";
export type {
  AthenaSessionErrorCode,
  AthenaSessionErrorContext,
  ToAthenaSessionErrorKind,
} from "./session-errors.ts";
export {
  AthenaAuthConfigurationError,
  AthenaAuthProtocolError,
  AthenaAuthUpstreamError,
  AthenaSessionError,
  AthenaSessionOrganizationError,
  AthenaUnauthenticatedError,
  isAbortError,
  toAthenaSessionError,
} from "./session-errors.ts";
export type { SessionInvariantId } from "./session-invariants.ts";
export {
  SESSION_INVARIANTS,
  sessionInvariantMessage,
} from "./session-invariants.ts";
export type {
  AthenaAuthSessionListener,
  AthenaAuthSessionSnapshot,
  AthenaAuthSessionStatus,
  AthenaAuthSessionStore,
  AthenaInitialAuthState,
} from "./session-store.ts";
export { createAthenaAuthSessionStore } from "./session-store.ts";
export type { DerivedSessionView } from "./session-view.ts";
export { deriveSessionView } from "./session-view.ts";
export type {
  AthenaAuthGetTokenInput,
  AthenaAuthTokenProvider,
  AthenaAuthTokenProviderOptions,
} from "./token-provider.ts";
export {
  createAthenaAuthTokenProvider,
  decodeJwtExpSeconds,
  normalizeTokenAudiences,
  tokenNeedsRefresh,
} from "./token-provider.ts";
export type {
  AthenaAdminEmailCreateRequest,
  AthenaAdminEmailDeleteRequest,
  AthenaAdminEmailEventTypeListResponse,
  AthenaAdminEmailEventTypeRecord,
  AthenaAdminEmailFailureCreateRequest,
  AthenaAdminEmailFailureDeleteRequest,
  AthenaAdminEmailFailureGetQuery,
  AthenaAdminEmailFailureGetResponse,
  AthenaAdminEmailFailureListQuery,
  AthenaAdminEmailFailureListResponse,
  AthenaAdminEmailFailureUpdateRequest,
  AthenaAdminEmailFailureUpdateResponse,
  AthenaAdminEmailGetQuery,
  AthenaAdminEmailGetResponse,
  AthenaAdminEmailListQuery,
  AthenaAdminEmailListResponse,
  AthenaAdminEmailTemplateCreateRequest,
  AthenaAdminEmailTemplateDeleteRequest,
  AthenaAdminEmailTemplateGetQuery,
  AthenaAdminEmailTemplateGetResponse,
  AthenaAdminEmailTemplateListQuery,
  AthenaAdminEmailTemplateListResponse,
  AthenaAdminEmailTemplateRecord,
  AthenaAdminEmailTemplateSendRequest,
  AthenaAdminEmailTemplateSendResponse,
  AthenaAdminEmailTemplateUpdateRequest,
  AthenaAdminEmailUpdateRequest,
  AthenaAdminEmailUpdateResponse,
  AthenaAdminListUsersFilterOperator,
  AthenaAdminListUsersQuery,
  AthenaAdminListUsersSearchOperator,
  AthenaApiKeyRecord,
  AthenaAuthAdminUserSessionRevokeBinding,
  AthenaAuthBindings,
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthCloneRoleRequest,
  AthenaAuthCreateRoleRequest,
  AthenaAuthCredentials,
  AthenaAuthDeleteRoleRequest,
  AthenaAuthEmailChangeResponse,
  AthenaAuthEmailTemplateAttachment,
  AthenaAuthEmailTemplateBuilder,
  AthenaAuthEmailTemplateCreateFromDefinitionInput,
  AthenaAuthEmailTemplateDefinition,
  AthenaAuthEmailTemplateReactOverrides,
  AthenaAuthEmailTemplateUpdateFromDefinitionInput,
  AthenaAuthEmailTemplateVariableBinding,
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthFilterOperator,
  AthenaAuthGenericInput,
  AthenaAuthGenericQueryInput,
  AthenaAuthGetRoleRequest,
  AthenaAuthGetTokenRequest,
  AthenaAuthGetUserResponse,
  AthenaAuthGuardFailure,
  AthenaAuthGuardReason,
  AthenaAuthGuardResult,
  AthenaAuthGuardSuccess,
  AthenaAuthHttpHandlers,
  AthenaAuthLinkedAccount,
  AthenaAuthMethod,
  AthenaAuthOrganization,
  AthenaAuthOrganizationBindings,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationMember,
  AthenaAuthQueryPrimitive,
  AthenaAuthQueryValue,
  AthenaAuthReactEmailComponent,
  AthenaAuthReactEmailConfig,
  AthenaAuthReactEmailEventPhase,
  AthenaAuthReactEmailProps,
  AthenaAuthReactEmailRenderEvent,
  AthenaAuthReactEmailRenderInput,
  AthenaAuthReactEmailRenderOptions,
  AthenaAuthReplaceRoleRightsRequest,
  AthenaAuthRequestInput,
  AthenaAuthResetPasswordBinding,
  AthenaAuthResult,
  AthenaAuthRevokeSessionRequest,
  AthenaAuthSearchOperator,
  AthenaAuthServerBindings,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthSessionRevokeBinding,
  AthenaAuthSignInResponse,
  AthenaAuthSignOutResponse,
  AthenaAuthSocialProviderExtensions,
  AthenaAuthSocialRedirectResponse,
  AthenaAuthStatusResponse,
  AthenaAuthToken,
  AthenaAuthUpdateRoleRequest,
  AthenaAuthUser,
  AthenaChangeEmailRequest,
  AthenaChangePasswordRequest,
  AthenaDeleteUserCallbackRequest,
  AthenaDeleteUserRequest,
  AthenaDeleteUserResponse,
  AthenaEmailSignInRequest,
  AthenaEmailSignUpRequest,
  AthenaForgetPasswordRequest,
  AthenaLinkSocialRequest,
  AthenaOAuthAccountTokenRequest,
  AthenaOAuthTokenBundle,
  AthenaPasskeyRecord,
  AthenaResetPasswordRequest,
  AthenaSendVerificationEmailRequest,
  AthenaSocialSignInRequest,
  AthenaUnlinkAccountRequest,
  AthenaUpdateUserRequest,
  AthenaUsernameSignInRequest,
  AthenaVerifyEmailRequest,
  AuthBindings,
  AuthOAuthProvider,
  AuthSocialProvider,
  AuthSocialProviderBuiltin,
} from "./types.ts";
