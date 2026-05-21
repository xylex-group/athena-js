export type AthenaAuthMethod = 'GET' | 'POST'
export type AthenaAuthCredentials = 'omit' | 'same-origin' | 'include'

export type AthenaAuthEndpointPath =
  | '/sign-in/email'
  | '/sign-up/email'
  | '/get-session'
  | '/sign-out'
  | '/list-sessions'
  | '/revoke-session'
  | '/revoke-sessions'

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

export interface AthenaEmailSignInRequest {
  email: string
  password: string
  callbackURL?: string
  rememberMe?: boolean
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

export interface AthenaAuthSignOutResponse {
  success: boolean
}

export interface AthenaAuthRevokeSessionRequest {
  token: string
}

export interface AthenaAuthRevokeSessionResponse {
  status: boolean
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

export interface AthenaAuthSdkClient {
  baseUrl: string
  signIn: {
    email: (
      input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>
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
  ) => Promise<AthenaAuthResult<AthenaAuthRevokeSessionResponse>>
  revokeSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthRevokeSessionResponse>>
  clearSession: (
    input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthRevokeSessionResponse>>
  clearSessions: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthRevokeSessionResponse>>
  logout: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>
}
