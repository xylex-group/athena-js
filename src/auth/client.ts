import type {
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthLinkedAccount,
  AthenaAuthOrganization,
  AthenaAuthOrganizationAddMemberRequest,
  AthenaAuthOrganizationCreateRequest,
  AthenaAuthOrganizationCreateRoleRequest,
  AthenaAuthOrganizationCreateTeamRequest,
  AthenaAuthOrganizationDeleteRequest,
  AthenaAuthOrganizationGetFullQuery,
  AthenaAuthOrganizationGetInvitationQuery,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationInvitationActionRequest,
  AthenaAuthOrganizationInviteMemberRequest,
  AthenaAuthOrganizationLeaveRequest,
  AthenaAuthOrganizationListInvitationsQuery,
  AthenaAuthOrganizationListMembersQuery,
  AthenaAuthOrganizationListRolesQuery,
  AthenaAuthOrganizationListTeamMembersQuery,
  AthenaAuthOrganizationListTeamsQuery,
  AthenaAuthOrganizationListUserInvitationsQuery,
  AthenaAuthOrganizationMember,
  AthenaAuthOrganizationRemoveMemberRequest,
  AthenaAuthOrganizationRemoveTeamRequest,
  AthenaAuthOrganizationRole,
  AthenaAuthOrganizationRoleSelector,
  AthenaAuthOrganizationSetActiveRequest,
  AthenaAuthOrganizationSetActiveTeamRequest,
  AthenaAuthOrganizationTeam,
  AthenaAuthOrganizationTeamMemberRequest,
  AthenaAuthOrganizationUpdateMemberRoleRequest,
  AthenaAuthOrganizationUpdateRequest,
  AthenaAuthOrganizationUpdateRoleRequest,
  AthenaAuthOrganizationUpdateTeamRequest,
  AthenaAuthMethod,
  AthenaAuthQueryValue,
  AthenaAuthRequestInput,
  AthenaAuthResult,
  AthenaAuthSdkClient,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthSignInResponse,
  AthenaAuthSignOutResponse,
  AthenaAuthSocialRedirectResponse,
  AthenaAuthStatusResponse,
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
  AthenaResetPasswordRequest,
  AthenaSendVerificationEmailRequest,
  AthenaSocialSignInRequest,
  AthenaUnlinkAccountRequest,
  AthenaUpdateUserRequest,
  AthenaVerifyEmailRequest,
  AthenaUsernameSignInRequest,
} from './types.ts'

const DEFAULT_AUTH_BASE_URL = 'http://localhost:3001/api/auth'
const FALLBACK_SDK_VERSION = '1.0.0'
const SDK_NAME = 'xylex-group/athena-auth'

const SDK_VERSION =
  typeof process !== 'undefined' && process?.env?.npm_package_version
    ? process.env.npm_package_version
    : FALLBACK_SDK_VERSION
const SDK_HEADER_VALUE = `${SDK_NAME} ${SDK_VERSION}`

type AuthRequestContext = {
  endpoint: AthenaAuthEndpointPath
  method: AthenaAuthMethod
}

type InternalErrorInput = AuthRequestContext & {
  code: AthenaAuthErrorCode
  status: number
  message: string
  requestId?: string
  hint?: string
  cause?: string
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_AUTH_BASE_URL).replace(/\/$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeHeaderValue(value?: string | null): string | undefined {
  return value ? value : undefined
}

function parseResponseBody(rawText: string, contentType: string | null) {
  if (!rawText) {
    return { parsed: null as unknown, parseFailed: false }
  }

  const contentTypeSuggestsJson =
    contentType?.toLowerCase().includes('application/json') ?? false
  const looksJson =
    contentTypeSuggestsJson || rawText.startsWith('{') || rawText.startsWith('[')

  if (!looksJson) {
    return { parsed: rawText as unknown, parseFailed: false }
  }

  try {
    return { parsed: JSON.parse(rawText) as unknown, parseFailed: false }
  } catch {
    return { parsed: rawText as unknown, parseFailed: true }
  }
}

function resolveRequestId(headers: Headers): string | undefined {
  return (
    headers.get('x-request-id') ??
    headers.get('x-correlation-id') ??
    headers.get('x-athena-request-id') ??
    undefined
  )
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    const messageCandidates = [payload.error, payload.message, payload.details]
    for (const candidate of messageCandidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim()
      }
    }
  }

  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim()
  }

  return fallback
}

function toErrorDetails(input: InternalErrorInput): AthenaAuthErrorDetails {
  return {
    code: input.code,
    message: input.message,
    status: input.status,
    endpoint: input.endpoint,
    method: input.method,
    requestId: input.requestId,
    hint: input.hint,
    cause: input.cause,
  }
}

function mergeCallOptions(
  base?: AthenaAuthCallOptions,
  override?: AthenaAuthCallOptions,
): AthenaAuthCallOptions | undefined {
  if (!base && !override) return undefined
  return {
    ...base,
    ...override,
    headers: {
      ...(base?.headers ?? {}),
      ...(override?.headers ?? {}),
    },
  }
}

function extractFetchOptions<T extends AthenaAuthFetchCompatibleInput | undefined>(input: T) {
  if (!input) {
    return {
      payload: undefined,
      fetchOptions: undefined,
    }
  }

  const { fetchOptions, ...rest } = input
  const hasPayloadKeys = Object.keys(rest).length > 0
  return {
    payload: hasPayloadKeys ? rest : undefined,
    fetchOptions,
  }
}

function buildHeaders(
  config: AthenaAuthClientConfig,
  options?: AthenaAuthCallOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Athena-Sdk': SDK_HEADER_VALUE,
  }

  const apiKey = options?.apiKey ?? config.apiKey
  if (apiKey) {
    headers.apikey = apiKey
    headers['x-api-key'] = apiKey
  }

  const bearerToken = options?.bearerToken ?? config.bearerToken
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  }

  const mergedExtraHeaders = {
    ...(config.headers ?? {}),
    ...(options?.headers ?? {}),
  }

  Object.entries(mergedExtraHeaders).forEach(([key, value]) => {
    const normalized = normalizeHeaderValue(value)
    if (normalized) {
      headers[key] = normalized
    }
  })

  return headers
}

function appendQueryParam(searchParams: URLSearchParams, key: string, value: AthenaAuthQueryValue) {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach(item => {
      searchParams.append(key, String(item))
    })
    return
  }
  searchParams.append(key, String(value))
}

function buildRequestUrl(
  baseUrl: string,
  endpoint: AthenaAuthEndpointPath,
  query?: Record<string, AthenaAuthQueryValue>,
) {
  const url = `${baseUrl}${endpoint}`
  if (!query || Object.keys(query).length === 0) return url
  const searchParams = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => appendQueryParam(searchParams, key, value))
  const queryText = searchParams.toString()
  return queryText ? `${url}?${queryText}` : url
}

function inferDefaultMethod(endpoint: AthenaAuthEndpointPath): AthenaAuthMethod {
  if (endpoint.startsWith('/reset-password/')) {
    return 'GET'
  }

  switch (endpoint) {
    case '/get-session':
    case '/list-sessions':
    case '/verify-email':
    case '/delete-user/callback':
    case '/list-accounts':
    case '/ok':
    case '/error':
      return 'GET'
    default:
      return 'POST'
  }
}

async function callAuthEndpoint<T>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  body?: unknown,
  query?: Record<string, AthenaAuthQueryValue>,
  options?: AthenaAuthCallOptions,
): Promise<AthenaAuthResult<T>> {
  const baseUrl = normalizeBaseUrl(options?.baseUrl ?? config.baseUrl)
  const url = buildRequestUrl(baseUrl, context.endpoint, query)
  const headers = buildHeaders(config, options)
  const credentials = options?.credentials ?? config.credentials ?? 'include'
  const requestInit: RequestInit = {
    method: context.method,
    headers,
    credentials,
    signal: options?.signal,
  }

  if (context.method !== 'GET') {
    requestInit.body = JSON.stringify(body ?? {})
  }

  const fetcher = config.fetch ?? globalThis.fetch
  if (!fetcher) {
    const details = toErrorDetails({
      code: 'UNKNOWN_ERROR',
      message: 'No fetch implementation available for auth client',
      status: 0,
      endpoint: context.endpoint,
      method: context.method,
      hint: 'Use Node 18+ or provide `fetch` in createAuthClient({ fetch })',
    })
    return {
      ok: false,
      status: 0,
      data: null,
      error: details.message,
      errorDetails: details,
      raw: null,
    }
  }

  try {
    const response = await fetcher(url, requestInit)
    const rawText = await response.text()
    const requestId = resolveRequestId(response.headers)
    const parsedBody = parseResponseBody(rawText ?? '', response.headers.get('content-type'))

    if (parsedBody.parseFailed) {
      const details = toErrorDetails({
        code: 'INVALID_JSON',
        message: 'Auth server returned malformed JSON',
        status: response.status,
        endpoint: context.endpoint,
        method: context.method,
        requestId,
        hint: 'Verify the auth endpoint response body is valid JSON.',
        cause: rawText.slice(0, 300),
      })
      return {
        ok: false,
        status: response.status,
        data: null,
        error: details.message,
        errorDetails: details,
        raw: parsedBody.parsed,
      }
    }

    const parsed = parsedBody.parsed

    if (!response.ok) {
      const details = toErrorDetails({
        code: 'HTTP_ERROR',
        message: resolveErrorMessage(
          parsed,
          `Auth endpoint ${context.method} ${context.endpoint} failed with status ${response.status}`,
        ),
        status: response.status,
        endpoint: context.endpoint,
        method: context.method,
        requestId,
      })
      return {
        ok: false,
        status: response.status,
        data: null,
        error: details.message,
        errorDetails: details,
        raw: parsed,
      }
    }

    return {
      ok: true,
      status: response.status,
      data: (parsed as T) ?? null,
      error: null,
      errorDetails: null,
      raw: parsed,
    }
  } catch (callError) {
    const message = callError instanceof Error ? callError.message : String(callError)
    const details = toErrorDetails({
      code: 'NETWORK_ERROR',
      message: `Network error while calling ${context.method} ${context.endpoint}: ${message}`,
      status: 0,
      endpoint: context.endpoint,
      method: context.method,
      cause: message,
      hint: 'Check auth server URL, DNS, and network reachability.',
    })
    return {
      ok: false,
      status: 0,
      data: null,
      error: details.message,
      errorDetails: details,
      raw: null,
    }
  }
}

function executePostWithCompatibleInput<TPayload extends AthenaAuthFetchCompatibleInput, TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input: TPayload,
  options?: AthenaAuthCallOptions,
) {
  const { payload, fetchOptions } = extractFetchOptions(input)
  const mergedOptions = mergeCallOptions(fetchOptions, options)
  return callAuthEndpoint<TResult>(config, context, payload ?? {}, undefined, mergedOptions)
}

function executePostWithOptionalInput<TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) {
  const { fetchOptions } = extractFetchOptions(input)
  const mergedOptions = mergeCallOptions(fetchOptions, options)
  return callAuthEndpoint<TResult>(config, context, {}, undefined, mergedOptions)
}

function executeGetWithCompatibleInput<TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) {
  const { fetchOptions } = extractFetchOptions(input)
  const mergedOptions = mergeCallOptions(fetchOptions, options)
  return callAuthEndpoint<TResult>(config, context, undefined, undefined, mergedOptions)
}

function executeGetWithQueryCompatibleInput<
  TQuery extends Record<string, AthenaAuthQueryValue>,
  TResult,
>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: { query?: TQuery } & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) {
  const { payload, fetchOptions } = extractFetchOptions(input)
  const mergedOptions = mergeCallOptions(fetchOptions, options)
  const query = (payload as { query?: TQuery } | undefined)?.query
  return callAuthEndpoint<TResult>(
    config,
    context,
    undefined,
    query,
    mergedOptions,
  )
}

function executePostWithQueryCompatibleInput<
  TQuery extends Record<string, AthenaAuthQueryValue>,
  TResult,
>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: { query?: TQuery } & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) {
  const { payload, fetchOptions } = extractFetchOptions(input)
  const mergedOptions = mergeCallOptions(fetchOptions, options)
  const query = (payload as { query?: TQuery } | undefined)?.query
  return callAuthEndpoint<TResult>(
    config,
    context,
    {},
    query,
    mergedOptions,
  )
}

export function createAuthClient(config: AthenaAuthClientConfig = {}): AthenaAuthSdkClient {
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl)
  const resolvedConfig: AthenaAuthClientConfig = {
    ...config,
    baseUrl: normalizedBaseUrl,
  }

  const request = <T = unknown>(
    input: AthenaAuthRequestInput,
    options?: AthenaAuthCallOptions,
  ): Promise<AthenaAuthResult<T>> => {
    const method = input.method ?? (input.body !== undefined ? 'POST' : inferDefaultMethod(input.endpoint))
    const mergedOptions = mergeCallOptions(input.fetchOptions, options)
    return callAuthEndpoint<T>(
      resolvedConfig,
      { endpoint: input.endpoint, method },
      input.body,
      input.query,
      mergedOptions,
    )
  }

  const signOut = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) =>
    executePostWithOptionalInput<AthenaAuthSignOutResponse>(
      resolvedConfig,
      { endpoint: '/sign-out', method: 'POST' },
      input,
      options,
    )

  const revokeSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) =>
    executePostWithOptionalInput<AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: '/revoke-sessions', method: 'POST' },
      input,
      options,
    )

  const revokeOtherSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) =>
    executePostWithOptionalInput<AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: '/revoke-other-sessions', method: 'POST' },
      input,
      options,
    )

  const revokeSession = (
    input: { token: string } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) =>
    executePostWithCompatibleInput<typeof input, AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: '/revoke-session', method: 'POST' },
      input,
      options,
    )

  const deleteUser = (
    input?: AthenaDeleteUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input)
    const mergedOptions = mergeCallOptions(fetchOptions, options)
    return callAuthEndpoint<AthenaDeleteUserResponse>(
      resolvedConfig,
      { endpoint: '/delete-user', method: 'POST' },
      payload ?? {},
      undefined,
      mergedOptions,
    )
  }

  const deleteUserCallback = (
    input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input)
    const mergedOptions = mergeCallOptions(fetchOptions, options)
    const query = (payload ?? {}) as AthenaDeleteUserCallbackRequest
    return callAuthEndpoint<AthenaDeleteUserResponse>(
      resolvedConfig,
      { endpoint: '/delete-user/callback', method: 'GET' },
      undefined,
      {
        token: query.token,
        callbackURL: query.callbackURL,
      },
      mergedOptions,
    )
  }

  const resolveResetPasswordToken = (
    input: { token: string; callbackURL?: string } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input)
    const mergedOptions = mergeCallOptions(fetchOptions, options)
    const query = payload as { token?: string; callbackURL?: string } | undefined
    const token = query?.token?.trim()
    if (!token) {
      throw new Error('resolveResetPasswordToken requires a non-empty token')
    }
    const endpoint = `/reset-password/${encodeURIComponent(token)}` as AthenaAuthEndpointPath
    return callAuthEndpoint<{ token?: string }>(
      resolvedConfig,
      { endpoint, method: 'GET' },
      undefined,
      query?.callbackURL ? { callbackURL: query.callbackURL } : undefined,
      mergedOptions,
    )
  }

  return {
    baseUrl: normalizedBaseUrl,
    request,
    signIn: {
      email: (
        input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) =>
        executePostWithCompatibleInput<
          AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: '/sign-in/email', method: 'POST' },
          input,
          options,
        ),
      username: (
        input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) =>
        executePostWithCompatibleInput<
          AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: '/sign-in/username', method: 'POST' },
          input,
          options,
        ),
      social: (
        input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) =>
        executePostWithCompatibleInput<
          AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSocialRedirectResponse | AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: '/sign-in/social', method: 'POST' },
          input,
          options,
        ),
    },
    signUp: {
      email: (
        input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions,
      ) =>
        executePostWithCompatibleInput<
          AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: '/sign-up/email', method: 'POST' },
          input,
          options,
        ),
    },
    signOut,
    logout: signOut,
    getSession: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) =>
      executeGetWithCompatibleInput<AthenaAuthSessionResponse>(
        resolvedConfig,
        { endpoint: '/get-session', method: 'GET' },
        input,
        options,
      ),
    listSessions: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) =>
      executeGetWithCompatibleInput<AthenaAuthSession[]>(
        resolvedConfig,
        { endpoint: '/list-sessions', method: 'GET' },
        input,
        options,
      ),
    revokeSession,
    clearSession: revokeSession,
    revokeSessions,
    clearSessions: revokeSessions,
    revokeOtherSessions,
    clearOtherSessions: revokeOtherSessions,
    forgetPassword: (
      input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/forget-password', method: 'POST' },
        input,
        options,
      ),
    resetPassword: (
      input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/reset-password', method: 'POST' },
        input,
        options,
      ),
    resolveResetPasswordToken,
    verifyEmail: (
      input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) => {
      const { payload, fetchOptions } = extractFetchOptions(input)
      const mergedOptions = mergeCallOptions(fetchOptions, options)
      const query = payload as AthenaVerifyEmailRequest | undefined
      return callAuthEndpoint<{ user: AthenaAuthUser; status: boolean }>(
        resolvedConfig,
        { endpoint: '/verify-email', method: 'GET' },
        undefined,
        query
          ? {
              token: query.token,
              callbackURL: query.callbackURL,
            }
          : undefined,
        mergedOptions,
      )
    },
    sendVerificationEmail: (
      input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/send-verification-email', method: 'POST' },
        input,
        options,
      ),
    changeEmail: (
      input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput,
        { status: boolean; message?: string | null }
      >(
        resolvedConfig,
        { endpoint: '/change-email', method: 'POST' },
        input,
        options,
      ),
    changePassword: (
      input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput,
        { token?: string | null; user: AthenaAuthUser }
      >(
        resolvedConfig,
        { endpoint: '/change-password', method: 'POST' },
        input,
        options,
      ),
    updateUser: (
      input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/update-user', method: 'POST' },
        input,
        options,
      ),
    deleteUser,
    deleteUserCallback,
    linkSocial: (
      input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthSocialRedirectResponse
      >(
        resolvedConfig,
        { endpoint: '/link-social', method: 'POST' },
        input,
        options,
      ),
    listAccounts: (input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) =>
      executeGetWithCompatibleInput<AthenaAuthLinkedAccount[]>(
        resolvedConfig,
        { endpoint: '/list-accounts', method: 'GET' },
        input,
        options,
      ),
    unlinkAccount: (
      input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/unlink-account', method: 'POST' },
        input,
        options,
      ),
    refreshToken: (
      input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
        AthenaOAuthTokenBundle
      >(
        resolvedConfig,
        { endpoint: '/refresh-token', method: 'POST' },
        input,
        options,
      ),
    getAccessToken: (
      input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions,
    ) =>
      executePostWithCompatibleInput<
        AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
        AthenaOAuthTokenBundle
      >(
        resolvedConfig,
        { endpoint: '/get-access-token', method: 'POST' },
        input,
        options,
      ),
  }
}
