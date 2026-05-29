import type {
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthGenericInput,
  AthenaAuthGenericQueryInput,
  AthenaAuthBindings,
  AthenaAuthLinkedAccount,
  AthenaAuthOrganizationBindings,
  AthenaAuthOrganization,
  AthenaAuthOrganizationCheckSlugRequest,
  AthenaAuthOrganizationCreateRequest,
  AthenaAuthOrganizationDeleteRequest,
  AthenaAuthOrganizationGetFullQuery,
  AthenaAuthOrganizationGetInvitationQuery,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationInvitationActionRequest,
  AthenaAuthOrganizationInviteMemberRequest,
  AthenaAuthOrganizationLeaveRequest,
  AthenaAuthOrganizationListInvitationsQuery,
  AthenaAuthOrganizationListMembersQuery,
  AthenaAuthOrganizationListUserInvitationsQuery,
  AthenaAuthOrganizationMember,
  AthenaAuthOrganizationRemoveMemberRequest,
  AthenaAuthOrganizationSetActiveRequest,
  AthenaAuthOrganizationUpdateMemberRoleRequest,
  AthenaAuthOrganizationUpdateRequest,
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
    case '/change-email/verify':
    case '/delete-user/verify':
    case '/email/list':
    case '/delete-user/callback':
    case '/list-accounts':
    case '/passkey/generate-register-options':
    case '/passkey/list-user-passkeys':
    case '/.well-known/webauthn':
    case '/admin/list-users':
    case '/admin/athena-client/list':
    case '/admin/audit-log/list':
    case '/admin/email-template/list':
    case '/admin/email/list':
    case '/api-key/get':
    case '/api-key/list':
    case '/organization/get-full-organization':
    case '/organization/list':
    case '/organization/get-invitation':
    case '/organization/list-invitations':
    case '/organization/list-user-invitations':
    case '/organization/list-members':
    case '/organization/get-active-member':
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
  TQuery extends object,
  TResult,
>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: { query?: TQuery } & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) {
  const { payload, fetchOptions } = extractFetchOptions(input)
  const mergedOptions = mergeCallOptions(fetchOptions, options)
  const query = (payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined)?.query
  return callAuthEndpoint<TResult>(
    config,
    context,
    undefined,
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

  const postGeneric = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: (AthenaAuthFetchCompatibleInput & object),
    options?: AthenaAuthCallOptions,
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input)
    return request<T>(
      {
        endpoint,
        method: 'POST',
        body: payload ?? {},
        fetchOptions,
      },
      options,
    )
  }

  const getGeneric = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions,
  ) => {
    const { fetchOptions } = extractFetchOptions(input)
    return request<T>(
      {
        endpoint,
        method: 'GET',
        fetchOptions,
      },
      options,
    )
  }

  const getWithQuery = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & {
      query?: Record<string, AthenaAuthQueryValue>
    },
    options?: AthenaAuthCallOptions,
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input)
    const query = (payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined)?.query
    return request<T>(
      {
        endpoint,
        method: 'GET',
        query,
        fetchOptions,
      },
      options,
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

  const organization: AthenaAuthOrganizationBindings = {
    create: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthOrganization
      >(
        resolvedConfig,
        { endpoint: '/organization/create', method: 'POST' },
        input,
        options,
      ),
    update: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthOrganization
      >(
        resolvedConfig,
        { endpoint: '/organization/update', method: 'POST' },
        input,
        options,
      ),
    delete: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/organization/delete', method: 'POST' },
        input,
        options,
      ),
    setActive: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/organization/set-active', method: 'POST' },
        input,
        options,
      ),
    list: (input, options) =>
      getGeneric<AthenaAuthOrganization[]>(
        '/organization/list',
        input,
        options,
      ),
    getFull: (input, options) =>
      executeGetWithQueryCompatibleInput<AthenaAuthOrganizationGetFullQuery, {
        organization: AthenaAuthOrganization
        members?: AthenaAuthOrganizationMember[]
        invitations?: AthenaAuthOrganizationInvitation[]
      }>(
        resolvedConfig,
        { endpoint: '/organization/get-full-organization', method: 'GET' },
        input,
        options,
      ),
    checkSlug: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput,
        { available: boolean }
      >(
        resolvedConfig,
        { endpoint: '/organization/check-slug', method: 'POST' },
        input,
        options,
      ),
    leave: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: '/organization/leave', method: 'POST' },
        input,
        options,
      ),
    listUserInvitations: (input, options) =>
      executeGetWithQueryCompatibleInput<
        AthenaAuthOrganizationListUserInvitationsQuery,
        AthenaAuthOrganizationInvitation[]
      >(
        resolvedConfig,
        { endpoint: '/organization/list-user-invitations', method: 'GET' },
        input,
        options,
      ),
    hasPermission: (input, options) =>
      postGeneric<{ success?: boolean; error?: string }>(
        '/organization/has-permission',
        input,
        options,
      ),
    invitation: {
      cancel: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: '/organization/cancel-invitation', method: 'POST' },
          input,
          options,
        ),
      accept: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: '/organization/accept-invitation', method: 'POST' },
          input,
          options,
        ),
      get: (input, options) =>
        executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationGetInvitationQuery,
          AthenaAuthOrganizationInvitation
        >(
          resolvedConfig,
          { endpoint: '/organization/get-invitation', method: 'GET' },
          input,
          options,
        ),
      reject: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: '/organization/reject-invitation', method: 'POST' },
          input,
          options,
        ),
      list: (input, options) =>
        executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationListInvitationsQuery,
          AthenaAuthOrganizationInvitation[]
        >(
          resolvedConfig,
          { endpoint: '/organization/list-invitations', method: 'GET' },
          input,
          options,
        ),
    },
    member: {
      remove: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: '/organization/remove-member', method: 'POST' },
          input,
          options,
        ),
      updateRole: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: '/organization/update-member-role', method: 'POST' },
          input,
          options,
        ),
      invite: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthOrganizationInvitation
        >(
          resolvedConfig,
          { endpoint: '/organization/invite-member', method: 'POST' },
          input,
          options,
        ),
      getActive: (input, options) =>
        executeGetWithCompatibleInput<AthenaAuthOrganizationMember>(
          resolvedConfig,
          { endpoint: '/organization/get-active-member', method: 'GET' },
          input,
          options,
        ),
      list: (input, options) =>
        executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationListMembersQuery,
          AthenaAuthOrganizationMember[]
        >(
          resolvedConfig,
          { endpoint: '/organization/list-members', method: 'GET' },
          input,
          options,
        ),
    },
  }

  const authResetPassword = Object.assign(
    (
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
    {
      token: resolveResetPasswordToken,
    },
  )

  const sessionRevokeBinding: AthenaAuthBindings['session']['revoke'] = (
    input,
    options,
  ) => {
    if (Array.isArray(input)) {
      if (input.length === 0) {
        throw new Error('session.revoke requires at least one session token')
      }
      if (input.length === 1) {
        return revokeSession(input[0], options)
      }
      return callAuthEndpoint<AthenaAuthStatusResponse>(
        resolvedConfig,
        { endpoint: '/revoke-sessions', method: 'POST' },
        input,
        undefined,
        options,
      )
    }

    const parsed = input as AthenaAuthGenericInput & {
      token?: string
      tokens?: string[]
    }
    const tokens = Array.isArray(parsed.tokens)
      ? parsed.tokens.filter(token => token.trim().length > 0)
      : undefined

    if (tokens && tokens.length > 1) {
      return postGeneric<AthenaAuthStatusResponse>(
        '/revoke-sessions',
        { tokens, fetchOptions: parsed.fetchOptions } as AthenaAuthGenericInput,
        options,
      )
    }

    if (tokens && tokens.length === 1) {
      return revokeSession(
        { token: tokens[0], fetchOptions: parsed.fetchOptions },
        options,
      )
    }

    const token = parsed.token?.trim()
    if (!token) {
      throw new Error('session.revoke requires a non-empty token or a non-empty token list')
    }

    return revokeSession(
      {
        token,
        fetchOptions: parsed.fetchOptions,
      },
      options,
    )
  }

  const adminUserSessionRevokeBinding: AthenaAuthBindings['admin']['user']['session']['revoke'] = (
    input,
    options,
  ) => {
    if (Array.isArray(input)) {
      if (input.length === 0) {
        throw new Error('admin.user.session.revoke requires at least one payload item')
      }
      if (input.length === 1) {
        return postGeneric('/admin/revoke-user-session', input[0], options)
      }
      return postGeneric('/admin/revoke-user-sessions', { sessions: input } as AthenaAuthGenericInput, options)
    }

    const parsed = input as AthenaAuthGenericInput & {
      sessions?: unknown[]
    }
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : undefined

    if (sessions && sessions.length > 1) {
      return postGeneric(
        '/admin/revoke-user-sessions',
        { sessions, fetchOptions: parsed.fetchOptions } as AthenaAuthGenericInput,
        options,
      )
    }

    return postGeneric('/admin/revoke-user-session', parsed, options)
  }

  const auth: AthenaAuthBindings = {
    getSession: (input, options) => getGeneric('/get-session', input, options),
    signOut,
    forgetPassword: (input, options) => postGeneric('/forget-password', input, options),
    resetPassword: authResetPassword,
    setPassword: (input, options) => postGeneric('/set-password', input, options),
    verifyEmail: (input, options) => {
      const queryInput: AthenaAuthGenericQueryInput = {
        query: {
          token: input.token,
          callbackURL: input.callbackURL,
        },
        fetchOptions: input.fetchOptions,
      }
      return getWithQuery<{ user: AthenaAuthUser; status: boolean }>(
        '/verify-email',
        queryInput,
        options,
      )
    },
    sendVerificationEmail: (input, options) => postGeneric('/send-verification-email', input, options),
    changeEmail: (input, options) => postGeneric('/change-email', input, options),
    changeEmailVerify: (input, options) => getWithQuery('/change-email/verify', input, options),
    deleteUserVerify: (input, options) => getWithQuery('/delete-user/verify', input, options),
    changePassword: (input, options) => postGeneric('/change-password', input, options),
    user: {
      update: (input, options) => postGeneric('/update-user', input, options),
      delete: (input, options) => postGeneric('/delete-user', input, options),
      email: {
        list: (input, options) => getGeneric('/email/list', input, options),
      },
    },
    session: {
      list: (input, options) => getGeneric('/list-sessions', input, options),
      revoke: sessionRevokeBinding,
      revokeOther: (input, options) => postGeneric('/revoke-other-sessions', input as AthenaAuthGenericInput, options),
    },
    social: {
      link: (input, options) => postGeneric('/link-social', input, options),
    },
    account: {
      list: (input, options) => getGeneric('/list-accounts', input, options),
      unlink: (input, options) => postGeneric('/unlink-account', input, options),
    },
    deleteUser: {
      callback: deleteUserCallback,
    },
    refreshToken: (input, options) => postGeneric('/refresh-token', input, options),
    getAccessToken: (input, options) => postGeneric('/get-access-token', input, options),
    ok: (input, options) => getGeneric('/ok', input, options),
    error: (input, options) => getGeneric('/error', input, options),
    twoFactor: {
      getTotpUri: (input, options) => postGeneric('/two-factor/get-totp-uri', input, options),
      verifyTotp: (input, options) => postGeneric('/two-factor/verify-totp', input, options),
      sendOtp: (input, options) => postGeneric('/two-factor/send-otp', input, options),
      verifyOtp: (input, options) => postGeneric('/two-factor/verify-otp', input, options),
      verifyBackupCode: (input, options) => postGeneric('/two-factor/verify-backup-code', input, options),
      generateBackupCodes: (input, options) =>
        postGeneric('/two-factor/generate-backup-codes', input as AthenaAuthGenericInput, options),
      enable: (input, options) => postGeneric('/two-factor/enable', input, options),
      disable: (input, options) => postGeneric('/two-factor/disable', input, options),
    },
    passkey: {
      generateRegisterOptions: (input, options) =>
        getGeneric('/passkey/generate-register-options', input, options),
      generateAuthenticateOptions: (input, options) =>
        postGeneric('/passkey/generate-authenticate-options', input, options),
      verifyRegistration: (input, options) =>
        postGeneric('/passkey/verify-registration', input, options),
      verifyAuthentication: (input, options) =>
        postGeneric('/passkey/verify-authentication', input, options),
      listUserPasskeys: (input, options) => getGeneric('/passkey/list-user-passkeys', input, options),
      deletePasskey: (input, options) => postGeneric('/passkey/delete-passkey', input, options),
      updatePasskey: (input, options) => postGeneric('/passkey/update-passkey', input, options),
      getRelatedOrigins: (input, options) => getGeneric('/.well-known/webauthn', input, options),
    },
    admin: {
      role: {
        set: (input, options) => postGeneric('/admin/set-role', input, options),
      },
      user: {
        list: (input, options) => getWithQuery('/admin/list-users', input, options),
        create: (input, options) => postGeneric('/admin/create-user', input, options),
        unban: (input, options) => postGeneric('/admin/unban-user', input, options),
        ban: (input, options) => postGeneric('/admin/ban-user', input, options),
        impersonate: (input, options) => postGeneric('/admin/impersonate-user', input, options),
        stopImpersonating: (input, options) => postGeneric('/admin/stop-impersonating', input, options),
        remove: (input, options) => postGeneric('/admin/remove-user', input, options),
        setPassword: (input, options) => postGeneric('/admin/set-user-password', input, options),
        session: {
          list: (input, options) => postGeneric('/admin/list-user-sessions', input, options),
          revoke: adminUserSessionRevokeBinding,
        },
      },
      hasPermission: (input, options) => postGeneric('/admin/has-permission', input, options),
      apiKey: {
        create: (input, options) => postGeneric('/admin/api-key/create', input, options),
      },
      athenaClient: {
        create: (input, options) => postGeneric('/admin/athena-client/create', input, options),
        list: (input, options) => getWithQuery('/admin/athena-client/list', input, options),
      },
      auditLog: {
        list: (input, options) => getWithQuery('/admin/audit-log/list', input, options),
      },
      emailTemplate: {
        create: (input, options) => postGeneric('/admin/email-template/create', input, options),
        delete: (input, options) => postGeneric('/admin/email-template/delete', input, options),
        list: (input, options) => getWithQuery('/admin/email-template/list', input, options),
        update: (input, options) => postGeneric('/admin/email-template/update', input, options),
      },
      email: {
        list: (input, options) => getWithQuery('/admin/email/list', input, options),
      },
    },
    apiKey: {
      create: (input, options) => postGeneric('/api-key/create', input, options),
      get: (input, options) => getWithQuery('/api-key/get', input, options),
      update: (input, options) => postGeneric('/api-key/update', input, options),
      delete: (input, options) => postGeneric('/api-key/delete', input, options),
      list: (input, options) => getWithQuery('/api-key/list', input, options),
      verify: (input, options) => postGeneric('/api-key/verify', input, options),
      deleteAllExpired: (input, options) =>
        postGeneric('/api-key/delete-all-expired-api-keys', input as AthenaAuthGenericInput, options),
    },
    signIn: {
      email: (input, options) => postGeneric('/sign-in/email', input, options),
      username: (input, options) => postGeneric('/sign-in/username', input, options),
      social: (input, options) => postGeneric('/sign-in/social', input, options),
    },
    signUp: {
      email: (input, options) => postGeneric('/sign-up/email', input, options),
    },
    organization,
    callback: {
      provider: (input, options) => {
        const { payload, fetchOptions } = extractFetchOptions(input)
        const provider = String((payload as { provider?: string } | undefined)?.provider ?? '').trim()
        if (!provider) {
          throw new Error('callback.provider requires a non-empty provider value')
        }
        const endpoint = `/callback/${encodeURIComponent(provider)}` as AthenaAuthEndpointPath
        return request({
          endpoint,
          method: 'GET',
          fetchOptions,
        }, options)
      },
    },
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
    organization,
    auth,
  }
}
