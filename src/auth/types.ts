import type {
  AthenaAuthCapabilitiesFeatures,
  AthenaAuthCapabilitiesResult,
  AthenaAuthCapabilitiesSource,
  AthenaAuthCapabilitiesStatus,
} from "./capabilities.ts";
import type { AthenaAuthSessionSnapshot } from "./session-store.ts";

export type AthenaAuthMethod = "GET" | "POST";
export type AthenaAuthCredentials = "omit" | "same-origin" | "include";
export type AthenaAuthQueryPrimitive = string | number | boolean;
export type AthenaAuthQueryValue =
  | AthenaAuthQueryPrimitive
  | AthenaAuthQueryPrimitive[]
  | null
  | undefined;

export type AthenaAuthEndpointPath =
  | "/sign-in/social"
  | "/sign-in/email"
  | "/sign-in/username"
  | "/sign-up/email"
  | "/get-session"
  | "/sign-out"
  | "/forget-password"
  | "/reset-password"
  | "/verify-email"
  | "/send-verification-email"
  | "/change-email"
  | "/change-email/verify"
  | "/change-password"
  | "/set-password"
  | "/update-user"
  | "/delete-user"
  | "/delete-user/verify"
  | "/delete-user/callback"
  | "/email-list"
  | "/email/list"
  | "/list-sessions"
  | "/revoke-session"
  | "/revoke-sessions"
  | "/revoke-other-sessions"
  | "/link-social"
  | "/list-accounts"
  | "/unlink-account"
  | "/refresh-token"
  | "/get-access-token"
  | "/token"
  | "/.well-known/jwks.json"
  | "/.well-known/openid-configuration"
  | "/two-factor/get-totp-uri"
  | "/two-factor/verify-totp"
  | "/two-factor/send-otp"
  | "/two-factor/verify-otp"
  | "/two-factor/verify-backup-code"
  | "/two-factor/generate-backup-codes"
  | "/two-factor/enable"
  | "/two-factor/disable"
  | "/passkey/generate-register-options"
  | "/passkey/generate-authenticate-options"
  | "/passkey/verify-registration"
  | "/passkey/verify-authentication"
  | "/passkey/list-user-passkeys"
  | "/passkey/delete-passkey"
  | "/passkey/update-passkey"
  | "/.well-known/webauthn"
  | "/admin/set-role"
  | "/admin/get-user"
  | "/admin/update-user"
  | "/admin/list-users"
  | "/admin/list-user-sessions"
  | "/admin/create-user"
  | "/admin/unban-user"
  | "/admin/ban-user"
  | "/admin/impersonate-user"
  | "/admin/stop-impersonating"
  | "/admin/revoke-user-session"
  | "/admin/revoke-user-sessions"
  | "/admin/remove-user"
  | "/admin/set-user-password"
  | "/admin/has-permission"
  | "/admin/api-key/create"
  | "/admin/athena-client/create"
  | "/admin/athena-client/list"
  | "/admin/audit-log/list"
  | "/admin/email/get"
  | "/admin/email/create"
  | "/admin/email/update"
  | "/admin/email/delete"
  | "/admin/email-failure/list"
  | "/admin/email-failure/get"
  | "/admin/email-failure/create"
  | "/admin/email-failure/update"
  | "/admin/email-failure/delete"
  | "/admin/email-template/get"
  | "/admin/email-template/create"
  | "/admin/email-template/delete"
  | "/admin/email-template/list"
  | "/admin/email-template/update"
  | "/admin/email-template/send"
  | "/admin/email-event-type/list"
  | "/admin/email/list"
  | "/api-key/create"
  | "/api-key/get"
  | "/api-key/update"
  | "/api-key/delete"
  | "/api-key/list"
  | "/api-key/verify"
  | "/api-key/delete-all-expired-api-keys"
  | "/organization/create"
  | "/organization/check-slug"
  | "/organization/list"
  | "/organization/set-active"
  | "/organization/get-full-organization"
  | "/organization/update"
  | "/organization/delete"
  | "/organization/invite-member"
  | "/organization/accept-invitation"
  | "/organization/cancel-invitation"
  | "/organization/reject-invitation"
  | "/organization/get-invitation"
  | "/organization/list-invitations"
  | "/organization/list-user-invitations"
  | "/organization/list-members"
  | "/organization/remove-member"
  | "/organization/update-member-role"
  | "/organization/get-active-member"
  | "/organization/leave"
  | "/organization/has-permission"
  | `/callback/${string}`
  | "/health"
  | "/ok"
  | "/error"
  | `/reset-password/${string}`;

export interface AthenaAuthToken {
  audience: string[];
  expiresAt: string;
  expiresIn: number;
  issuer: string;
  kid?: string;
  token: string;
  tokenType: "Bearer";
}

export interface AthenaAuthGetTokenRequest {
  audience?: string | string[];
  expiresIn?: number;
}

export interface AthenaAuthJwks {
  keys: Array<Record<string, string>>;
}

export interface AthenaAuthIssuerMetadata {
  authorization_endpoint?: string;
  id_token_signing_alg_values_supported: string[];
  issuer: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  token_endpoint: string;
}

export type AthenaAuthErrorCode =
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "UPSTREAM_UNAVAILABLE"
  | "ATHENA_AUTH_CAPABILITY_DISABLED"
  | "UNKNOWN_ERROR";

export interface AthenaAuthErrorDetails {
  cause?: string;
  code: AthenaAuthErrorCode;
  endpoint?: AthenaAuthEndpointPath;
  hint?: string;
  message: string;
  method?: AthenaAuthMethod;
  requestId?: string;
  status: number;
}

export interface AthenaAuthResult<T = unknown> {
  data: T | null;
  error: string | null;
  errorDetails?: AthenaAuthErrorDetails | null;
  ok: boolean;
  raw: unknown;
  status: number;
}

export interface AthenaAuthUser {
  banExpires?: string | null;
  banned?: boolean;
  banReason?: string | null;
  createdAt?: string;
  displayUsername?: string | null;
  email: string;
  emailVerified?: boolean;
  id: string;
  image?: string | null;
  name?: string | null;
  role?: string | null;
  twoFactorEnabled?: boolean;
  updatedAt?: string;
  username?: string | null;
}

export interface AthenaAuthSession {
  activeOrganizationId?: string | null;
  createdAt?: string;
  expiresAt?: string;
  id: string;
  impersonatedBy?: string | null;
  ipAddress?: string | null;
  token?: string;
  updatedAt?: string;
  userAgent?: string | null;
  userId?: string;
}

export interface AthenaAuthSessionResponse {
  session: AthenaAuthSession;
  user: AthenaAuthUser;
}

export interface AthenaAuthGetUserResponse {
  user: AthenaAuthUser | null;
}

export interface AthenaAuthOrganization {
  createdAt?: string;
  id: string;
  logo?: string | null;
  metadata?: Record<string, unknown> | null;
  name: string;
  slug: string;
  updatedAt?: string;
}

export interface AthenaAuthOrganizationMember {
  createdAt?: string;
  id: string;
  organizationId?: string;
  role?: string | string[] | null;
  updatedAt?: string;
  user?: AthenaAuthUser;
  userId?: string;
}

export interface AthenaAuthOrganizationInvitation {
  createdAt?: string;
  email?: string;
  expiresAt?: string;
  id: string;
  inviterId?: string;
  organizationId?: string;
  role?: string | string[] | null;
  status?: string;
  teamId?: string | null;
  updatedAt?: string;
}

export interface AthenaAuthOrganizationRole {
  createdAt?: string;
  id?: string;
  organizationId?: string;
  permission?: Record<string, string[]>;
  role?: string;
  roleName?: string;
  updatedAt?: string;
}

export interface AthenaAuthOrganizationTeam {
  createdAt?: string;
  id: string;
  name: string;
  organizationId?: string;
  updatedAt?: string;
}

export interface AthenaEmailSignInRequest {
  callbackURL?: string;
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AthenaUsernameSignInRequest {
  password: string;
  rememberMe?: boolean;
  username: string;
}

/**
 * Declaration-merge hook for app-defined social providers on the auth API.
 *
 * @example
 * ```ts
 * declare module '@xylex-group/athena' {
 *   interface AthenaAuthSocialProviderExtensions {
 *     figma: true
 *   }
 * }
 * ```
 */
// Declaration-merging hook for app-defined providers (empty base interface).
// biome-ignore lint/suspicious/noEmptyInterface: empty declaration-merge surface for module augmentation
export interface AthenaAuthSocialProviderExtensions {} // eslint-disable-line @typescript-eslint/no-empty-object-type -- empty declaration-merge surface

/**
 * Built-in provider ids accepted by Athena Auth social / SSO routes.
 *
 * Wider OAuth factory registry ids live as {@link SocialProvider} under
 * `@xylex-group/athena/social-providers` — do not confuse the two.
 */
export type AuthSocialProviderBuiltin =
  | "google"
  | "apple"
  | "microsoft"
  | "github"
  | "discord"
  | "athena"
  | "saml";

/**
 * Social / identity provider id for auth API calls (`signIn.social`, link, etc.).
 *
 * Defaults to {@link AuthSocialProviderBuiltin}; extend via
 * {@link AthenaAuthSocialProviderExtensions}.
 *
 * @example
 * ```ts
 * import type { AuthSocialProvider } from '@xylex-group/athena'
 * // or from '@xylex-group/athena/social-providers'
 *
 * const provider: AuthSocialProvider = 'google'
 * ```
 */
export type AuthSocialProvider =
  | AuthSocialProviderBuiltin
  | Extract<keyof AthenaAuthSocialProviderExtensions, string>;

/**
 * OAuth-only provider id (excludes SAML SSO).
 * Use for pure OAuth link/token flows where SAML is not valid.
 */
export type AuthOAuthProvider = Exclude<AuthSocialProvider, "saml">;

export interface AthenaSocialSignInRequest {
  callbackURL?: string;
  disableRedirect?: boolean;
  errorCallbackURL?: string;
  idToken?: string;
  loginHint?: string;
  newUserCallbackURL?: string;
  provider: AuthSocialProvider;
  requestSignUp?: boolean;
  scopes?: string[] | string;
}

export interface AthenaEmailSignUpRequest {
  callbackURL?: string;
  email: string;
  name: string;
  password: string;
}

export interface AthenaAuthSignInResponse {
  redirect: false;
  token: string;
  url?: string | null;
  user: AthenaAuthUser;
}

export interface AthenaAuthSocialRedirectResponse {
  redirect: boolean;
  url: string;
}

export interface AthenaAuthSignOutResponse {
  success: boolean;
}

export interface AthenaAuthStatusResponse {
  status: boolean;
}

export interface AthenaAuthRevokeSessionRequest {
  token: string;
}

export interface AthenaForgetPasswordRequest {
  email: string;
  redirectTo?: string;
}

export interface AthenaResetPasswordRequest {
  newPassword: string;
  token?: string;
}

export interface AthenaVerifyEmailRequest {
  callbackURL?: string;
  token: string;
}

export interface AthenaSendVerificationEmailRequest {
  callbackURL?: string;
  email: string;
}

export interface AthenaChangeEmailRequest {
  callbackURL?: string;
  newEmail: string;
}

export interface AthenaChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}

export interface AthenaUpdateUserRequest {
  image?: string;
  name?: string;
}

export interface AthenaDeleteUserRequest {
  callbackURL?: string;
  password?: string;
  token?: string;
}

export interface AthenaDeleteUserCallbackRequest {
  callbackURL?: string;
  token?: string;
}

export interface AthenaDeleteUserResponse {
  message?: string;
  success: boolean;
}

export interface AthenaAuthEmailChangeResponse {
  message?: string | null;
  status: boolean;
}

export interface AthenaLinkSocialRequest {
  callbackURL?: string;
  provider: AuthOAuthProvider;
  scopes?: string[] | string;
}

export interface AthenaUnlinkAccountRequest {
  accountId?: string;
  providerId: string;
}

export interface AthenaOAuthAccountTokenRequest {
  accountId?: string;
  providerId: string;
  userId?: string;
}

export interface AthenaOAuthTokenBundle {
  accessToken?: string;
  accessTokenExpiresAt?: string;
  idToken?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  tokenType?: string;
}

export interface AthenaAuthLinkedAccount {
  accountId?: string;
  createdAt?: string;
  id: string;
  provider?: string;
  scopes?: string[];
  updatedAt?: string;
}

export type AthenaAuthPermissionSet = Record<string, unknown> | string[];
export type AthenaAuthLooseRecord = Record<string, unknown>;
export type AthenaAuthReactEmailProps = Record<string, unknown>;

export interface AthenaSetPasswordRequest {
  newPassword: string;
}

export interface AthenaAuthTokenQuery {
  token: string;
}

export interface AthenaAuthTokenVerificationResponse {
  message: string;
  status: boolean;
}

export interface AthenaAuthEmailListQuery {
  limit?: number;
  offset?: number;
}

export interface AthenaAuthEmailListResponse {
  emails: AthenaAuthLooseRecord[];
  limit: number;
  offset: number;
  total: number;
}

export interface AthenaAuthHealthResponse {
  service?: string;
  status?: string;
  version?: string;
}

export interface AthenaAuthOkResponse {
  ok: boolean;
}

export interface AthenaAuthErrorResponse {
  message: string;
}

export interface AthenaAuthCallbackProviderRequest {
  code: string;
  provider: string;
  state: string;
}

export interface AthenaAuthCallbackProviderResponse {
  token?: string;
  user?: AthenaAuthLooseRecord;
}

export interface AthenaTwoFactorGetTotpUriRequest {
  password: string;
}

export interface AthenaTwoFactorGetTotpUriResponse {
  totpURI?: string;
}

export interface AthenaTwoFactorVerifyTotpRequest {
  code: string;
  trustDevice?: string;
}

export interface AthenaTwoFactorVerifyTotpResponse {
  status?: boolean;
}

export interface AthenaTwoFactorVerifyOtpRequest {
  code: string;
  trustDevice?: string;
}

export interface AthenaTwoFactorVerifyOtpResponse {
  token: string;
  user: AthenaAuthUser;
}

export interface AthenaTwoFactorVerifyBackupCodeRequest {
  code: string;
  disableSession?: string;
  trustDevice?: string;
}

export interface AthenaTwoFactorSessionSnapshot {
  createdAt: string;
  expiresAt: string;
  token: string;
  userId: string;
}

export interface AthenaTwoFactorVerifyBackupCodeResponse {
  session: AthenaTwoFactorSessionSnapshot;
  user: AthenaAuthUser;
}

export interface AthenaTwoFactorGenerateBackupCodesRequest {
  password: string;
}

export interface AthenaTwoFactorGenerateBackupCodesResponse {
  backupCodes: string[];
  status: true;
}

export interface AthenaTwoFactorEnableRequest {
  issuer?: string;
  password: string;
}

export interface AthenaTwoFactorEnableResponse {
  backupCodes?: string[];
  totpURI?: string;
}

export interface AthenaTwoFactorDisableRequest {
  password: string;
}

export interface AthenaTwoFactorDisableResponse {
  status?: boolean;
}

export interface AthenaPasskeyCredentialDescriptor {
  id?: string;
  transports?: string[];
  type?: string;
}

export interface AthenaPasskeyPublicKeyCredentialParam {
  alg?: number;
  type?: string;
}

export interface AthenaPasskeyUserDescriptor {
  displayName?: string;
  id?: string;
  name?: string;
}

export interface AthenaPasskeyRelyingParty {
  id?: string;
  name?: string;
}

export interface AthenaPasskeyAuthenticatorSelection {
  authenticatorAttachment?: string;
  requireResidentKey?: boolean;
  userVerification?: string;
}

export interface AthenaPasskeyOptionsResponse {
  allowCredentials?: AthenaPasskeyCredentialDescriptor[];
  attestation?: string;
  authenticatorSelection?: AthenaPasskeyAuthenticatorSelection;
  challenge?: string;
  excludeCredentials?: AthenaPasskeyCredentialDescriptor[];
  extensions?: AthenaAuthLooseRecord;
  pubKeyCredParams?: AthenaPasskeyPublicKeyCredentialParam[];
  rp?: AthenaPasskeyRelyingParty;
  timeout?: number;
  user?: AthenaPasskeyUserDescriptor;
  userVerification?: string;
}

export interface AthenaPasskeyRecord {
  backedUp?: boolean;
  counter?: number;
  createdAt?: string;
  credentialID?: string;
  deviceType?: string;
  id: string;
  name?: string | null;
  publicKey?: string;
  transports?: string;
  userId: string;
}

export interface AthenaPasskeyVerifyRegistrationRequest {
  name?: string;
  response: string;
}

export interface AthenaPasskeyVerifyAuthenticationRequest {
  response: string;
}

export interface AthenaPasskeyVerifyAuthenticationResponse {
  session: AthenaAuthSession;
  user: AthenaAuthUser;
}

export interface AthenaPasskeyDeleteRequest {
  id: string;
}

export interface AthenaPasskeyDeleteResponse {
  status: boolean;
}

export interface AthenaPasskeyUpdateRequest {
  id: string;
  name: string;
}

export interface AthenaPasskeyUpdateResponse {
  passkey: AthenaPasskeyRecord;
}

export interface AthenaAdminSetRoleRequest {
  role: string;
  userId: string;
}

export interface AthenaAdminCreateUserRequest {
  data?: string;
  email: string;
  name: string;
  password: string;
  role?: string;
}

export interface AthenaAdminTargetUserRequest {
  userId: string;
}

export interface AthenaAdminBanUserRequest
  extends AthenaAdminTargetUserRequest {
  banExpiresIn?: string;
  banReason?: string;
}

export type AthenaAuthSearchOperator = "contains" | "starts_with" | "ends_with";

export type AthenaAuthFilterOperator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "not_in"
  | "contains"
  | "starts_with"
  | "ends_with";

export type AthenaAdminListUsersSearchOperator = AthenaAuthSearchOperator;
export type AthenaAdminListUsersFilterOperator = AthenaAuthFilterOperator;

export interface AthenaAdminListUsersQuery {
  filterField?: string;
  filterOperator?: AthenaAdminListUsersFilterOperator;
  filterValue?: string;
  limit?: number | string;
  offset?: number | string;
  searchField?: string;
  searchOperator?: AthenaAdminListUsersSearchOperator;
  searchValue?: string;
  sortBy?: string;
  sortDirection?: string;
}

export interface AthenaAdminListUsersResponse {
  limit?: number;
  offset?: number;
  total: number;
  users: AthenaAuthUser[];
}

export interface AthenaAdminListUserSessionsRequest {
  userId: string;
}

export interface AthenaAdminListUserSessionsResponse {
  sessions: AthenaAuthSession[];
}

export interface AthenaAdminImpersonateResponse {
  session: AthenaAuthSession;
  user: AthenaAuthUser;
}

export interface AthenaAdminStopImpersonatingRequest {
  userId?: string;
}

export interface AthenaAdminRevokeUserSessionRequest {
  sessionId?: string;
  sessionToken: string;
  userId: string;
}

export interface AthenaAdminRevokeUserSessionsRequest {
  userId: string;
}

export interface AthenaAdminSetUserPasswordRequest {
  newPassword: string;
  userId: string;
}

export interface AthenaAdminUserResponse {
  user: AthenaAuthUser;
}

export interface AthenaAdminSuccessResponse {
  success: boolean;
}

export interface AthenaAdminHasPermissionRequest {
  permission?: AthenaAuthPermissionSet;
  permissions: AthenaAuthPermissionSet;
}

export interface AthenaAdminHasPermissionResponse {
  error?: string;
  success: boolean;
}

export interface AthenaAdminApiKeyCreateRequest {
  athenaClientName?: string;
  expiresIn?: number;
  metadata?: AthenaAuthLooseRecord;
  name?: string;
  permissions?: AthenaAuthLooseRecord;
}

export interface AthenaAdminApiKeyCreateResponse {
  apiKey?: AthenaAuthLooseRecord;
  key?: string;
}

export interface AthenaAdminAthenaClientCreateRequest {
  clientName: string;
  description?: string;
  isActive?: boolean;
  metadata?: AthenaAuthLooseRecord;
  pgUriEnvVar?: string;
}

export interface AthenaAdminAthenaClientListResponse {
  athenaClients?: AthenaAuthLooseRecord[];
}

export interface AthenaAdminAuditLogListQuery {
  action?: string;
  actorUserId?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
  success?: boolean;
  targetId?: string;
  targetType?: string;
}

export interface AthenaAdminAuditLogListResponse {
  auditLogs?: AthenaAuthLooseRecord[];
  limit?: number;
  offset?: number;
  total?: number;
}

export interface AthenaAdminEmailListQuery {
  createdAfter?: string;
  createdBefore?: string;
  flow?: string;
  limit?: number;
  offset?: number;
  provider?: string;
  recipientEmail?: string;
  subjectContains?: string;
}

export interface AthenaAdminEmailListResponse {
  emails?: AthenaAuthLooseRecord[];
  limit?: number;
  offset?: number;
  total?: number;
}

export interface AthenaAdminEmailGetQuery {
  id: string;
}

export interface AthenaAdminEmailGetResponse {
  email?: AthenaAuthLooseRecord;
}

export interface AthenaAuthReactEmailRenderInput {
  /**
   * React email component function. Use with `props` when you prefer component + props inputs.
   */
  component?: AthenaAuthReactEmailComponent;
  /**
   * React email element instance (for example: `<WelcomeEmail {...props} />`).
   */
  element?: unknown;
  /**
   * Disable derived plain-text generation. Defaults to `true`.
   */
  includePlainText?: boolean;
  /**
   * When true, run `pretty(...)` on rendered HTML when available.
   */
  pretty?: boolean;
  /**
   * Props passed to `component` when `element` is omitted.
   */
  props?: AthenaAuthReactEmailProps;
  /**
   * Override plain-text output. If omitted, text is auto-derived when possible.
   */
  text?: string;
}

export type AthenaAuthReactEmailComponent<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> = (props: TProps) => unknown;

export interface AthenaAuthReactEmailRenderOptions {
  includePlainText?: boolean;
  pretty?: boolean;
}

export type AthenaAuthReactEmailEventPhase =
  | "render:start"
  | "render:success"
  | "render:error";

export interface AthenaAuthReactEmailRenderEvent {
  durationMs?: number;
  error?: string;
  message?: string;
  phase: AthenaAuthReactEmailEventPhase;
  route?: string;
  timestamp: string;
}

export interface AthenaAuthReactEmailConfig {
  /**
   * Optional default render settings used when request payloads omit `pretty` or `includePlainText`.
   */
  defaults?: AthenaAuthReactEmailRenderOptions;
  /**
   * Optional observer for render lifecycle events.
   */
  observe?: (event: AthenaAuthReactEmailRenderEvent) => void;
}

export interface AthenaAdminEmailCreateRequest {
  flow?: string;
  fromAddress: string;
  fromName?: string;
  htmlBody?: string;
  metadata?: AthenaAuthLooseRecord;
  provider: string;
  /**
   * Optional React Email render input. When provided, `htmlBody` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput;
  recipientEmail: string;
  subject: string;
  textBody?: string;
}

export interface AthenaAdminEmailUpdateRequest {
  flow?: string | null;
  fromAddress?: string;
  fromName?: string | null;
  htmlBody?: string | null;
  id: string;
  metadata?: AthenaAuthLooseRecord;
  provider?: string;
  /**
   * Optional React Email render input. When provided, `htmlBody` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput;
  recipientEmail?: string;
  subject?: string;
  textBody?: string | null;
}

export interface AthenaAdminEmailUpdateResponse {
  email?: AthenaAuthLooseRecord;
}

export interface AthenaAdminEmailDeleteRequest {
  id: string;
}

export interface AthenaAdminEmailFailureListQuery {
  createdAfter?: string;
  createdBefore?: string;
  flow?: string;
  limit?: number;
  offset?: number;
  provider?: string;
  recipientEmail?: string;
  resolved?: boolean;
}

export interface AthenaAdminEmailFailureListResponse {
  emailSendFailures?: AthenaAuthLooseRecord[];
  limit?: number;
  offset?: number;
  total?: number;
}

export interface AthenaAdminEmailFailureGetQuery {
  id: string;
}

export interface AthenaAdminEmailFailureGetResponse {
  emailSendFailure?: AthenaAuthLooseRecord;
}

export interface AthenaAdminEmailFailureCreateRequest {
  errorMessage: string;
  flow: string;
  metadata?: AthenaAuthLooseRecord;
  provider?: string;
  recipientEmail: string;
  userId?: string;
}

export interface AthenaAdminEmailFailureUpdateRequest {
  id: string;
  metadata?: AthenaAuthLooseRecord;
  resolutionNote?: string | null;
  resolved?: boolean;
}

export interface AthenaAdminEmailFailureUpdateResponse {
  emailSendFailure?: AthenaAuthLooseRecord;
}

export interface AthenaAdminEmailFailureDeleteRequest {
  id: string;
}

export interface AthenaAdminEmailTemplateListQuery {
  event_type?: string;
  is_active?: boolean;
  limit?: number;
  locale?: string;
  offset?: number;
  template_key?: string;
}

export interface AthenaAuthEmailTemplateVariableBinding {
  name: string;
  required?: boolean;
  source: string;
}

export interface AthenaAuthEmailTemplateAttachment {
  file_url: string;
  filename?: string;
}

export interface AthenaAdminEmailTemplateRecord {
  attachment_failure_mode?: "fail" | "skip" | null;
  attachments?: AthenaAuthEmailTemplateAttachment[];
  created_at?: string;
  event_type?: string | null;
  html_template?: string | null;
  id?: string;
  is_active?: boolean;
  metadata?: AthenaAuthLooseRecord;
  subject_template?: string | null;
  template_key: string;
  text_template?: string | null;
  updated_at?: string;
  variable_bindings?: AthenaAuthEmailTemplateVariableBinding[];
  variables?: string[];
}

export interface AthenaAdminEmailTemplateListResponse {
  email_templates?: AthenaAdminEmailTemplateRecord[];
  limit?: number;
  offset?: number;
  total?: number;
}

export interface AthenaAdminEmailTemplateCreateRequest {
  attachment_failure_mode?: "fail" | "skip";
  attachments?:
    | string
    | AthenaAuthEmailTemplateAttachment
    | AthenaAuthEmailTemplateAttachment[];
  event_type?: string;
  html_template?: string;
  is_active?: boolean;
  locale?: string;
  metadata?: AthenaAuthLooseRecord;
  /**
   * Optional React Email render input. When provided, `html_template` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput;
  subject_template?: string;
  template_key: string;
  text_template?: string;
  variable_bindings?: AthenaAuthEmailTemplateVariableBinding[];
  variables?: string[];
}

export interface AthenaAdminEmailTemplateUpdateRequest {
  attachment_failure_mode?: "fail" | "skip";
  attachments?:
    | string
    | AthenaAuthEmailTemplateAttachment
    | AthenaAuthEmailTemplateAttachment[];
  event_type?: string;
  html_template?: string | null;
  id: string;
  is_active?: boolean;
  locale?: string;
  metadata?: AthenaAuthLooseRecord;
  /**
   * Optional React Email render input. When provided, `html_template` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput;
  subject_template?: string;
  template_key?: string;
  text_template?: string | null;
  variable_bindings?: AthenaAuthEmailTemplateVariableBinding[];
  variables?: string[];
}

export interface AthenaAdminEmailTemplateDeleteRequest {
  id: string;
}

export interface AthenaAdminEmailTemplateGetQuery {
  id: string;
}

export interface AthenaAdminEmailTemplateGetResponse {
  email_template?: AthenaAdminEmailTemplateRecord;
}

export interface AthenaAdminEmailTemplateSendRequest {
  attachment_failure_mode?: "fail" | "skip";
  attachments?:
    | string
    | AthenaAuthEmailTemplateAttachment
    | AthenaAuthEmailTemplateAttachment[];
  metadata?: AthenaAuthLooseRecord;
  organization_id?: string;
  recipient_email: string;
  render_variables?: AthenaAuthLooseRecord;
  session_token?: string;
  template_id: string;
  user_id?: string;
}

export interface AthenaAdminEmailTemplateSendResponse {
  attachment_count?: number | null;
  delivery_metadata?: AthenaAuthLooseRecord | null;
  email_send_failure_id?: string | null;
  error?: string | null;
  event_type?: string | null;
  flow?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
  success: boolean;
  template_id?: string | null;
  template_key?: string | null;
}

export interface AthenaAdminEmailEventTypeRecord {
  description?: string | null;
  event_type: string;
  label?: string | null;
}

export interface AthenaAdminEmailEventTypeListResponse {
  event_types?: AthenaAdminEmailEventTypeRecord[];
}

export interface AthenaApiKeyCreateRequest {
  expiresIn: string;
  metadata?: string;
  name?: string;
  permissions?: string;
  prefix?: string;
  rateLimitEnabled?: string;
  rateLimitMax?: string;
  rateLimitTimeWindow?: string;
  refillAmount?: string;
  refillInterval?: string;
  remaining: string;
  userId?: string;
}

export interface AthenaApiKeyRecord {
  createdAt: string;
  enabled: boolean;
  expiresAt?: string | null;
  id: string;
  key?: string;
  lastRefillAt?: string | null;
  lastRequest?: string | null;
  metadata?: AthenaAuthLooseRecord | null;
  name?: string | null;
  permissions?: string | null;
  prefix?: string | null;
  rateLimitEnabled: boolean;
  rateLimitMax?: number | null;
  rateLimitTimeWindow?: number | null;
  refillAmount?: number | null;
  refillInterval?: number | null;
  remaining?: number | null;
  requestCount: number;
  start?: string | null;
  updatedAt: string;
  userId: string;
}

export interface AthenaApiKeyGetQuery {
  id?: string;
}

export interface AthenaApiKeyUpdateRequest {
  enabled?: string;
  expiresIn: string;
  keyId: string;
  metadata?: string;
  name?: string;
  permissions: string;
  rateLimitEnabled?: string;
  rateLimitMax?: string;
  rateLimitTimeWindow?: string;
  refillAmount?: string;
  refillInterval?: string;
  remaining?: string;
  userId?: string;
}

export interface AthenaApiKeyDeleteRequest {
  keyId: string;
}

export interface AthenaApiKeyVerifyRequest {
  key: string;
  permissions?: AthenaAuthLooseRecord;
}

export interface AthenaApiKeyVerifyResponse {
  error?: {
    message?: string;
    code?: string;
  } | null;
  key?: AthenaAuthLooseRecord | null;
  valid?: boolean;
}

export interface AthenaApiKeyDeleteAllExpiredResponse {
  deleted?: number;
}

export interface AthenaAuthOrganizationCreateRequest {
  keepCurrentActiveOrganization?: boolean;
  logo?: string;
  metadata?: Record<string, unknown>;
  name: string;
  slug: string;
  userId?: string;
}

export interface AthenaAuthOrganizationCheckSlugRequest {
  slug: string;
}

export interface AthenaAuthOrganizationSetActiveRequest {
  organizationId?: string | null;
  organizationSlug?: string | null;
}

export interface AthenaAuthOrganizationGetFullQuery {
  invitationsLimit?: number;
  invitationsOffset?: number;
  membersLimit?: number;
  membersOffset?: number;
  organizationId?: string;
  organizationSlug?: string;
}

export interface AthenaAuthOrganizationUpdateRequest {
  data: {
    name?: string;
    slug?: string;
    logo?: string;
    metadata?: Record<string, unknown> | null;
  };
  organizationId?: string;
}

export interface AthenaAuthOrganizationDeleteRequest {
  organizationId: string;
}

export interface AthenaAuthOrganizationInviteMemberRequest {
  email: string;
  organizationId?: string;
  resend?: boolean;
  role: string | string[];
  teamId?: string;
}

export interface AthenaAuthOrganizationInvitationActionRequest {
  invitationId: string;
}

export interface AthenaAuthOrganizationGetInvitationQuery {
  id: string;
}

export interface AthenaAuthOrganizationListInvitationsQuery {
  limit?: number;
  offset?: number;
  organizationId?: string;
}

export interface AthenaAuthOrganizationListUserInvitationsQuery {
  email?: string;
}

export type AthenaAuthOrganizationListMembersFilterOperator =
  AthenaAuthFilterOperator;

export interface AthenaAuthOrganizationListMembersQuery {
  filterField?: string;
  filterOperator?: AthenaAuthOrganizationListMembersFilterOperator;
  filterValue?: string | number | boolean | string[] | number[];
  limit?: number;
  offset?: number;
  organizationId?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

export interface AthenaAuthOrganizationRemoveMemberRequest {
  memberIdOrEmail: string;
  organizationId?: string;
}

export interface AthenaAuthOrganizationUpdateMemberRoleRequest {
  memberId: string;
  organizationId?: string;
  role: string | string[];
}

export interface AthenaAuthOrganizationAddMemberRequest {
  organizationId?: string;
  role: string | string[];
  teamId?: string;
  userId?: string | null;
}

export interface AthenaAuthOrganizationLeaveRequest {
  organizationId: string;
}

export interface AthenaAuthOrganizationCreateRoleRequest {
  organizationId?: string;
  permission: Record<string, string[]>;
  role: string;
}

export interface AthenaAuthOrganizationRoleSelector {
  organizationId?: string;
  roleId?: string;
  roleName?: string;
}

export interface AthenaAuthOrganizationListRolesQuery {
  organizationId?: string;
}

export interface AthenaAuthOrganizationUpdateRoleRequest
  extends AthenaAuthOrganizationRoleSelector {
  data: {
    permission?: Record<string, string[]>;
    roleName?: string;
  };
}

export interface AthenaAuthOrganizationCreateTeamRequest {
  name: string;
  organizationId?: string;
}

export interface AthenaAuthOrganizationListTeamsQuery {
  organizationId?: string;
}

export interface AthenaAuthOrganizationUpdateTeamRequest {
  data: {
    name?: string;
    organizationId?: string;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  };
  teamId: string;
}

export interface AthenaAuthOrganizationRemoveTeamRequest {
  organizationId?: string;
  teamId: string;
}

export interface AthenaAuthOrganizationSetActiveTeamRequest {
  teamId: string;
}

export interface AthenaAuthOrganizationListTeamMembersQuery {
  teamId?: string;
}

export interface AthenaAuthOrganizationTeamMemberRequest {
  teamId: string;
  userId: string;
}

export interface AthenaAuthRequestInput {
  body?: unknown;
  endpoint: AthenaAuthEndpointPath;
  fetchOptions?: AthenaAuthCallOptions;
  method?: AthenaAuthMethod;
  query?: Record<string, AthenaAuthQueryValue>;
}

export interface AthenaAuthCallOptions {
  apiKey?: string;
  baseUrl?: string;
  bearerToken?: string;
  cookie?: string;
  credentials?: AthenaAuthCredentials;
  forceNoCache?: boolean;
  headers?: Record<string, string>;
  sessionToken?: string;
  signal?: AbortSignal;
}

export interface AthenaAuthFetchCompatibleInput {
  fetchOptions?: AthenaAuthCallOptions;
}

export interface AthenaAuthClientConfig extends AthenaAuthCallOptions {
  /** Optional known snapshot. Embedded runtimes seed the 5.1 advertisement. */
  capabilities?: AthenaAuthCapabilitiesResult;
  fetch?: typeof fetch;
  reactEmail?: AthenaAuthReactEmailConfig;
}

export type AthenaAuthGuardReason =
  | "unauthorized"
  | "forbidden"
  | "upstream_error";

export interface AthenaAuthGuardSuccess {
  ok: true;
  session: AthenaAuthSessionResponse;
}

export interface AthenaAuthGuardFailure {
  error: string;
  ok: false;
  permissionResult?: AthenaAuthResult<AthenaAdminHasPermissionResponse>;
  reason: AthenaAuthGuardReason;
  sessionResult?: AthenaAuthResult<AthenaAuthSessionResponse>;
  status: number;
}

export type AthenaAuthGuardResult =
  | AthenaAuthGuardSuccess
  | AthenaAuthGuardFailure;

export interface AthenaAuthEmailTemplateDefinition<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> {
  component: AthenaAuthReactEmailComponent<TProps>;
  defaults?: AthenaAuthReactEmailRenderOptions;
  subjectTemplate?: string;
  templateKey?: string;
}

export interface AthenaAuthEmailTemplateReactOverrides {
  includePlainText?: boolean;
  pretty?: boolean;
  text?: string;
}

export interface AthenaAuthEmailTemplateCreateFromDefinitionInput<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> extends Omit<
    AthenaAdminEmailTemplateCreateRequest,
    | "react"
    | "html_template"
    | "text_template"
    | "variables"
    | "template_key"
    | "subject_template"
  > {
  props: TProps;
  react?: AthenaAuthEmailTemplateReactOverrides;
  subjectTemplate?: string;
  templateKey?: string;
}

export interface AthenaAuthEmailTemplateUpdateFromDefinitionInput<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> extends Omit<
    AthenaAdminEmailTemplateUpdateRequest,
    "react" | "html_template" | "text_template" | "variables"
  > {
  props: TProps;
  react?: AthenaAuthEmailTemplateReactOverrides;
}

export interface AthenaAuthEmailTemplateBuilder<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> {
  component: AthenaAuthReactEmailComponent<TProps>;
  react: (
    props: TProps,
    overrides?: AthenaAuthEmailTemplateReactOverrides
  ) => AthenaAuthReactEmailRenderInput;
  toTemplateCreate: (
    input: AthenaAuthEmailTemplateCreateFromDefinitionInput<TProps>
  ) => AthenaAdminEmailTemplateCreateRequest;
  toTemplateUpdate: (
    input: AthenaAuthEmailTemplateUpdateFromDefinitionInput<TProps>
  ) => AthenaAdminEmailTemplateUpdateRequest;
}

export type AthenaAuthGenericInput = AthenaAuthFetchCompatibleInput &
  Record<string, unknown>;
export type AthenaAuthGenericQueryInput = AthenaAuthFetchCompatibleInput & {
  query?: Record<string, AthenaAuthQueryValue>;
};

export type AthenaAuthResetPasswordBinding = ((
  input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>) & {
  token: (
    input: {
      token: string;
      callbackURL?: string;
    } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<{ token?: string }>>;
};

export type AthenaAuthSessionRevokeBinding = (
  input:
    | (AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput)
    | (AthenaAuthRevokeSessionRequest[] & AthenaAuthFetchCompatibleInput)
    | ({ tokens: string[] } & AthenaAuthFetchCompatibleInput),
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;

export type AthenaAuthAdminUserSessionRevokeBinding = (
  input:
    | (AthenaAdminRevokeUserSessionRequest & AthenaAuthFetchCompatibleInput)
    | (AthenaAdminRevokeUserSessionsRequest & AthenaAuthFetchCompatibleInput)
    | ({
        sessions: AthenaAdminRevokeUserSessionRequest[];
      } & AthenaAuthFetchCompatibleInput)
    | (AthenaAdminRevokeUserSessionRequest & AthenaAuthFetchCompatibleInput)[],
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;

export interface AthenaAuthOrganizationBindings {
  /** Check if an organization slug is available. Route: `POST /organization/check-slug`. */
  checkSlug: (
    input: AthenaAuthOrganizationCheckSlugRequest &
      AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<{ available: boolean }>>;
  /** Create an organization. Route: `POST /organization/create`. */
  create: (
    input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization>>;
  /** Delete an organization. Route: `POST /organization/delete`. */
  delete: (
    input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  /** Get organization details including related members/invitations. Route: `GET /organization/get-full-organization`. */
  getFull: (
    input?: {
      query?: AthenaAuthOrganizationGetFullQuery;
    } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<
    AthenaAuthResult<{
      organization: AthenaAuthOrganization;
      members?: AthenaAuthOrganizationMember[];
      invitations?: AthenaAuthOrganizationInvitation[];
    }>
  >;
  /** Check organization-level permissions for the current principal. Route: `POST /organization/has-permission`. */
  hasPermission: (
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>;
  invitation: {
    /** Cancel an organization invitation. Route: `POST /organization/cancel-invitation`. */
    cancel: (
      input: AthenaAuthOrganizationInvitationActionRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    /** Accept an organization invitation. Route: `POST /organization/accept-invitation`. */
    accept: (
      input: AthenaAuthOrganizationInvitationActionRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    /** Get an invitation by id. Route: `GET /organization/get-invitation`. */
    get: (
      input: {
        query: AthenaAuthOrganizationGetInvitationQuery;
      } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>;
    /** Reject an organization invitation. Route: `POST /organization/reject-invitation`. */
    reject: (
      input: AthenaAuthOrganizationInvitationActionRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    /** List invitations for an organization. Route: `GET /organization/list-invitations`. */
    list: (
      input?: {
        query?: AthenaAuthOrganizationListInvitationsQuery;
      } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>;
  };
  /** Leave an organization. Route: `POST /organization/leave`. */
  leave: (
    input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  /** List organizations visible to the current user. Route: `GET /organization/list`. */
  list: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>;
  /** List invitations for the current user. Route: `GET /organization/list-user-invitations`. */
  listUserInvitations: (
    input?: {
      query?: AthenaAuthOrganizationListUserInvitationsQuery;
    } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>;
  member: {
    /** Remove an organization member. Route: `POST /organization/remove-member`. */
    remove: (
      input: AthenaAuthOrganizationRemoveMemberRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    /** Update a member role. Route: `POST /organization/update-member-role`. */
    updateRole: (
      input: AthenaAuthOrganizationUpdateMemberRoleRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    /** Invite a member to an organization. Route: `POST /organization/invite-member`. */
    invite: (
      input: AthenaAuthOrganizationInviteMemberRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>;
    /** Get the active organization member context for the current session. Route: `GET /organization/get-active-member`. */
    getActive: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>;
    /** List organization members. Route: `GET /organization/list-members`. */
    list: (
      input?: {
        query?: AthenaAuthOrganizationListMembersQuery;
      } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>;
  };
  /** Resolve the current session and require organization-level permissions in one call. */
  requirePermission: (
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthGuardResult>;
  /** Set active organization for current session. Route: `POST /organization/set-active`. */
  setActive: (
    input: AthenaAuthOrganizationSetActiveRequest &
      AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  /** Update an organization. Route: `POST /organization/update`. */
  update: (
    input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization>>;
}

export interface AthenaAuthBindings {
  account: {
    /** List linked provider accounts. Route: `GET /list-accounts`. */
    list: InternalAthenaAuthModule["listAccounts"];
    /** Unlink a provider account. Route: `POST /unlink-account`. */
    unlink: InternalAthenaAuthModule["unlinkAccount"];
  };
  admin: {
    listUsers: (
      input?: {
        query?: AthenaAdminListUsersQuery;
      } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>;
    getUser: (
      input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    createUser: (
      input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    updateUser: (
      input: AthenaAdminTargetUserRequest &
        AthenaAuthFetchCompatibleInput & {
          email?: string;
          emailVerified?: boolean;
          image?: string | null;
          name?: string | null;
        },
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    setRole: (
      input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    banUser: (
      input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    unbanUser: (
      input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    revokeUserSessions: AthenaAuthAdminUserSessionRevokeBinding;
    removeUser: (
      input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
    impersonateUser: (
      input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>;
    stopImpersonating: (
      input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>;
    role: {
      /** Set a user role. Route: `POST /admin/set-role`. */
      set: (
        input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
    };
    user: {
      get: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
      update: (
        input: AthenaAdminTargetUserRequest &
          AthenaAuthFetchCompatibleInput & {
            email?: string;
            emailVerified?: boolean;
            image?: string | null;
            name?: string | null;
          },
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
      /** List users. Route: `GET /admin/list-users`. */
      list: (
        input?: {
          query?: AthenaAdminListUsersQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>;
      /** Create user. Route: `POST /admin/create-user`. */
      create: (
        input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
      /** Unban user. Route: `POST /admin/unban-user`. */
      unban: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
      /** Ban user. Route: `POST /admin/ban-user`. */
      ban: (
        input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>;
      /** Start impersonation. Route: `POST /admin/impersonate-user`. */
      impersonate: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>;
      /** Stop impersonation. Route: `POST /admin/stop-impersonating`. */
      stopImpersonating: (
        input?: AthenaAdminStopImpersonatingRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>;
      /** Remove user. Route: `POST /admin/remove-user`. */
      remove: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
      /** Set user password. Route: `POST /admin/set-user-password`. */
      setPassword: (
        input: AthenaAdminSetUserPasswordRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
      session: {
        /** List sessions for a target user. Route: `POST /admin/list-user-sessions`. */
        list: (
          input: AthenaAdminListUserSessionsRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminListUserSessionsResponse>>;
        /**
         * Revoke one or multiple sessions; collapses to `/admin/revoke-user-session` or
         * `/admin/revoke-user-sessions`. `userId` is required and plural payloads must share one `userId`.
         */
        revoke: AthenaAuthAdminUserSessionRevokeBinding;
      };
    };
    /** Check permission under admin policy. Route: `POST /admin/has-permission`. */
    hasPermission: (
      input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>;
    /** Resolve the current session and require admin permissions in one call. */
    requirePermission: (
      input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthGuardResult>;
    apiKey: {
      /** Create admin-scoped API key. Route: `POST /admin/api-key/create`. */
      create: (
        input?: AthenaAdminApiKeyCreateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminApiKeyCreateResponse>>;
    };
    athenaClient: {
      /** Create Athena client credentials. Route: `POST /admin/athena-client/create`. */
      create: (
        input: AthenaAdminAthenaClientCreateRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>;
      /** List Athena client credentials. Route: `GET /admin/athena-client/list`. */
      list: (
        input?: AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminAthenaClientListResponse>>;
    };
    auditLog: {
      /** List auth audit events. Route: `GET /admin/audit-log/list`. */
      list: (
        input?: {
          query?: AthenaAdminAuditLogListQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminAuditLogListResponse>>;
    };
    email: {
      /** List emails. Route: `GET /admin/email/list`. */
      list: (
        input?: {
          query?: AthenaAdminEmailListQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailListResponse>>;
      /** Get a specific email record. Route: `GET /admin/email/get`. */
      get: (
        input: {
          query: AthenaAdminEmailGetQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailGetResponse>>;
      /** Create an email record. Route: `POST /admin/email/create`. */
      create: (
        input: AthenaAdminEmailCreateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
      /** Update an email record. Route: `POST /admin/email/update`. */
      update: (
        input: AthenaAdminEmailUpdateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailUpdateResponse>>;
      /** Delete an email record. Route: `POST /admin/email/delete`. */
      delete: (
        input: AthenaAdminEmailDeleteRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
      failure: {
        /** List email failure records. Route: `GET /admin/email-failure/list`. */
        list: (
          input?: {
            query?: AthenaAdminEmailFailureListQuery;
          } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailFailureListResponse>>;
        /** Get an email failure record. Route: `GET /admin/email-failure/get`. */
        get: (
          input: {
            query: AthenaAdminEmailFailureGetQuery;
          } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailFailureGetResponse>>;
        /** Create an email failure record. Route: `POST /admin/email-failure/create`. */
        create: (
          input: AthenaAdminEmailFailureCreateRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
        /** Update an email failure record. Route: `POST /admin/email-failure/update`. */
        update: (
          input: AthenaAdminEmailFailureUpdateRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailFailureUpdateResponse>>;
        /** Delete an email failure record. Route: `POST /admin/email-failure/delete`. */
        delete: (
          input: AthenaAdminEmailFailureDeleteRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
      };
      template: {
        /** List email templates. Route: `GET /admin/email-template/list`. */
        list: (
          input?: {
            query?: AthenaAdminEmailTemplateListQuery;
          } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>;
        /** Get email template by ID. Route: `GET /admin/email-template/get`. */
        get: (
          input: {
            query: AthenaAdminEmailTemplateGetQuery;
          } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>;
        /** Create email template. Route: `POST /admin/email-template/create`. */
        create: (
          input: AthenaAdminEmailTemplateCreateRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>;
        /** Update email template. Route: `POST /admin/email-template/update`. */
        update: (
          input: AthenaAdminEmailTemplateUpdateRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>;
        /** Delete email template. Route: `POST /admin/email-template/delete`. */
        delete: (
          input: AthenaAdminEmailTemplateDeleteRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
        /** Send one stored email template. Route: `POST /admin/email-template/send`. */
        send: (
          input: AthenaAdminEmailTemplateSendRequest &
            AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>;
      };
      eventType: {
        /** List canonical admin email event types. Route: `GET /admin/email-event-type/list`. */
        list: (
          input?: AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions
        ) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>;
      };
    };
    emailTemplate: {
      /** Get email template by ID. Route: `GET /admin/email-template/get`. */
      get: (
        input: {
          query: AthenaAdminEmailTemplateGetQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>;
      /** Create email template. Route: `POST /admin/email-template/create`. */
      create: (
        input: AthenaAdminEmailTemplateCreateRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>;
      /** Delete email template. Route: `POST /admin/email-template/delete`. */
      delete: (
        input: AthenaAdminEmailTemplateDeleteRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
      /** List email templates. Route: `GET /admin/email-template/list`. */
      list: (
        input?: {
          query?: AthenaAdminEmailTemplateListQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>;
      /** Update email template. Route: `POST /admin/email-template/update`. */
      update: (
        input: AthenaAdminEmailTemplateUpdateRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>;
      /** Send one stored email template. Route: `POST /admin/email-template/send`. */
      send: (
        input: AthenaAdminEmailTemplateSendRequest &
          AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>;
    };
    emailEventType: {
      /** List canonical admin email event types. Route: `GET /admin/email-event-type/list`. */
      list: (
        input?: AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>;
    };
  };
  apiKey: {
    /** Create API key. Route: `POST /api-key/create`. */
    create: (
      input: AthenaApiKeyCreateRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>;
    /** Get API key metadata. Route: `GET /api-key/get`. */
    get: (
      input?: { query?: AthenaApiKeyGetQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>;
    /** Update API key metadata. Route: `POST /api-key/update`. */
    update: (
      input: AthenaApiKeyUpdateRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>;
    /** Delete API key. Route: `POST /api-key/delete`. */
    delete: (
      input: AthenaApiKeyDeleteRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>;
    /** List API keys. Route: `GET /api-key/list`. */
    list: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord[]>>;
    /** Verify an API key. Route: `POST /api-key/verify`. */
    verify: (
      input: AthenaApiKeyVerifyRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaApiKeyVerifyResponse>>;
    /** Delete all expired API keys. Route: `POST /api-key/delete-all-expired-api-keys`. */
    deleteAllExpired: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaApiKeyDeleteAllExpiredResponse>>;
  };
  callback: {
    /** OAuth provider callback passthrough. Route: `GET /callback/{provider}`. */
    provider: (
      input: AthenaAuthCallbackProviderRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthCallbackProviderResponse>>;
  };
  /** Start change-email flow. Route: `POST /change-email`. */
  changeEmail: InternalAthenaAuthModule["changeEmail"];
  /** Verify pending email change. Route: `GET /change-email/verify`. */
  changeEmailVerify: (
    input: { query: AthenaAuthTokenQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>;
  /** Change current user password. Route: `POST /change-password`. */
  changePassword: InternalAthenaAuthModule["changePassword"];
  deleteUser: {
    /** Callback endpoint for delete-user verification flows. Route: `GET /delete-user/callback`. */
    callback: InternalAthenaAuthModule["deleteUserCallback"];
  };
  /** Verify pending delete-user flow. Route: `GET /delete-user/verify`. */
  deleteUserVerify: (
    input: { query: AthenaAuthTokenQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>;
  /** Error route passthrough. Route: `GET /error`. */
  error: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthErrorResponse | string>>;
  /** Trigger password reset email flow. Route: `POST /forget-password`. */
  forgetPassword: InternalAthenaAuthModule["forgetPassword"];
  /** Get provider access token. Route: `POST /get-access-token`. */
  getAccessToken: InternalAthenaAuthModule["getAccessToken"];
  /**
   * Issue a short-lived Athena JWT from the current session.
   * Route: `POST /token`. Not the OAuth-provider `/get-access-token` route.
   */
  getToken: InternalAthenaAuthModule["getToken"];
  /** Cached session-derived JWT helper with single-flight refresh. */
  tokenProvider: InternalAthenaAuthModule["tokenProvider"];
  /** Get current session. Route: `GET /get-session`. */
  getSession: InternalAthenaAuthModule["getSession"];
  /** Get current user as a Better Auth-style compatibility projection. Route: `GET /get-session`. */
  getUser: InternalAthenaAuthModule["getUser"];
  /** Auth health route. Primary `GET /health`; falls back to `GET /ok` on `404`. */
  health: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthHealthResponse>>;
  linkSocial: InternalAthenaAuthModule["linkSocial"];
  listAccounts: InternalAthenaAuthModule["listAccounts"];
  /**
   * Better Auth UI flat aliases — also available nested under
   * `session` / `account` / `social` / `user`.
   */
  listSessions: InternalAthenaAuthModule["listSessions"];
  /** Health route passthrough. Route: `GET /ok`. */
  ok: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthOkResponse>>;
  /** Organization plugin helper surface. Routes: `/organization/*`. */
  organization: AthenaAuthOrganizationBindings;
  passkey: {
    /** Generate WebAuthn registration options. Route: `GET /passkey/generate-register-options`. */
    generateRegisterOptions: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>;
    /** Generate WebAuthn authentication options. Route: `POST /passkey/generate-authenticate-options`. */
    generateAuthenticateOptions: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>;
    /** Verify passkey registration response. Route: `POST /passkey/verify-registration`. */
    verifyRegistration: (
      input: AthenaPasskeyVerifyRegistrationRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>;
    /** Verify passkey authentication response. Route: `POST /passkey/verify-authentication`. */
    verifyAuthentication: (
      input: AthenaPasskeyVerifyAuthenticationRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>;
    /** List current user's passkeys. Route: `GET /passkey/list-user-passkeys`. */
    listUserPasskeys: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>;
    /** Delete a passkey. Route: `POST /passkey/delete-passkey`. */
    deletePasskey: (
      input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>;
    /** Update a passkey metadata record. Route: `POST /passkey/update-passkey`. */
    updatePasskey: (
      input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>;
    /** Return related origins for WebAuthn. Route: `GET /.well-known/webauthn`. */
    getRelatedOrigins: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<{ origins?: string[] }>>;
  };
  /** Refresh provider token. Route: `POST /refresh-token`. */
  refreshToken: InternalAthenaAuthModule["refreshToken"];
  /** Resolve the current session into a typed guard result. */
  requireSession: InternalAthenaAuthModule["requireSession"];
  /** Reset password (`POST /reset-password`) and token resolver (`GET /reset-password/{token}`). */
  resetPassword: AthenaAuthResetPasswordBinding;
  revokeOtherSessions: InternalAthenaAuthModule["revokeOtherSessions"];
  revokeSession: InternalAthenaAuthModule["revokeSession"];
  /** Send verification email. Route: `POST /send-verification-email`. */
  sendVerificationEmail: InternalAthenaAuthModule["sendVerificationEmail"];
  session: {
    /** List user sessions. Route: `GET /list-sessions`. */
    list: InternalAthenaAuthModule["listSessions"];
    /** Revoke one or multiple sessions; collapses to `/revoke-session` or `/revoke-sessions` by payload shape. */
    revoke: AthenaAuthSessionRevokeBinding;
    /** Revoke all other sessions for current user. Route: `POST /revoke-other-sessions`. */
    revokeOther: InternalAthenaAuthModule["revokeOtherSessions"];
      /** Canonical client-side session snapshot (SSOT). */
      getSnapshot: () => AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>;
      /** Current session payload or null. */
      get: () => AthenaAuthSessionResponse | null;
      /**
       * Authoritative local write. Cancels in-flight refresh (INV-Q).
       * Prefer mutation helpers; advanced adapters may call directly.
       */
      setSession: (
        session: AthenaAuthSessionResponse | null,
        status?: "authenticated" | "unauthenticated" | "error"
      ) => void;
      invalidate: (reason?: "signOut" | "revoke" | "manual") => void;
      refresh: (
        input?: AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<unknown>;
      subscribe: (
        listener: (
          snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>
        ) => void
      ) => () => void;
    };
    /** Status-aware feature discovery (INV-P). Client-scoped cache. */
    capabilities: {
      get: () => AthenaAuthCapabilitiesResult;
      getSnapshot: () => AthenaAuthCapabilitiesResult;
      set: (next: AthenaAuthCapabilitiesResult) => void;
      merge: (
        patch: Partial<AthenaAuthCapabilitiesFeatures>,
        meta?: {
          status?: AthenaAuthCapabilitiesStatus;
          source?: AthenaAuthCapabilitiesSource;
        }
      ) => AthenaAuthCapabilitiesResult;
      markUnknown: (
        source?: AthenaAuthCapabilitiesSource
      ) => AthenaAuthCapabilitiesResult;
      subscribe: (
        listener: (value: AthenaAuthCapabilitiesResult) => void
      ) => () => void;
    };
    /** Set password for the current authenticated user. Route: `POST /set-password`. */
    setPassword: (
      input: AthenaSetPasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    signIn: {
      /** Sign in with email and password. Route: `POST /sign-in/email`. */
      email: InternalAthenaAuthModule["signIn"]["email"];
      /** Sign in with username and password. Route: `POST /sign-in/username`. */
      username: InternalAthenaAuthModule["signIn"]["username"];
      /** Sign in with social provider. Route: `POST /sign-in/social`. */
      social: InternalAthenaAuthModule["signIn"]["social"];
    };
  /** Sign out current session. Route: `POST /sign-out`. */
  signOut: InternalAthenaAuthModule["signOut"];
  signUp: {
    /** Sign up with email/password identity. Route: `POST /sign-up/email`. */
    email: InternalAthenaAuthModule["signUp"]["email"];
  };
  social: {
    /** Link a social provider to current user. Route: `POST /link-social`. */
    link: InternalAthenaAuthModule["linkSocial"];
      /**
       * Canonical social sign-in (`athena.auth.social.signIn`).
       * Alias of `signIn.social` for the public happy path.
       */
      signIn: InternalAthenaAuthModule["signIn"]["social"];
    };
  twoFactor: {
    /** Get TOTP URI for setup. Route: `POST /two-factor/get-totp-uri`. */
    getTotpUri: (
      input: AthenaTwoFactorGetTotpUriRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorGetTotpUriResponse>>;
    /** Verify TOTP code. Route: `POST /two-factor/verify-totp`. */
    verifyTotp: (
      input: AthenaTwoFactorVerifyTotpRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyTotpResponse>>;
    /** Send one-time passcode (OTP). Route: `POST /two-factor/send-otp`. */
    sendOtp: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
    /** Verify OTP code. Route: `POST /two-factor/verify-otp`. */
    verifyOtp: (
      input: AthenaTwoFactorVerifyOtpRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyOtpResponse>>;
    /** Verify backup code. Route: `POST /two-factor/verify-backup-code`. */
    verifyBackupCode: (
      input: AthenaTwoFactorVerifyBackupCodeRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyBackupCodeResponse>>;
    /** Generate backup codes. Route: `POST /two-factor/generate-backup-codes`. */
    generateBackupCodes: (
      input: AthenaTwoFactorGenerateBackupCodesRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorGenerateBackupCodesResponse>>;
    /** Enable two-factor auth. Route: `POST /two-factor/enable`. */
    enable: (
      input: AthenaTwoFactorEnableRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorEnableResponse>>;
    /** Disable two-factor auth. Route: `POST /two-factor/disable`. */
    disable: (
      input: AthenaTwoFactorDisableRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaTwoFactorDisableResponse>>;
  };
  unlinkAccount: InternalAthenaAuthModule["unlinkAccount"];
  updateUser: InternalAthenaAuthModule["updateUser"];
  user: {
    /** Update current user profile fields. Route: `POST /update-user`. */
    update: InternalAthenaAuthModule["updateUser"];
    /** Delete current user. Route: `POST /delete-user`. */
    delete: InternalAthenaAuthModule["deleteUser"];
    email: {
      /**
       * List email identities for current user.
       * Routes: primary `GET /email/list`; falls back to `GET /email-list` on `404`.
       */
      list: (
        input?: {
          query?: AthenaAuthEmailListQuery;
        } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) => Promise<AthenaAuthResult<AthenaAuthEmailListResponse>>;
    };
  };
  /** Verify email token. Route: `GET /verify-email`. */
  verifyEmail: InternalAthenaAuthModule["verifyEmail"];
  /**
   * Next.js / Web `Route` handlers for embedded or same-origin Auth.
   * Present when `createClient` materializes in-process Auth.
   */
  handlers?: AthenaAuthHttpHandlers;
  /**
   * In-process TypeScript Athena Auth runtime. Present when Auth is
   * embedded (inferred Node + database URI, or explicit `auth.mode: "local"`).
   */
  server?: AthenaAuthServerBindings;
}

export interface AthenaAuthHttpHandlers {
  DELETE: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  HEAD: (request: Request) => Promise<Response>;
  OPTIONS: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
}

export interface AthenaAuthServerBindings {
  handle(request: Request): Promise<Response>;
  handlers: AthenaAuthHttpHandlers;
  migrate(): Promise<void>;
}

/** Internal implementation surface used to assemble `createClient().auth`. */
export interface InternalAthenaAuthModule {
  auth: AthenaAuthBindings;
  baseUrl: string;
  changeEmail: (
    input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthEmailChangeResponse>>;
  changePassword: (
    input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<
    AthenaAuthResult<{ token?: string | null; user: AthenaAuthUser }>
  >;
  clearOtherSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  clearSession: (
    input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  clearSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  deleteUser: (
    input?: AthenaDeleteUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>;
  deleteUserCallback: (
    input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>;
  forgetPassword: (
    input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  getAccessToken: (
    input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>;
  getToken: (
    input?: AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthToken>>;
  tokenProvider: (options?: {
    audience?: string | string[];
    refreshSkewSeconds?: number;
  }) => {
    getToken: (
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthToken>>;
    invalidate: () => void;
  };
  getSession: (
    input?: AthenaAuthFetchCompatibleInput & {
      query?: { disableCookieCache?: boolean | string };
    },
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>;
  getUser: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthGetUserResponse>>;
  linkSocial: (
    input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>;
  listAccounts: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>;
  listSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthSession[]>>;
  logout: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>;
  organization: AthenaAuthOrganizationBindings;
  refreshToken: (
    input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>;
  request: <T = unknown>(
    input: AthenaAuthRequestInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<T>>;
  requireSession: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthGuardResult>;
  resetPassword: (
    input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  resolveResetPasswordToken: (
    input: {
      token: string;
      callbackURL?: string;
    } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<{ token?: string }>>;
  revokeOtherSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  revokeSession: (
    input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  revokeSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  sendVerificationEmail: (
    input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  signIn: {
    email: (
      input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>;
    username: (
      input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>;
    social: (
      input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<
      AthenaAuthResult<
        AthenaAuthSocialRedirectResponse | AthenaAuthSignInResponse
      >
    >;
  };
  signOut: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>;
  signUp: {
    email: (
      input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>;
  };
  unlinkAccount: (
    input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  updateUser: (
    input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>;
  verifyEmail: (
    input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean }>>;
}

/** Bindings surface of `createClient(...).auth`. */
export type AuthBindings = AthenaAuthBindings;
