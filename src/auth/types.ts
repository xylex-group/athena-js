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

export type AthenaAuthOrganizationListMembersFilterOperator =
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
  headers?: Record<string, string>
  credentials?: AthenaAuthCredentials
  signal?: AbortSignal
}

export interface AthenaAuthFetchCompatibleInput {
  fetchOptions?: AthenaAuthCallOptions
}

export interface AthenaAuthClientConfig extends AthenaAuthCallOptions {
  fetch?: typeof fetch
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
    | (AthenaAuthGenericInput & { sessionToken?: string; sessionId?: string; userId?: string })
    | ((AthenaAuthGenericInput & { sessionToken?: string; sessionId?: string; userId?: string })[]),
  options?: AthenaAuthCallOptions,
) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>

export interface AthenaAuthOrganizationBindings {
  create: (
    input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization>>
  update: (
    input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization>>
  delete: (
    input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  setActive: (
    input: AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  list: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>
  getFull: (
    input?: { query?: AthenaAuthOrganizationGetFullQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{
    organization: AthenaAuthOrganization
    members?: AthenaAuthOrganizationMember[]
    invitations?: AthenaAuthOrganizationInvitation[]
  }>>
  checkSlug: (
    input: AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ available: boolean }>>
  leave: (
    input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  listUserInvitations: (
    input?: { query?: AthenaAuthOrganizationListUserInvitationsQuery } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>
  hasPermission: (
    input: AthenaAuthGenericInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<{ success?: boolean; error?: string }>>
  invitation: {
    cancel: (
      input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    accept: (
      input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    get: (
      input: { query: AthenaAuthOrganizationGetInvitationQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>
    reject: (
      input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    list: (
      input?: { query?: AthenaAuthOrganizationListInvitationsQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>
  }
  member: {
    remove: (
      input: AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    updateRole: (
      input: AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
    invite: (
      input: AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>
    getActive: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>
    list: (
      input?: { query?: AthenaAuthOrganizationListMembersQuery } & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>
  }
}

export interface AthenaAuthBindings {
  getSession: AthenaAuthSdkClient['getSession']
  signOut: AthenaAuthSdkClient['signOut']
  forgetPassword: AthenaAuthSdkClient['forgetPassword']
  resetPassword: AthenaAuthResetPasswordBinding
  setPassword: (
    input: AthenaAuthGenericInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  verifyEmail: AthenaAuthSdkClient['verifyEmail']
  sendVerificationEmail: AthenaAuthSdkClient['sendVerificationEmail']
  changeEmail: AthenaAuthSdkClient['changeEmail']
  changeEmailVerify: (
    input: AthenaAuthGenericQueryInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  deleteUserVerify: (
    input: AthenaAuthGenericQueryInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>
  changePassword: AthenaAuthSdkClient['changePassword']
  user: {
    update: AthenaAuthSdkClient['updateUser']
    delete: AthenaAuthSdkClient['deleteUser']
    email: {
      list: (
        input?: AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) => Promise<AthenaAuthResult<unknown[]>>
    }
  }
  session: {
    list: AthenaAuthSdkClient['listSessions']
    revoke: AthenaAuthSessionRevokeBinding
    revokeOther: AthenaAuthSdkClient['revokeOtherSessions']
  }
  social: {
    link: AthenaAuthSdkClient['linkSocial']
  }
  account: {
    list: AthenaAuthSdkClient['listAccounts']
    unlink: AthenaAuthSdkClient['unlinkAccount']
  }
  deleteUser: {
    callback: AthenaAuthSdkClient['deleteUserCallback']
  }
  refreshToken: AthenaAuthSdkClient['refreshToken']
  getAccessToken: AthenaAuthSdkClient['getAccessToken']
  ok: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<unknown>>
  error: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<unknown>>
  twoFactor: {
    getTotpUri: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    verifyTotp: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    sendOtp: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    verifyOtp: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    verifyBackupCode: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    generateBackupCodes: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    enable: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    disable: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
  }
  passkey: {
    generateRegisterOptions: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    generateAuthenticateOptions: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    verifyRegistration: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    verifyAuthentication: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    listUserPasskeys: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
    deletePasskey: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    updatePasskey: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    getRelatedOrigins: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ origins?: string[] }>>
  }
  admin: {
    role: {
      set: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    }
    user: {
      list: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
      create: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      unban: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      ban: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      impersonate: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      stopImpersonating: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      remove: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      setPassword: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      session: {
        list: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
        revoke: AthenaAuthAdminUserSessionRevokeBinding
      }
    }
    hasPermission: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ success?: boolean; error?: string }>>
    apiKey: {
      create: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    }
    athenaClient: {
      create: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      list: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
    }
    auditLog: {
      list: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
    }
    emailTemplate: {
      create: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      delete: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
      list: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
      update: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    }
    email: {
      list: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
    }
  }
  apiKey: {
    create: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    get: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    update: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    delete: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    list: (input?: AthenaAuthGenericQueryInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown[]>>
    verify: (input: AthenaAuthGenericInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
    deleteAllExpired: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
  }
  signIn: AthenaAuthSdkClient['signIn']
  signUp: AthenaAuthSdkClient['signUp']
  organization: AthenaAuthOrganizationBindings
  callback: {
    provider: (input: { provider: string } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>
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
