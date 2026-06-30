import { getSessionCookie } from '../cookies/index.ts'
import type { BackendOption } from '../gateway/types.ts'

export type AthenaRequestHeaderProfile = 'gateway' | 'auth' | 'chat' | 'storage' | 'minimal'

const NO_CACHE_HEADER_VALUE = 'no-cache'

const API_KEY_HEADER_CANDIDATES = ['x-api-key', 'apikey'] as const
const ATHENA_KEY_HEADER_CANDIDATES = ['X-Athena-Key', 'x-athena-key'] as const
const SESSION_TOKEN_HEADER_CANDIDATES = ['X-Athena-Auth-Session-Token'] as const
const BEARER_MIRROR_HEADER_CANDIDATES = ['X-Athena-Auth-Bearer-Token'] as const
const CLIENT_HEADER_CANDIDATES = ['X-Athena-Client', 'x-athena-client'] as const
const PG_URI_HEADER_CANDIDATES = ['x-pg-uri'] as const
const JDBC_URI_HEADER_CANDIDATES = ['x-athena-jdbc-url', 'x-jdbc-url'] as const

interface AthenaRequestHeaderProfileRules {
  apiKeys: boolean
  routing: boolean
  authMirror: boolean
  authBearer: boolean
  contentType?: boolean
  accept?: boolean
  stripNullsDefault?: boolean
}

const PROFILE_RULES: Record<AthenaRequestHeaderProfile, AthenaRequestHeaderProfileRules> = {
  gateway: { apiKeys: true, routing: true, authMirror: true, authBearer: false, contentType: true, stripNullsDefault: true },
  chat: { apiKeys: true, routing: true, authMirror: true, authBearer: true, accept: true },
  storage: { apiKeys: true, routing: true, authMirror: true, authBearer: false, contentType: true },
  auth: { apiKeys: true, routing: false, authMirror: false, authBearer: true, contentType: true },
  minimal: { apiKeys: false, routing: false, authMirror: false, authBearer: false },
}

export interface BuildAthenaRequestHeadersInput {
  profile: AthenaRequestHeaderProfile
  sdkHeaderValue: string
  apiKey?: string | null
  /** Overrides `X-Athena-Key` while leaving `apikey` / `x-api-key` on `apiKey`. */
  athenaKey?: string | null
  client?: string | null
  userId?: string | null
  organizationId?: string | null
  backend?: BackendOption
  publishEvent?: string | null
  stripNulls?: boolean
  bearerToken?: string | null
  cookie?: string | null
  sessionToken?: string | null
  pgUri?: string | null
  jdbcUrl?: string | null
  forceNoCache?: boolean
  configHeaders?: Record<string, string>
  callHeaders?: Record<string, string>
  contentType?: string | null
  accept?: string | null
}

/** Shared config/call fields consumed by gateway, chat, auth, and `client.request(...)`. */
export interface AthenaRequestHeaderOverrideFields {
  apiKey?: string | null
  athenaKey?: string | null
  client?: string | null
  userId?: string | null
  organizationId?: string | null
  backend?: BackendOption
  publishEvent?: string | null
  stripNulls?: boolean
  bearerToken?: string | null
  cookie?: string | null
  sessionToken?: string | null
  pgUri?: string | null
  jdbcUrl?: string | null
  forceNoCache?: boolean
  headers?: Record<string, string>
}

export type ResolvedRequestHeaderOverrides = Omit<
  BuildAthenaRequestHeadersInput,
  'profile' | 'sdkHeaderValue' | 'contentType' | 'accept'
>

function normalizeHeaderValue(value?: string | null): string | undefined {
  return value ? value : undefined
}

function mergeExtraHeaders(
  configHeaders?: Record<string, string>,
  callHeaders?: Record<string, string>,
): Record<string, string> {
  return { ...(configHeaders ?? {}), ...(callHeaders ?? {}) }
}

export function hasHeaderIgnoreCase(
  headers: Record<string, string>,
  targetKey: string,
): boolean {
  const normalizedTargetKey = targetKey.toLowerCase()
  return Object.keys(headers).some(key => key.toLowerCase() === normalizedTargetKey)
}

export function resolveHeaderValue(
  headers: Record<string, string>,
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    const direct = normalizeHeaderValue(headers[candidate])
    if (direct) return direct
  }

  const loweredCandidates = new Set(candidates.map(candidate => candidate.toLowerCase()))
  for (const [key, value] of Object.entries(headers)) {
    if (!loweredCandidates.has(key.toLowerCase())) {
      continue
    }
    const normalized = normalizeHeaderValue(value)
    if (normalized) return normalized
  }

  return undefined
}

function isCacheControlHeaderName(name: string): boolean {
  return name.toLowerCase() === 'cache-control'
}

function normalizeBearerToken(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? trimmed
}

function resolveBearerTokenFromAuthorizationHeader(
  headers: Record<string, string>,
): string | undefined {
  const authorization = resolveHeaderValue(headers, ['Authorization'])
  if (!authorization) {
    return undefined
  }

  const token = normalizeBearerToken(authorization)
  return token ? token : undefined
}

function resolveSessionTokenFromCookieHeader(
  headers: Record<string, string>,
): string | undefined {
  const cookie = resolveHeaderValue(headers, ['Cookie'])
  if (!cookie) {
    return undefined
  }

  return getSessionCookie(new Headers({ cookie })) ?? undefined
}

function resolveBackendType(backend?: BackendOption): string | undefined {
  if (!backend) {
    return undefined
  }
  return typeof backend === 'string' ? backend : backend.type
}

export function resolveRequestHeaderOverrides(
  config: AthenaRequestHeaderOverrideFields,
  options?: AthenaRequestHeaderOverrideFields,
  defaults?: Pick<AthenaRequestHeaderOverrideFields, 'client' | 'stripNulls'>,
): ResolvedRequestHeaderOverrides {
  return {
    apiKey: options?.apiKey ?? config.apiKey,
    athenaKey: options?.athenaKey ?? config.athenaKey,
    client: options?.client ?? config.client ?? defaults?.client,
    userId: options?.userId ?? config.userId,
    organizationId: options?.organizationId ?? config.organizationId,
    backend: options?.backend ?? config.backend,
    publishEvent: options?.publishEvent ?? config.publishEvent,
    stripNulls: options?.stripNulls ?? config.stripNulls ?? defaults?.stripNulls,
    bearerToken: options?.bearerToken ?? config.bearerToken,
    cookie: options?.cookie ?? config.cookie,
    sessionToken: options?.sessionToken ?? config.sessionToken,
    pgUri: options?.pgUri ?? config.pgUri,
    jdbcUrl: options?.jdbcUrl ?? config.jdbcUrl,
    forceNoCache: Boolean(config.forceNoCache || options?.forceNoCache),
    configHeaders: config.headers,
    callHeaders: options?.headers,
  }
}

export function buildServiceRequestHeaders(
  profile: Exclude<AthenaRequestHeaderProfile, 'minimal'>,
  sdkHeaderValue: string,
  config: AthenaRequestHeaderOverrideFields,
  options?: AthenaRequestHeaderOverrideFields,
  extras?: Pick<BuildAthenaRequestHeadersInput, 'contentType' | 'accept'> & {
    client?: string | null
    stripNulls?: boolean
  },
): Record<string, string> {
  const rules = PROFILE_RULES[profile]
  return buildAthenaRequestHeaders({
    profile,
    sdkHeaderValue,
    ...resolveRequestHeaderOverrides(config, options, {
      client: extras?.client ?? undefined,
      stripNulls: extras?.stripNulls ?? (rules.stripNullsDefault ? true : undefined),
    }),
    contentType: extras?.contentType ?? (rules.contentType ? 'application/json' : undefined),
    accept: extras?.accept ?? (rules.accept ? 'application/json' : undefined),
  })
}

export function applyAthenaApiKeyHeaders(
  headers: Record<string, string>,
  apiKey?: string | null,
  athenaKey?: string | null,
): void {
  if (apiKey) {
    if (!hasHeaderIgnoreCase(headers, 'apikey')) {
      headers.apikey = apiKey
    }
    if (!hasHeaderIgnoreCase(headers, 'x-api-key')) {
      headers['x-api-key'] = apiKey
    }
  }

  const resolvedAthenaKey = normalizeHeaderValue(athenaKey) ?? normalizeHeaderValue(apiKey)
  if (resolvedAthenaKey && !hasHeaderIgnoreCase(headers, 'X-Athena-Key')) {
    headers['X-Athena-Key'] = resolvedAthenaKey
  }
}

export function applyAthenaAuthContextHeaders(
  headers: Record<string, string>,
  input: Pick<
    BuildAthenaRequestHeadersInput,
    'bearerToken' | 'cookie' | 'sessionToken' | 'profile' | 'configHeaders' | 'callHeaders'
  >,
): void {
  const mergedExtraHeaders = mergeExtraHeaders(input.configHeaders, input.callHeaders)
  const rules = PROFILE_RULES[input.profile]
  const explicitCookie = normalizeHeaderValue(input.cookie)
  if (explicitCookie) {
    mergedExtraHeaders.Cookie = explicitCookie
  }

  const explicitSessionToken =
    normalizeHeaderValue(input.sessionToken) ??
    resolveHeaderValue(mergedExtraHeaders, SESSION_TOKEN_HEADER_CANDIDATES)
  const derivedSessionToken =
    explicitSessionToken ?? resolveSessionTokenFromCookieHeader(mergedExtraHeaders)
  const cookieFromHeaders = resolveHeaderValue(mergedExtraHeaders, ['Cookie'])

  if (explicitCookie && !hasHeaderIgnoreCase(headers, 'Cookie')) {
    headers.Cookie = explicitCookie
  } else if (cookieFromHeaders && !hasHeaderIgnoreCase(headers, 'Cookie')) {
    headers.Cookie = cookieFromHeaders
  }

  const explicitBearerToken = (() => {
    const configured = normalizeHeaderValue(input.bearerToken)
    if (configured) {
      return normalizeBearerToken(configured)
    }
    const mirrored = resolveHeaderValue(mergedExtraHeaders, BEARER_MIRROR_HEADER_CANDIDATES)
    return mirrored ? normalizeBearerToken(mirrored) : undefined
  })()
  const derivedBearerToken =
    explicitBearerToken ?? resolveBearerTokenFromAuthorizationHeader(mergedExtraHeaders)

  if (rules.authBearer && derivedBearerToken && !hasHeaderIgnoreCase(headers, 'Authorization')) {
    headers.Authorization = `Bearer ${derivedBearerToken}`
  }

  if (rules.authMirror) {
    if (derivedSessionToken && !hasHeaderIgnoreCase(headers, 'X-Athena-Auth-Session-Token')) {
      headers['X-Athena-Auth-Session-Token'] = derivedSessionToken
    }
    if (derivedBearerToken && !hasHeaderIgnoreCase(headers, 'X-Athena-Auth-Bearer-Token')) {
      headers['X-Athena-Auth-Bearer-Token'] = derivedBearerToken
    }
  } else if (derivedSessionToken && !hasHeaderIgnoreCase(headers, 'X-Athena-Auth-Session-Token')) {
    headers['X-Athena-Auth-Session-Token'] = derivedSessionToken
  }
}

export function applyAthenaPgUriHeaders(
  headers: Record<string, string>,
  input: Pick<BuildAthenaRequestHeadersInput, 'pgUri' | 'jdbcUrl' | 'configHeaders' | 'callHeaders'>,
): void {
  const mergedExtraHeaders = mergeExtraHeaders(input.configHeaders, input.callHeaders)

  const pgUri =
    normalizeHeaderValue(input.pgUri) ??
    resolveHeaderValue(mergedExtraHeaders, PG_URI_HEADER_CANDIDATES)
  if (pgUri && !hasHeaderIgnoreCase(headers, 'x-pg-uri')) {
    headers['x-pg-uri'] = pgUri
  }

  const jdbcUrl =
    normalizeHeaderValue(input.jdbcUrl) ??
    resolveHeaderValue(mergedExtraHeaders, JDBC_URI_HEADER_CANDIDATES)
  if (jdbcUrl) {
    if (!hasHeaderIgnoreCase(headers, 'x-athena-jdbc-url')) {
      headers['x-athena-jdbc-url'] = jdbcUrl
    }
    if (!hasHeaderIgnoreCase(headers, 'x-jdbc-url')) {
      headers['x-jdbc-url'] = jdbcUrl
    }
  }
}

export function buildAthenaRequestHeaders(
  input: BuildAthenaRequestHeadersInput,
): Record<string, string> {
  const forceNoCache = Boolean(input.forceNoCache)
  const mergedExtraHeaders = mergeExtraHeaders(input.configHeaders, input.callHeaders)
  const rules = PROFILE_RULES[input.profile]

  const headerClient = resolveHeaderValue(mergedExtraHeaders, CLIENT_HEADER_CANDIDATES)
  const finalClient = normalizeHeaderValue(input.client) ?? headerClient
  const finalApiKey =
    normalizeHeaderValue(input.apiKey) ??
    resolveHeaderValue(mergedExtraHeaders, API_KEY_HEADER_CANDIDATES)
  const finalAthenaKey =
    normalizeHeaderValue(input.athenaKey) ??
    resolveHeaderValue(mergedExtraHeaders, ATHENA_KEY_HEADER_CANDIDATES) ??
    finalApiKey

  const headers: Record<string, string> = {
    'X-Athena-Sdk': input.sdkHeaderValue,
  }

  if (rules.contentType) {
    headers['Content-Type'] = input.contentType ?? 'application/json'
  }

  if (input.accept ?? rules.accept) {
    headers.Accept = input.accept ?? 'application/json'
  }

  if (rules.routing) {
    if (normalizeHeaderValue(input.userId)) {
      headers['X-User-Id'] = input.userId ?? ''
    }
    if (normalizeHeaderValue(input.organizationId)) {
      headers['X-Organization-Id'] = input.organizationId ?? ''
    }
    if (finalClient) {
      headers['X-Athena-Client'] = finalClient
    }

    const backendType = resolveBackendType(input.backend)
    if (backendType) {
      headers['X-Backend-Type'] = backendType
    }

    if (typeof input.stripNulls === 'boolean') {
      headers['X-Strip-Nulls'] = input.stripNulls ? 'true' : 'false'
    } else if (rules.stripNullsDefault) {
      headers['X-Strip-Nulls'] = 'true'
    }

    if (normalizeHeaderValue(input.publishEvent)) {
      headers['X-Publish-Event'] = input.publishEvent ?? ''
    }
  }

  if (rules.apiKeys && (finalApiKey || finalAthenaKey)) {
    applyAthenaApiKeyHeaders(headers, finalApiKey, finalAthenaKey)
  }

  applyAthenaAuthContextHeaders(headers, input)
  applyAthenaPgUriHeaders(headers, input)

  const reservedClientHeaderKeys = new Set(CLIENT_HEADER_CANDIDATES.map(key => key.toLowerCase()))
  Object.entries(mergedExtraHeaders).forEach(([key, value]) => {
    if (reservedClientHeaderKeys.has(key.toLowerCase())) {
      return
    }
    if (forceNoCache && isCacheControlHeaderName(key)) {
      return
    }
    const normalized = normalizeHeaderValue(value)
    if (normalized) {
      headers[key] = normalized
    }
  })

  if (forceNoCache) {
    headers['Cache-Control'] = NO_CACHE_HEADER_VALUE
  }

  return headers
}