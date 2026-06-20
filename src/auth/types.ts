export type AthenaAuthMethod = 'GET' | 'POST'
export type AthenaAuthCredentials = 'omit' | 'same-origin' | 'include'
export type AthenaAuthQueryPrimitive = string | number | boolean
export type AthenaAuthQueryValue =
  | AthenaAuthQueryPrimitive
  | AthenaAuthQueryPrimitive[]
  | null
  | undefined

export type AthenaAuthEndpointPath =
  | '/sign-in/social'
  | '/sign-in/email'
  | '/sign-in/username'
  | '/sign-up/email'
  | '/get-session'
  | '/sign-out'
  | '/forget-password'
  | '/reset-password'
  | '/verify-email'
  | '/send-verification-email'
  | '/change-email'
  | '/change-email/verify'
  | '/change-password'
  | '/set-password'
  | '/update-user'
  | '/delete-user'
  | '/delete-user/verify'
  | '/delete-user/callback'
  | '/email-list'
  | '/email/list'
  | '/list-sessions'
  | '/revoke-session'
  | '/revoke-sessions'
  | '/revoke-other-sessions'
  | '/link-social'
  | '/list-accounts'
  | '/unlink-account'
  | '/refresh-token'
  | '/get-access-token'
  | '/two-factor/get-totp-uri'
  | '/two-factor/verify-totp'
  | '/two-factor/send-otp'
  | '/two-factor/verify-otp'
  | '/two-factor/verify-backup-code'
  | '/two-factor/generate-backup-codes'
  | '/two-factor/enable'
  | '/two-factor/disable'
  | '/passkey/generate-register-options'
  | '/passkey/generate-authenticate-options'
  | '/passkey/verify-registration'
  | '/passkey/verify-authentication'
  | '/passkey/list-user-passkeys'
  | '/passkey/delete-passkey'
  | '/passkey/update-passkey'
  | '/.well-known/webauthn'
  | '/admin/set-role'
  | '/admin/list-users'
  | '/admin/list-user-sessions'
  | '/admin/create-user'
  | '/admin/unban-user'
  | '/admin/ban-user'
  | '/admin/impersonate-user'
  | '/admin/stop-impersonating'
  | '/admin/revoke-user-session'
  | '/admin/revoke-user-sessions'
  | '/admin/remove-user'
  | '/admin/set-user-password'
  | '/admin/has-permission'
  | '/admin/api-key/create'
  | '/admin/athena-client/create'
  | '/admin/athena-client/list'
  | '/admin/audit-log/list'
  | '/admin/email/get'
  | '/admin/email/create'
  | '/admin/email/update'
  | '/admin/email/delete'
  | '/admin/email-failure/list'
  | '/admin/email-failure/get'
  | '/admin/email-failure/create'
  | '/admin/email-failure/update'
  | '/admin/email-failure/delete'
  | '/admin/email-template/get'
  | '/admin/email-template/create'
  | '/admin/email-template/delete'
  | '/admin/email-template/list'
  | '/admin/email-template/update'
  | '/admin/email/list'
  | '/api-key/create'
  | '/api-key/get'
  | '/api-key/update'
  | '/api-key/delete'
  | '/api-key/list'
  | '/api-key/verify'
  | '/api-key/delete-all-expired-api-keys'
  | '/organization/create'
  | '/organization/check-slug'
  | '/organization/list'
  | '/organization/set-active'
  | '/organization/get-full-organization'
  | '/organization/update'
  | '/organization/delete'
  | '/organization/invite-member'
  | '/organization/accept-invitation'
  | '/organization/cancel-invitation'
  | '/organization/reject-invitation'
  | '/organization/get-invitation'
  | '/organization/list-invitations'
  | '/organization/list-user-invitations'
  | '/organization/list-members'
  | '/organization/remove-member'
  | '/organization/update-member-role'
  | '/organization/get-active-member'
  | '/organization/leave'
  | '/organization/has-permission'
  | `/callback/${string}`
  | '/health'
  | '/ok'
  | '/error'
  | `/reset-password/${string}`

export type AthenaAuthErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'UNKNOWN_ERROR'

export interface AthenaAuthErrorDetails {
  code: AthenaAuthErrorCode
  message: string
  status: number
  endpoint?: AthenaAuthEndpointPath
  method?: AthenaAuthMethod
  requestId?: string
  hint?: string
  cause?: string
}

export interface AthenaAuthResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
  errorDetails?: AthenaAuthErrorDetails | null
  raw: unknown
}

export interface AthenaAuthUser {
  id: string
  email: string
  name?: string | null
  image?: string | null
  emailVerified?: boolean
  createdAt?: string
  updatedAt?: string
  username?: string | null
  displayUsername?: string | null
  twoFactorEnabled?: boolean
  role?: string | null
  banned?: boolean
  banReason?: string | null
  banExpires?: string | null
}

export interface AthenaAuthSession {
  id: string
  expiresAt?: string
  token?: string
  createdAt?: string
  updatedAt?: string
  ipAddress?: string | null
  userAgent?: string | null
  userId?: string
  impersonatedBy?: string | null
  activeOrganizationId?: string | null
}

export interface AthenaAuthSessionResponse {
  session: AthenaAuthSession
  user: AthenaAuthUser
}

export interface AthenaAuthGetUserResponse {
  user: AthenaAuthUser | null
}

export interface AthenaAuthOrganization {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown> | null
  createdAt?: string
  updatedAt?: string
}

export interface AthenaAuthOrganizationMember {
  id: string
  organizationId?: string
  userId?: string
  role?: string | string[] | null
  createdAt?: string
  updatedAt?: string
  user?: AthenaAuthUser
}

export interface AthenaAuthOrganizationInvitation {
  id: string
  email?: string
  role?: string | string[] | null
  organizationId?: string
  inviterId?: string
  teamId?: string | null
  status?: string
  expiresAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface AthenaAuthOrganizationRole {
  id?: string
  role?: string
  roleName?: string
  permission?: Record<string, string[]>
  organizationId?: string
  createdAt?: string
  updatedAt?: string
}

export interface AthenaAuthOrganizationTeam {
  id: string
  name: string
  organizationId?: string
  createdAt?: string
  updatedAt?: string
}

export interface AthenaEmailSignInRequest {
  email: string
  password: string
  callbackURL?: string
  rememberMe?: boolean
}

export interface AthenaUsernameSignInRequest {
  username: string
  password: string
  rememberMe?: boolean
}

export interface AthenaSocialSignInRequest {
  provider: string
  callbackURL?: string
  newUserCallbackURL?: string
  errorCallbackURL?: string
  disableRedirect?: boolean
  idToken?: string
  scopes?: string[] | string
  requestSignUp?: boolean
  loginHint?: string
}

export interface AthenaEmailSignUpRequest {
  name: string
  email: string
  password: string
  callbackURL?: string
}

export interface AthenaAuthSignInResponse {
  redirect: false
  token: string
  url?: string | null
  user: AthenaAuthUser
}

export interface AthenaAuthSocialRedirectResponse {
  url: string
  redirect: boolean
}

export interface AthenaAuthSignOutResponse {
  success: boolean
}

export interface AthenaAuthStatusResponse {
  status: boolean
}

export interface AthenaAuthRevokeSessionRequest {
  token: string
}

export interface AthenaForgetPasswordRequest {
  email: string
  redirectTo?: string
}

export interface AthenaResetPasswordRequest {
  newPassword: string
  token?: string
}

export interface AthenaVerifyEmailRequest {
  token: string
  callbackURL?: string
}

export interface AthenaSendVerificationEmailRequest {
  email: string
  callbackURL?: string
}

export interface AthenaChangeEmailRequest {
  newEmail: string
  callbackURL?: string
}

export interface AthenaChangePasswordRequest {
  newPassword: string
  currentPassword: string
  revokeOtherSessions?: boolean
}

export interface AthenaUpdateUserRequest {
  name?: string
  image?: string
}

export interface AthenaDeleteUserRequest {
  callbackURL?: string
  password?: string
  token?: string
}

export interface AthenaDeleteUserCallbackRequest {
  token?: string
  callbackURL?: string
}

export interface AthenaDeleteUserResponse {
  success: boolean
  message?: string
}

export interface AthenaAuthEmailChangeResponse {
  status: boolean
  message?: string | null
}

export interface AthenaLinkSocialRequest {
  provider: string
  callbackURL?: string
  scopes?: string[] | string
}

export interface AthenaUnlinkAccountRequest {
  providerId: string
  accountId?: string
}

export interface AthenaOAuthAccountTokenRequest {
  providerId: string
  accountId?: string
  userId?: string
}

export interface AthenaOAuthTokenBundle {
  tokenType?: string
  idToken?: string
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresAt?: string
  refreshTokenExpiresAt?: string
}

export interface AthenaAuthLinkedAccount {
  id: string
  provider?: string
  accountId?: string
  scopes?: string[]
  createdAt?: string
  updatedAt?: string
}

export type AthenaAuthPermissionSet = Record<string, unknown> | string[]
export type AthenaAuthLooseRecord = Record<string, unknown>
export type AthenaAuthReactEmailProps = Record<string, unknown>

export interface AthenaSetPasswordRequest {
  newPassword: string
}

export interface AthenaAuthTokenQuery {
  token: string
}

export interface AthenaAuthTokenVerificationResponse {
  status: boolean
  message: string
}

export interface AthenaAuthEmailListQuery {
  limit?: number
  offset?: number
}

export interface AthenaAuthEmailListResponse {
  total: number
  limit: number
  offset: number
  emails: AthenaAuthLooseRecord[]
}

export interface AthenaAuthHealthResponse {
  status?: string
  service?: string
  version?: string
}

export interface AthenaAuthOkResponse {
  ok: boolean
}

export interface AthenaAuthErrorResponse {
  message: string
}

export interface AthenaAuthCallbackProviderRequest {
  provider: string
  code: string
  state: string
}

export interface AthenaAuthCallbackProviderResponse {
  token?: string
  user?: AthenaAuthLooseRecord
}

export interface AthenaTwoFactorGetTotpUriRequest {
  password: string
}

export interface AthenaTwoFactorGetTotpUriResponse {
  totpURI?: string
}

export interface AthenaTwoFactorVerifyTotpRequest {
  code: string
  trustDevice?: string
}

export interface AthenaTwoFactorVerifyTotpResponse {
  status?: boolean
}

export interface AthenaTwoFactorVerifyOtpRequest {
  code: string
  trustDevice?: string
}

export interface AthenaTwoFactorVerifyOtpResponse {
  token: string
  user: AthenaAuthUser
}

export interface AthenaTwoFactorVerifyBackupCodeRequest {
  code: string
  disableSession?: string
  trustDevice?: string
}

export interface AthenaTwoFactorSessionSnapshot {
  token: string
  userId: string
  createdAt: string
  expiresAt: string
}

export interface AthenaTwoFactorVerifyBackupCodeResponse {
  user: AthenaAuthUser
  session: AthenaTwoFactorSessionSnapshot
}

export interface AthenaTwoFactorGenerateBackupCodesRequest {
  password: string
}

export interface AthenaTwoFactorGenerateBackupCodesResponse {
  status: true
  backupCodes: string[]
}

export interface AthenaTwoFactorEnableRequest {
  password: string
  issuer?: string
}

export interface AthenaTwoFactorEnableResponse {
  totpURI?: string
  backupCodes?: string[]
}

export interface AthenaTwoFactorDisableRequest {
  password: string
}

export interface AthenaTwoFactorDisableResponse {
  status?: boolean
}

export interface AthenaPasskeyCredentialDescriptor {
  id?: string
  type?: string
  transports?: string[]
}

export interface AthenaPasskeyPublicKeyCredentialParam {
  type?: string
  alg?: number
}

export interface AthenaPasskeyUserDescriptor {
  id?: string
  name?: string
  displayName?: string
}

export interface AthenaPasskeyRelyingParty {
  name?: string
  id?: string
}

export interface AthenaPasskeyAuthenticatorSelection {
  authenticatorAttachment?: string
  requireResidentKey?: boolean
  userVerification?: string
}

export interface AthenaPasskeyOptionsResponse {
  challenge?: string
  rp?: AthenaPasskeyRelyingParty
  user?: AthenaPasskeyUserDescriptor
  timeout?: number
  allowCredentials?: AthenaPasskeyCredentialDescriptor[]
  excludeCredentials?: AthenaPasskeyCredentialDescriptor[]
  pubKeyCredParams?: AthenaPasskeyPublicKeyCredentialParam[]
  userVerification?: string
  authenticatorSelection?: AthenaPasskeyAuthenticatorSelection
  attestation?: string
  extensions?: AthenaAuthLooseRecord
}

export interface AthenaPasskeyRecord {
  id: string
  name?: string | null
  publicKey?: string
  userId: string
  credentialID?: string
  counter?: number
  deviceType?: string
  backedUp?: boolean
  transports?: string
  createdAt?: string
}

export interface AthenaPasskeyVerifyRegistrationRequest {
  response: string
  name?: string
}

export interface AthenaPasskeyVerifyAuthenticationRequest {
  response: string
}

export interface AthenaPasskeyVerifyAuthenticationResponse {
  session: AthenaAuthSession
  user: AthenaAuthUser
}

export interface AthenaPasskeyDeleteRequest {
  id: string
}

export interface AthenaPasskeyDeleteResponse {
  status: boolean
}

export interface AthenaPasskeyUpdateRequest {
  id: string
  name: string
}

export interface AthenaPasskeyUpdateResponse {
  passkey: AthenaPasskeyRecord
}

export interface AthenaAdminSetRoleRequest {
  userId: string
  role: string
}

export interface AthenaAdminCreateUserRequest {
  email: string
  password: string
  name: string
  role?: string
  data?: string
}

export interface AthenaAdminTargetUserRequest {
  userId: string
}

export interface AthenaAdminBanUserRequest extends AthenaAdminTargetUserRequest {
  banReason?: string
  banExpiresIn?: string
}

export type AthenaAuthSearchOperator = 'contains' | 'starts_with' | 'ends_with'

export type AthenaAuthFilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts_with'
  | 'ends_with'

export type AthenaAdminListUsersSearchOperator = AthenaAuthSearchOperator
export type AthenaAdminListUsersFilterOperator = AthenaAuthFilterOperator

export interface AthenaAdminListUsersQuery {
  searchValue?: string
  searchField?: string
  searchOperator?: AthenaAdminListUsersSearchOperator
  limit?: number | string
  offset?: number | string
  sortBy?: string
  sortDirection?: string
  filterField?: string
  filterValue?: string
  filterOperator?: AthenaAdminListUsersFilterOperator
}

export interface AthenaAdminListUsersResponse {
  users: AthenaAuthUser[]
  total: number
  limit?: number
  offset?: number
}

export interface AthenaAdminListUserSessionsRequest {
  userId: string
}

export interface AthenaAdminListUserSessionsResponse {
  sessions: AthenaAuthSession[]
}

export interface AthenaAdminImpersonateResponse {
  session: AthenaAuthSession
  user: AthenaAuthUser
}

export interface AthenaAdminStopImpersonatingRequest {
  userId?: string
}

export interface AthenaAdminRevokeUserSessionRequest {
  sessionToken: string
  userId: string
  sessionId?: string
}

export interface AthenaAdminRevokeUserSessionsRequest {
  userId: string
}

export interface AthenaAdminSetUserPasswordRequest {
  userId: string
  newPassword: string
}

export interface AthenaAdminUserResponse {
  user: AthenaAuthUser
}

export interface AthenaAdminSuccessResponse {
  success: boolean
}

export interface AthenaAdminHasPermissionRequest {
  permission?: AthenaAuthPermissionSet
  permissions: AthenaAuthPermissionSet
}

export interface AthenaAdminHasPermissionResponse {
  success: boolean
  error?: string
}

export interface AthenaAdminApiKeyCreateRequest {
  name?: string
  expiresIn?: number
  athenaClientName?: string
  permissions?: AthenaAuthLooseRecord
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminApiKeyCreateResponse {
  key?: string
  apiKey?: AthenaAuthLooseRecord
}

export interface AthenaAdminAthenaClientCreateRequest {
  clientName: string
  description?: string
  isActive?: boolean
  pgUriEnvVar?: string
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminAthenaClientListResponse {
  athenaClients?: AthenaAuthLooseRecord[]
}

export interface AthenaAdminAuditLogListQuery {
  limit?: number
  offset?: number
  actorUserId?: string
  action?: string
  targetType?: string
  targetId?: string
  success?: boolean
  createdAfter?: string
  createdBefore?: string
}

export interface AthenaAdminAuditLogListResponse {
  total?: number
  limit?: number
  offset?: number
  auditLogs?: AthenaAuthLooseRecord[]
}

export interface AthenaAdminEmailListQuery {
  limit?: number
  offset?: number
  recipientEmail?: string
  provider?: string
  flow?: string
  subjectContains?: string
  createdAfter?: string
  createdBefore?: string
}

export interface AthenaAdminEmailListResponse {
  total?: number
  limit?: number
  offset?: number
  emails?: AthenaAuthLooseRecord[]
}

export interface AthenaAdminEmailGetQuery {
  id: string
}

export interface AthenaAdminEmailGetResponse {
  email?: AthenaAuthLooseRecord
}

export interface AthenaAuthReactEmailRenderInput {
  /**
   * React email element instance (for example: `<WelcomeEmail {...props} />`).
   */
  element?: unknown
  /**
   * React email component function. Use with `props` when you prefer component + props inputs.
   */
  component?: AthenaAuthReactEmailComponent
  /**
   * Props passed to `component` when `element` is omitted.
   */
  props?: AthenaAuthReactEmailProps
  /**
   * When true, run `pretty(...)` on rendered HTML when available.
   */
  pretty?: boolean
  /**
   * Override plain-text output. If omitted, text is auto-derived when possible.
   */
  text?: string
  /**
   * Disable derived plain-text generation. Defaults to `true`.
   */
  includePlainText?: boolean
}

export type AthenaAuthReactEmailComponent<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> = (props: TProps) => unknown

export interface AthenaAuthReactEmailRenderOptions {
  pretty?: boolean
  includePlainText?: boolean
}

export type AthenaAuthReactEmailEventPhase = 'render:start' | 'render:success' | 'render:error'

export interface AthenaAuthReactEmailRenderEvent {
  phase: AthenaAuthReactEmailEventPhase
  timestamp: string
  route?: string
  durationMs?: number
  message?: string
  error?: string
}

export interface AthenaAuthReactEmailConfig {
  /**
   * Optional default render settings used when request payloads omit `pretty` or `includePlainText`.
   */
  defaults?: AthenaAuthReactEmailRenderOptions
  /**
   * Optional observer for render lifecycle events.
   */
  observe?: (event: AthenaAuthReactEmailRenderEvent) => void
}

export interface AthenaAdminEmailCreateRequest {
  recipientEmail: string
  subject: string
  fromAddress: string
  fromName?: string
  textBody?: string
  htmlBody?: string
  /**
   * Optional React Email render input. When provided, `htmlBody` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput
  provider: string
  flow?: string
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailUpdateRequest {
  id: string
  recipientEmail?: string
  subject?: string
  fromAddress?: string
  fromName?: string | null
  textBody?: string | null
  htmlBody?: string | null
  /**
   * Optional React Email render input. When provided, `htmlBody` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput
  provider?: string
  flow?: string | null
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailUpdateResponse {
  email?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailDeleteRequest {
  id: string
}

export interface AthenaAdminEmailFailureListQuery {
  limit?: number
  offset?: number
  recipientEmail?: string
  provider?: string
  flow?: string
  resolved?: boolean
  createdAfter?: string
  createdBefore?: string
}

export interface AthenaAdminEmailFailureListResponse {
  total?: number
  limit?: number
  offset?: number
  emailSendFailures?: AthenaAuthLooseRecord[]
}

export interface AthenaAdminEmailFailureGetQuery {
  id: string
}

export interface AthenaAdminEmailFailureGetResponse {
  emailSendFailure?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailFailureCreateRequest {
  userId?: string
  recipientEmail: string
  flow: string
  provider?: string
  errorMessage: string
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailFailureUpdateRequest {
  id: string
  resolved?: boolean
  resolutionNote?: string | null
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailFailureUpdateResponse {
  emailSendFailure?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailFailureDeleteRequest {
  id: string
}

export interface AthenaAdminEmailTemplateListQuery {
  limit?: number
  offset?: number
  templateKey?: string
  locale?: string
  isActive?: boolean
}

export interface AthenaAdminEmailTemplateListResponse {
  total?: number
  limit?: number
  offset?: number
  emailTemplates?: AthenaAuthLooseRecord[]
}

export interface AthenaAdminEmailTemplateCreateRequest {
  templateKey: string
  locale?: string
  subjectTemplate: string
  textTemplate?: string
  htmlTemplate?: string
  /**
   * Optional React Email render input. When provided, `htmlTemplate` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput
  variables?: string[]
  isActive?: boolean
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailTemplateUpdateRequest {
  id: string
  templateKey?: string
  locale?: string
  subjectTemplate?: string
  textTemplate?: string | null
  htmlTemplate?: string | null
  /**
   * Optional React Email render input. When provided, `htmlTemplate` is derived automatically.
   */
  react?: AthenaAuthReactEmailRenderInput
  variables?: string[]
  isActive?: boolean
  metadata?: AthenaAuthLooseRecord
}

export interface AthenaAdminEmailTemplateDeleteRequest {
  id: string
}

export interface AthenaAdminEmailTemplateGetQuery {
  id: string
}

export interface AthenaAdminEmailTemplateGetResponse {
  emailTemplate?: AthenaAuthLooseRecord
}

export interface AthenaApiKeyCreateRequest {
  name?: string
  expiresIn: string
  userId?: string
  prefix?: string
  remaining: string
  metadata?: string
  refillAmount?: string
  refillInterval?: string
  rateLimitTimeWindow?: string
  rateLimitMax?: string
  rateLimitEnabled?: string
  permissions?: string
}

export interface AthenaApiKeyRecord {
  id: string
  name?: string | null
  start?: string | null
  prefix?: string | null
  userId: string
  refillInterval?: number | null
  refillAmount?: number | null
  lastRefillAt?: string | null
  enabled: boolean
  rateLimitEnabled: boolean
  rateLimitTimeWindow?: number | null
  rateLimitMax?: number | null
  requestCount: number
  remaining?: number | null
  lastRequest?: string | null
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
  metadata?: AthenaAuthLooseRecord | null
  permissions?: string | null
  key?: string
}

export interface AthenaApiKeyGetQuery {
  id?: string
}

export interface AthenaApiKeyUpdateRequest {
  keyId: string
  userId?: string
  name?: string
  enabled?: string
  remaining?: string
  refillAmount?: string
  refillInterval?: string
  metadata?: string
  expiresIn: string
  rateLimitEnabled?: string
  rateLimitTimeWindow?: string
  rateLimitMax?: string
  permissions: string
}

export interface AthenaApiKeyDeleteRequest {
  keyId: string
}

export interface AthenaApiKeyVerifyRequest {
  key: string
  permissions?: AthenaAuthLooseRecord
}

export interface AthenaApiKeyVerifyResponse {
  valid?: boolean
  error?: {
    message?: string
    code?: string
  } | null
  key?: AthenaAuthLooseRecord | null
}

export interface AthenaApiKeyDeleteAllExpiredResponse {
  deleted?: number
}

export interface AthenaAuthOrganizationCreateRequest {
  name: string
  slug: string
  logo?: string
  metadata?: Record<string, unknown>
  userId?: string
  keepCurrentActiveOrganization?: boolean
}

export interface AthenaAuthOrganizationCheckSlugRequest {
  slug: string
}

export interface AthenaAuthOrganizationSetActiveRequest {
  organizationId?: string | null
  organizationSlug?: string | null
}

export interface AthenaAuthOrganizationGetFullQuery {
  organizationId?: string
  organizationSlug?: string
  membersLimit?: number
}

export interface AthenaAuthOrganizationUpdateRequest {
  data: {
    name?: string
    slug?: string
    logo?: string
    metadata?: Record<string, unknown> | null
  }
  organizationId?: string
}

export interface AthenaAuthOrganizationDeleteRequest {
  organizationId: string
}

export interface AthenaAuthOrganizationInviteMemberRequest {
  email: string
  role: string | string[]
  organizationId?: string
  resend?: boolean
  teamId?: string
}

export interface AthenaAuthOrganizationInvitationActionRequest {
  invitationId: string
}

export interface AthenaAuthOrganizationGetInvitationQuery {
  id: string
}

export interface AthenaAuthOrganizationListInvitationsQuery {
  organizationId?: string
}

export interface AthenaAuthOrganizationListUserInvitationsQuery {
  email?: string
}

export type AthenaAuthOrganizationListMembersFilterOperator = AthenaAuthFilterOperator

export interface AthenaAuthOrganizationListMembersQuery {
  organizationId?: string
  limit?: number
  offset?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  filterField?: string
  filterOperator?: AthenaAuthOrganizationListMembersFilterOperator
  filterValue?: string | number | boolean | string[] | number[]
}

export interface AthenaAuthOrganizationRemoveMemberRequest {
  memberIdOrEmail: string
  organizationId?: string
}

export interface AthenaAuthOrganizationUpdateMemberRoleRequest {
  role: string | string[]
  memberId: string
  organizationId?: string
}

export interface AthenaAuthOrganizationAddMemberRequest {
  userId?: string | null
  role: string | string[]
  organizationId?: string
  teamId?: string
}

export interface AthenaAuthOrganizationLeaveRequest {
  organizationId: string
}

export interface AthenaAuthOrganizationCreateRoleRequest {
  role: string
  permission: Record<string, string[]>
  organizationId?: string
}

export interface AthenaAuthOrganizationRoleSelector {
  roleName?: string
  roleId?: string
  organizationId?: string
}

export interface AthenaAuthOrganizationListRolesQuery {
  organizationId?: string
}

export interface AthenaAuthOrganizationUpdateRoleRequest extends AthenaAuthOrganizationRoleSelector {
  data: {
    permission?: Record<string, string[]>
    roleName?: string
  }
}

export interface AthenaAuthOrganizationCreateTeamRequest {
  name: string
  organizationId?: string
}

export interface AthenaAuthOrganizationListTeamsQuery {
  organizationId?: string
}

export interface AthenaAuthOrganizationUpdateTeamRequest {
  teamId: string
  data: {
    name?: string
    organizationId?: string
    createdAt?: string | Date
    updatedAt?: string | Date
  }
}

export interface AthenaAuthOrganizationRemoveTeamRequest {
  teamId: string
  organizationId?: string
}

export interface AthenaAuthOrganizationSetActiveTeamRequest {
  teamId: string
}

export interface AthenaAuthOrganizationListTeamMembersQuery {
  teamId?: string
}

export interface AthenaAuthOrganizationTeamMemberRequest {
  teamId: string
  userId: string
}

export interface AthenaAuthRequestInput {
  endpoint: AthenaAuthEndpointPath
  method?: AthenaAuthMethod
  body?: unknown
  query?: Record<string, AthenaAuthQueryValue>
  fetchOptions?: AthenaAuthCallOptions
}

export interface AthenaAuthCallOptions {
  baseUrl?: string
  apiKey?: string
  bearerToken?: string
  cookie?: string
  sessionToken?: string
  forceNoCache?: boolean
  headers?: Record<string, string>
  credentials?: AthenaAuthCredentials
  signal?: AbortSignal
}

export interface AthenaAuthFetchCompatibleInput {
  fetchOptions?: AthenaAuthCallOptions
}

export interface AthenaAuthClientConfig extends AthenaAuthCallOptions {
  fetch?: typeof fetch
  reactEmail?: AthenaAuthReactEmailConfig
}

export type AthenaAuthGuardReason =
  | 'unauthorized'
  | 'forbidden'
  | 'upstream_error'

export interface AthenaAuthGuardSuccess {
  ok: true
  session: AthenaAuthSessionResponse
}

export interface AthenaAuthGuardFailure {
  ok: false
  reason: AthenaAuthGuardReason
  status: number
  error: string
  sessionResult?: AthenaAuthResult<AthenaAuthSessionResponse>
  permissionResult?: AthenaAuthResult<AthenaAdminHasPermissionResponse>
}

export type AthenaAuthGuardResult =
  | AthenaAuthGuardSuccess
  | AthenaAuthGuardFailure

export interface AthenaAuthEmailTemplateDefinition<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> {
  component: AthenaAuthReactEmailComponent<TProps>
  templateKey?: string
  subjectTemplate?: string
  defaults?: AthenaAuthReactEmailRenderOptions
}

export interface AthenaAuthEmailTemplateReactOverrides {
  pretty?: boolean
  text?: string
  includePlainText?: boolean
}

export interface AthenaAuthEmailTemplateCreateFromDefinitionInput<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> extends Omit<
    AthenaAdminEmailTemplateCreateRequest,
    'react' | 'htmlTemplate' | 'textTemplate' | 'variables' | 'templateKey' | 'subjectTemplate'
  > {
  props: TProps
  templateKey?: string
  subjectTemplate?: string
  react?: AthenaAuthEmailTemplateReactOverrides
}

export interface AthenaAuthEmailTemplateUpdateFromDefinitionInput<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> extends Omit<
    AthenaAdminEmailTemplateUpdateRequest,
    'react' | 'htmlTemplate' | 'textTemplate' | 'variables'
  > {
  props: TProps
  react?: AthenaAuthEmailTemplateReactOverrides
}

export interface AthenaAuthEmailTemplateBuilder<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
> {
  component: AthenaAuthReactEmailComponent<TProps>
  react: (
    props: TProps,
    overrides?: AthenaAuthEmailTemplateReactOverrides,
  ) => AthenaAuthReactEmailRenderInput
  toTemplateCreate: (
    input: AthenaAuthEmailTemplateCreateFromDefinitionInput<TProps>,
  ) => AthenaAdminEmailTemplateCreateRequest
  toTemplateUpdate: (
    input: AthenaAuthEmailTemplateUpdateFromDefinitionInput<TProps>,
  ) => AthenaAdminEmailTemplateUpdateRequest
}

export type AthenaAuthGenericInput = AthenaAuthFetchCompatibleInput & Record<string, unknown>
export type AthenaAuthGenericQueryInput = AthenaAuthFetchCompatibleInput & {
  query?: Record<string, AthenaAuthQueryValue>
}

export type AthenaAuthResetPasswordBinding = ((
  input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>) & {
  token: (
    input: { token: string; callbackURL?: string } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ token?: string }>>
}

export type AthenaAuthSessionRevokeBinding = (
  input:
    | (AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput)
    | (AthenaAuthRevokeSessionRequest[] & AthenaAuthFetchCompatibleInput),
  options?: AthenaAuthCallOptions,
) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>

export type AthenaAuthAdminUserSessionRevokeBinding = (
  input:
    | (AthenaAdminRevokeUserSessionRequest & AthenaAuthFetchCompatibleInput)
    | (AthenaAdminRevokeUserSessionsRequest & AthenaAuthFetchCompatibleInput)
    | ({ sessions: AthenaAdminRevokeUserSessionRequest[] } & AthenaAuthFetchCompatibleInput)
    | ((AthenaAdminRevokeUserSessionRequest & AthenaAuthFetchCompatibleInput)[]),
  options?: AthenaAuthCallOptions,
) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>

export interface AthenaAuthOrganizationBindings {
  /** Create an organization. Route: `POST /organization/create`. */
  create: (
    input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization>>
  /** Update an organization. Route: `POST /organization/update`. */
  update: (
    input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization>>
  /** Delete an organization. Route: `POST /organization/delete`. */
  delete: (
    input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  /** Set active organization for current session. Route: `POST /organization/set-active`. */
  setActive: (
    input: AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  /** List organizations visible to the current user. Route: `GET /organization/list`. */
  list: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>
  /** Get organization details including related members/invitations. Route: `GET /organization/get-full-organization`. */
  getFull: (
    input?: { query?: AthenaAuthOrganizationGetFullQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{
    organization: AthenaAuthOrganization
    members?: AthenaAuthOrganizationMember[]
    invitations?: AthenaAuthOrganizationInvitation[]
  }>>
  /** Check if an organization slug is available. Route: `POST /organization/check-slug`. */
  checkSlug: (
    input: AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ available: boolean }>>
  /** Leave an organization. Route: `POST /organization/leave`. */
  leave: (
    input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  /** List invitations for the current user. Route: `GET /organization/list-user-invitations`. */
  listUserInvitations: (
    input?: { query?: AthenaAuthOrganizationListUserInvitationsQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>
  /** Check organization-level permissions for the current principal. Route: `POST /organization/has-permission`. */
  hasPermission: (
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>
  /** Resolve the current session and require organization-level permissions in one call. */
  requirePermission: (
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthGuardResult>
  invitation: {
    /** Cancel an organization invitation. Route: `POST /organization/cancel-invitation`. */
    cancel: (
      input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    /** Accept an organization invitation. Route: `POST /organization/accept-invitation`. */
    accept: (
      input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    /** Get an invitation by id. Route: `GET /organization/get-invitation`. */
    get: (
      input: { query: AthenaAuthOrganizationGetInvitationQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>
    /** Reject an organization invitation. Route: `POST /organization/reject-invitation`. */
    reject: (
      input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    /** List invitations for an organization. Route: `GET /organization/list-invitations`. */
    list: (
      input?: { query?: AthenaAuthOrganizationListInvitationsQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>
  }
  member: {
    /** Remove an organization member. Route: `POST /organization/remove-member`. */
    remove: (
      input: AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    /** Update a member role. Route: `POST /organization/update-member-role`. */
    updateRole: (
      input: AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    /** Invite a member to an organization. Route: `POST /organization/invite-member`. */
    invite: (
      input: AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>
    /** Get the active organization member context for the current session. Route: `GET /organization/get-active-member`. */
    getActive: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>
    /** List organization members. Route: `GET /organization/list-members`. */
    list: (
      input?: { query?: AthenaAuthOrganizationListMembersQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>
  }
}

export interface AthenaAuthBindings {
  /** Get current session. Route: `GET /get-session`. */
  getSession: AthenaAuthSdkClient['getSession']
  /** Get current user as a Better Auth-style compatibility projection. Route: `GET /get-session`. */
  getUser: AthenaAuthSdkClient['getUser']
  /** Resolve the current session into a typed guard result. */
  requireSession: AthenaAuthSdkClient['requireSession']
  /** Sign out current session. Route: `POST /sign-out`. */
  signOut: AthenaAuthSdkClient['signOut']
  /** Trigger password reset email flow. Route: `POST /forget-password`. */
  forgetPassword: AthenaAuthSdkClient['forgetPassword']
  /** Reset password (`POST /reset-password`) and token resolver (`GET /reset-password/{token}`). */
  resetPassword: AthenaAuthResetPasswordBinding
  /** Set password for the current authenticated user. Route: `POST /set-password`. */
  setPassword: (
    input: AthenaSetPasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  /** Verify email token. Route: `GET /verify-email`. */
  verifyEmail: AthenaAuthSdkClient['verifyEmail']
  /** Send verification email. Route: `POST /send-verification-email`. */
  sendVerificationEmail: AthenaAuthSdkClient['sendVerificationEmail']
  /** Start change-email flow. Route: `POST /change-email`. */
  changeEmail: AthenaAuthSdkClient['changeEmail']
  /** Verify pending email change. Route: `GET /change-email/verify`. */
  changeEmailVerify: (
    input: { query: AthenaAuthTokenQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>
  /** Verify pending delete-user flow. Route: `GET /delete-user/verify`. */
  deleteUserVerify: (
    input: { query: AthenaAuthTokenQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>
  /** Change current user password. Route: `POST /change-password`. */
  changePassword: AthenaAuthSdkClient['changePassword']
  user: {
    /** Update current user profile fields. Route: `POST /update-user`. */
    update: AthenaAuthSdkClient['updateUser']
    /** Delete current user. Route: `POST /delete-user`. */
    delete: AthenaAuthSdkClient['deleteUser']
    email: {
      /**
       * List email identities for current user.
       * Routes: primary `GET /email/list`; falls back to `GET /email-list` on `404`.
       */
      list: (
        input?: { query?: AthenaAuthEmailListQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAuthEmailListResponse>>
    }
  }
  session: {
    /** List user sessions. Route: `GET /list-sessions`. */
    list: AthenaAuthSdkClient['listSessions']
    /** Revoke one or multiple sessions; collapses to `/revoke-session` or `/revoke-sessions` by payload shape. */
    revoke: AthenaAuthSessionRevokeBinding
    /** Revoke all other sessions for current user. Route: `POST /revoke-other-sessions`. */
    revokeOther: AthenaAuthSdkClient['revokeOtherSessions']
  }
  social: {
    /** Link a social provider to current user. Route: `POST /link-social`. */
    link: AthenaAuthSdkClient['linkSocial']
  }
  account: {
    /** List linked provider accounts. Route: `GET /list-accounts`. */
    list: AthenaAuthSdkClient['listAccounts']
    /** Unlink a provider account. Route: `POST /unlink-account`. */
    unlink: AthenaAuthSdkClient['unlinkAccount']
  }
  deleteUser: {
    /** Callback endpoint for delete-user verification flows. Route: `GET /delete-user/callback`. */
    callback: AthenaAuthSdkClient['deleteUserCallback']
  }
  /** Refresh provider token. Route: `POST /refresh-token`. */
  refreshToken: AthenaAuthSdkClient['refreshToken']
  /** Get provider access token. Route: `POST /get-access-token`. */
  getAccessToken: AthenaAuthSdkClient['getAccessToken']
  /** Auth health route. Primary `GET /health`; falls back to `GET /ok` on `404`. */
  health: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthHealthResponse>>
  /** Health route passthrough. Route: `GET /ok`. */
  ok: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOkResponse>>
  /** Error route passthrough. Route: `GET /error`. */
  error: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthErrorResponse | string>>
  twoFactor: {
    /** Get TOTP URI for setup. Route: `POST /two-factor/get-totp-uri`. */
    getTotpUri: (
      input: AthenaTwoFactorGetTotpUriRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorGetTotpUriResponse>>
    /** Verify TOTP code. Route: `POST /two-factor/verify-totp`. */
    verifyTotp: (
      input: AthenaTwoFactorVerifyTotpRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyTotpResponse>>
    /** Send one-time passcode (OTP). Route: `POST /two-factor/send-otp`. */
    sendOtp: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    /** Verify OTP code. Route: `POST /two-factor/verify-otp`. */
    verifyOtp: (
      input: AthenaTwoFactorVerifyOtpRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyOtpResponse>>
    /** Verify backup code. Route: `POST /two-factor/verify-backup-code`. */
    verifyBackupCode: (
      input: AthenaTwoFactorVerifyBackupCodeRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyBackupCodeResponse>>
    /** Generate backup codes. Route: `POST /two-factor/generate-backup-codes`. */
    generateBackupCodes: (
      input: AthenaTwoFactorGenerateBackupCodesRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorGenerateBackupCodesResponse>>
    /** Enable two-factor auth. Route: `POST /two-factor/enable`. */
    enable: (
      input: AthenaTwoFactorEnableRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorEnableResponse>>
    /** Disable two-factor auth. Route: `POST /two-factor/disable`. */
    disable: (
      input: AthenaTwoFactorDisableRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaTwoFactorDisableResponse>>
  }
  passkey: {
    /** Generate WebAuthn registration options. Route: `GET /passkey/generate-register-options`. */
    generateRegisterOptions: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>
    /** Generate WebAuthn authentication options. Route: `POST /passkey/generate-authenticate-options`. */
    generateAuthenticateOptions: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>
    /** Verify passkey registration response. Route: `POST /passkey/verify-registration`. */
    verifyRegistration: (
      input: AthenaPasskeyVerifyRegistrationRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>
    /** Verify passkey authentication response. Route: `POST /passkey/verify-authentication`. */
    verifyAuthentication: (
      input: AthenaPasskeyVerifyAuthenticationRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>
    /** List current user's passkeys. Route: `GET /passkey/list-user-passkeys`. */
    listUserPasskeys: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>
    /** Delete a passkey. Route: `POST /passkey/delete-passkey`. */
    deletePasskey: (
      input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>
    /** Update a passkey metadata record. Route: `POST /passkey/update-passkey`. */
    updatePasskey: (
      input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>
    /** Return related origins for WebAuthn. Route: `GET /.well-known/webauthn`. */
    getRelatedOrigins: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<{ origins?: string[] }>>
  }
  admin: {
    role: {
      /** Set a user role. Route: `POST /admin/set-role`. */
      set: (
        input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>
    }
    user: {
      /** List users. Route: `GET /admin/list-users`. */
      list: (
        input?: { query?: AthenaAdminListUsersQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>
      /** Create user. Route: `POST /admin/create-user`. */
      create: (
        input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>
      /** Unban user. Route: `POST /admin/unban-user`. */
      unban: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>
      /** Ban user. Route: `POST /admin/ban-user`. */
      ban: (
        input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>
      /** Start impersonation. Route: `POST /admin/impersonate-user`. */
      impersonate: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>
      /** Stop impersonation. Route: `POST /admin/stop-impersonating`. */
      stopImpersonating: (
        input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>
      /** Remove user. Route: `POST /admin/remove-user`. */
      remove: (
        input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
      /** Set user password. Route: `POST /admin/set-user-password`. */
      setPassword: (
        input: AthenaAdminSetUserPasswordRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
      session: {
        /** List sessions for a target user. Route: `POST /admin/list-user-sessions`. */
        list: (
          input: AthenaAdminListUserSessionsRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminListUserSessionsResponse>>
        /**
         * Revoke one or multiple sessions; collapses to `/admin/revoke-user-session` or
         * `/admin/revoke-user-sessions`. `userId` is required and plural payloads must share one `userId`.
         */
        revoke: AthenaAuthAdminUserSessionRevokeBinding
      }
    }
    /** Check permission under admin policy. Route: `POST /admin/has-permission`. */
    hasPermission: (
      input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>
    /** Resolve the current session and require admin permissions in one call. */
    requirePermission: (
      input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthGuardResult>
    apiKey: {
      /** Create admin-scoped API key. Route: `POST /admin/api-key/create`. */
      create: (
        input?: AthenaAdminApiKeyCreateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminApiKeyCreateResponse>>
    }
    athenaClient: {
      /** Create Athena client credentials. Route: `POST /admin/athena-client/create`. */
      create: (
        input: AthenaAdminAthenaClientCreateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>
      /** List Athena client credentials. Route: `GET /admin/athena-client/list`. */
      list: (
        input?: AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminAthenaClientListResponse>>
    }
    auditLog: {
      /** List auth audit events. Route: `GET /admin/audit-log/list`. */
      list: (
        input?: { query?: AthenaAdminAuditLogListQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminAuditLogListResponse>>
    }
    email: {
      /** List emails. Route: `GET /admin/email/list`. */
      list: (
        input?: { query?: AthenaAdminEmailListQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminEmailListResponse>>
      /** Get a specific email record. Route: `GET /admin/email/get`. */
      get: (
        input: { query: AthenaAdminEmailGetQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminEmailGetResponse>>
      /** Create an email record. Route: `POST /admin/email/create`. */
      create: (
        input: AthenaAdminEmailCreateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
      /** Update an email record. Route: `POST /admin/email/update`. */
      update: (
        input: AthenaAdminEmailUpdateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminEmailUpdateResponse>>
      /** Delete an email record. Route: `POST /admin/email/delete`. */
      delete: (
        input: AthenaAdminEmailDeleteRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
      failure: {
        /** List email failure records. Route: `GET /admin/email-failure/list`. */
        list: (
          input?: { query?: AthenaAdminEmailFailureListQuery } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminEmailFailureListResponse>>
        /** Get an email failure record. Route: `GET /admin/email-failure/get`. */
        get: (
          input: { query: AthenaAdminEmailFailureGetQuery } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminEmailFailureGetResponse>>
        /** Create an email failure record. Route: `POST /admin/email-failure/create`. */
        create: (
          input: AthenaAdminEmailFailureCreateRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
        /** Update an email failure record. Route: `POST /admin/email-failure/update`. */
        update: (
          input: AthenaAdminEmailFailureUpdateRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminEmailFailureUpdateResponse>>
        /** Delete an email failure record. Route: `POST /admin/email-failure/delete`. */
        delete: (
          input: AthenaAdminEmailFailureDeleteRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
      }
      template: {
        /** List email templates. Route: `GET /admin/email-template/list`. */
        list: (
          input?: { query?: AthenaAdminEmailTemplateListQuery } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>
        /** Get email template by ID. Route: `GET /admin/email-template/get`. */
        get: (
          input: { query: AthenaAdminEmailTemplateGetQuery } & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>
        /** Create email template. Route: `POST /admin/email-template/create`. */
        create: (
          input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>
        /** Update email template. Route: `POST /admin/email-template/update`. */
        update: (
          input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>
        /** Delete email template. Route: `POST /admin/email-template/delete`. */
        delete: (
          input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput,
          options?: AthenaAuthCallOptions,
        ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
      }
    }
    emailTemplate: {
      /** Get email template by ID. Route: `GET /admin/email-template/get`. */
      get: (
        input: { query: AthenaAdminEmailTemplateGetQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>
      /** Create email template. Route: `POST /admin/email-template/create`. */
      create: (
        input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>
      /** Delete email template. Route: `POST /admin/email-template/delete`. */
      delete: (
        input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
      /** List email templates. Route: `GET /admin/email-template/list`. */
      list: (
        input?: { query?: AthenaAdminEmailTemplateListQuery } & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>
      /** Update email template. Route: `POST /admin/email-template/update`. */
      update: (
        input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>
    }
  }
  apiKey: {
    /** Create API key. Route: `POST /api-key/create`. */
    create: (
      input: AthenaApiKeyCreateRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>
    /** Get API key metadata. Route: `GET /api-key/get`. */
    get: (
      input?: { query?: AthenaApiKeyGetQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>
    /** Update API key metadata. Route: `POST /api-key/update`. */
    update: (
      input: AthenaApiKeyUpdateRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>
    /** Delete API key. Route: `POST /api-key/delete`. */
    delete: (
      input: AthenaApiKeyDeleteRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>
    /** List API keys. Route: `GET /api-key/list`. */
    list: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaApiKeyRecord[]>>
    /** Verify an API key. Route: `POST /api-key/verify`. */
    verify: (
      input: AthenaApiKeyVerifyRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaApiKeyVerifyResponse>>
    /** Delete all expired API keys. Route: `POST /api-key/delete-all-expired-api-keys`. */
    deleteAllExpired: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaApiKeyDeleteAllExpiredResponse>>
  }
  signIn: {
    /** Sign in with email and password. Route: `POST /sign-in/email`. */
    email: AthenaAuthSdkClient['signIn']['email']
    /** Sign in with username and password. Route: `POST /sign-in/username`. */
    username: AthenaAuthSdkClient['signIn']['username']
    /** Sign in with social provider. Route: `POST /sign-in/social`. */
    social: AthenaAuthSdkClient['signIn']['social']
  }
  signUp: {
    /** Sign up with email/password identity. Route: `POST /sign-up/email`. */
    email: AthenaAuthSdkClient['signUp']['email']
  }
  /** Organization plugin helper surface. Routes: `/organization/*`. */
  organization: AthenaAuthOrganizationBindings
  callback: {
    /** OAuth provider callback passthrough. Route: `GET /callback/{provider}`. */
    provider: (
      input: AthenaAuthCallbackProviderRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthCallbackProviderResponse>>
  }
}

export interface AthenaAuthSdkClient {
  baseUrl: string
  request: <T = unknown>(
    input: AthenaAuthRequestInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<T>>
  signIn: {
    email: (
      input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>
    username: (
      input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>
    social: (
      input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse | AthenaAuthSignInResponse>>
  }
  signUp: {
    email: (
      input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>
  }
  signOut: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>
  logout: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>
  getSession: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>
  getUser: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthGetUserResponse>>
  requireSession: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthGuardResult>
  listSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthSession[]>>
  revokeSession: (
    input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  clearSession: (
    input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  revokeSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  clearSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  revokeOtherSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  clearOtherSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  forgetPassword: (
    input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  resetPassword: (
    input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  resolveResetPasswordToken: (
    input: { token: string; callbackURL?: string } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ token?: string }>>
  verifyEmail: (
    input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean }>>
  sendVerificationEmail: (
    input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  changeEmail: (
    input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthEmailChangeResponse>>
  changePassword: (
    input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ token?: string | null; user: AthenaAuthUser }>>
  updateUser: (
    input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  deleteUser: (
    input?: AthenaDeleteUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>
  deleteUserCallback: (
    input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>
  linkSocial: (
    input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>
  listAccounts: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>
  unlinkAccount: (
    input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  refreshToken: (
    input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>
  getAccessToken: (
    input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>
  organization: AthenaAuthOrganizationBindings
  auth: AthenaAuthBindings
}
