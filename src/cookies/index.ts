import { decodeBase64UrlToString, encodeStringToBase64Url } from './base64.ts'
import {
  HOST_COOKIE_PREFIX,
  SECURE_COOKIE_PREFIX,
  parseCookies,
  parseSetCookieHeader,
  setCookieToHeader,
  setRequestCookie,
  splitSetCookieHeader,
  stripSecureCookiePrefix,
  toCookieOptions,
} from './cookie-utils.ts'
import { signHmacBase64Url, signJwtHS256, verifyJwtHS256 } from './crypto.ts'
import { createAccountStore, createSessionStore, getAccountCookie, getChunkedCookie } from './session-store.ts'
import type {
  AthenaAuthCookie,
  AthenaAuthCookies,
  AthenaCookieContextRuntime,
  AthenaCookieOptions,
  AthenaCookiesOptions,
  AthenaCookieVersionResolver,
  AthenaGetCookieCacheConfig,
  AthenaSessionPair,
} from './types.ts'

const DEFAULT_COOKIE_PREFIX = 'athena-auth'
const LEGACY_COOKIE_PREFIX = 'better-auth'
const DEFAULT_SESSION_MAX_AGE = 7 * 24 * 60 * 60
const DEFAULT_CACHE_MAX_AGE = 60 * 5

function isProductionRuntime(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
}

function getEnvironmentSecret(): string | undefined {
  if (typeof process === 'undefined') {
    return undefined
  }
  return process.env?.ATHENA_AUTH_SECRET || process.env?.BETTER_AUTH_SECRET || process.env?.AUTH_SECRET
}

function isDynamicBaseURLConfig(baseURL: AthenaCookiesOptions['baseURL']): boolean {
  return (
    typeof baseURL === 'object' &&
    baseURL !== null &&
    'allowedHosts' in baseURL &&
    Array.isArray((baseURL as { allowedHosts?: unknown }).allowedHosts)
  )
}

function resolveCookiePrefixes(primaryPrefix: string): string[] {
  const prefixes = [primaryPrefix]
  if (!prefixes.includes(DEFAULT_COOKIE_PREFIX)) {
    prefixes.push(DEFAULT_COOKIE_PREFIX)
  }
  if (!prefixes.includes(LEGACY_COOKIE_PREFIX)) {
    prefixes.push(LEGACY_COOKIE_PREFIX)
  }
  return prefixes
}

function createError(message: string): Error {
  return new Error(`@xylex-group/athena/cookies: ${message}`)
}

function getSecretOrThrow(secret?: string): string {
  const resolved = secret || getEnvironmentSecret()
  if (!resolved) {
    throw createError(
      'getCookieCache requires a secret. Pass `secret` or set ATHENA_AUTH_SECRET/BETTER_AUTH_SECRET/AUTH_SECRET.',
    )
  }
  return resolved
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function getSessionTokenFromPair(session: AthenaSessionPair): string {
  const token = session.session?.token
  if (typeof token !== 'string' || token.length === 0) {
    throw createError('setSessionCookie requires `session.session.token` to be a non-empty string.')
  }
  return token
}

async function resolveCookieVersion(
  versionConfig: AthenaCookieVersionResolver | undefined,
  session: Record<string, unknown>,
  user: Record<string, unknown>,
): Promise<string> {
  if (!versionConfig) {
    return '1'
  }
  if (typeof versionConfig === 'string') {
    return versionConfig
  }
  return versionConfig(session, user)
}

function getSessionCookieCacheName(cookiePrefix: string, cookieName: string, isSecure: boolean): string {
  return isSecure ? `${SECURE_COOKIE_PREFIX}${cookiePrefix}.${cookieName}` : `${cookiePrefix}.${cookieName}`
}

async function setCookieValue(
  ctx: AthenaCookieContextRuntime,
  name: string,
  value: string,
  attributes: AthenaCookieOptions,
): Promise<void> {
  const secret = ctx.context.secret
  if (secret && typeof ctx.setSignedCookie === 'function') {
    await ctx.setSignedCookie(name, value, secret, attributes)
    return
  }
  ctx.setCookie(name, value, attributes)
}

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function getIsSecureCookie(config: { isSecure?: boolean } | undefined): boolean {
  if (config?.isSecure !== undefined) {
    return config.isSecure
  }
  return isProductionRuntime()
}

export function createCookieGetter(options: AthenaCookiesOptions) {
  const baseURLString = typeof options.baseURL === 'string' ? options.baseURL : undefined
  const dynamicProtocol =
    typeof options.baseURL === 'object' && options.baseURL !== null ? options.baseURL.protocol : undefined

  const secure =
    options.advanced?.useSecureCookies !== undefined
      ? options.advanced.useSecureCookies
      : dynamicProtocol === 'https'
        ? true
        : dynamicProtocol === 'http'
          ? false
          : baseURLString
            ? baseURLString.startsWith('https://')
            : isProductionRuntime()

  const secureCookiePrefix = secure ? SECURE_COOKIE_PREFIX : ''
  const crossSubdomainEnabled = !!options.advanced?.crossSubDomainCookies?.enabled
  const domain = crossSubdomainEnabled
    ? options.advanced?.crossSubDomainCookies?.domain || (baseURLString ? new URL(baseURLString).hostname : undefined)
    : undefined

  if (crossSubdomainEnabled && !domain && !isDynamicBaseURLConfig(options.baseURL)) {
    throw createError('baseURL is required when `crossSubDomainCookies.enabled` is true.')
  }

  function createCookie(cookieName: string, overrideAttributes: Partial<AthenaCookieOptions> = {}): AthenaAuthCookie {
    const prefix = options.advanced?.cookiePrefix || DEFAULT_COOKIE_PREFIX
    const name = options.advanced?.cookies?.[cookieName]?.name || `${prefix}.${cookieName}`
    const attributes = options.advanced?.cookies?.[cookieName]?.attributes || {}

    return {
      name: `${secureCookiePrefix}${name}`,
      attributes: {
        secure: !!secureCookiePrefix,
        sameSite: 'lax',
        path: '/',
        httpOnly: true,
        ...(crossSubdomainEnabled ? { domain } : {}),
        ...options.advanced?.defaultCookieAttributes,
        ...overrideAttributes,
        ...attributes,
      },
    }
  }

  return createCookie
}

export function getCookies(options: AthenaCookiesOptions): AthenaAuthCookies {
  const createCookie = createCookieGetter(options)
  const sessionToken = createCookie('session_token', { maxAge: options.session?.expiresIn || DEFAULT_SESSION_MAX_AGE })
  const sessionData = createCookie('session_data', { maxAge: options.session?.cookieCache?.maxAge || DEFAULT_CACHE_MAX_AGE })
  const accountData = createCookie('account_data', { maxAge: options.session?.cookieCache?.maxAge || DEFAULT_CACHE_MAX_AGE })
  const dontRememberToken = createCookie('dont_remember')

  return {
    sessionToken: {
      name: sessionToken.name,
      attributes: sessionToken.attributes,
    },
    sessionData: {
      name: sessionData.name,
      attributes: sessionData.attributes,
    },
    dontRememberToken: {
      name: dontRememberToken.name,
      attributes: dontRememberToken.attributes,
    },
    accountData: {
      name: accountData.name,
      attributes: accountData.attributes,
    },
  }
}

export async function setCookieCache(
  ctx: AthenaCookieContextRuntime,
  session: AthenaSessionPair,
  dontRememberMe: boolean,
): Promise<void> {
  const cookieCacheConfig = ctx.context.options?.session?.cookieCache
  if (!cookieCacheConfig?.enabled) {
    return
  }

  const version = await resolveCookieVersion(
    cookieCacheConfig.version,
    session.session as Record<string, unknown>,
    session.user as Record<string, unknown>,
  )

  const sessionData = {
    session: session.session,
    user: session.user,
    updatedAt: Date.now(),
    version,
  }

  const baseAttributes = ctx.context.authCookies.sessionData.attributes
  const maxAge = dontRememberMe ? undefined : baseAttributes.maxAge
  const options: AthenaCookieOptions = {
    ...baseAttributes,
    maxAge,
  }
  const expiresAt = Date.now() + ((options.maxAge || 60) * 1000)
  const strategy = cookieCacheConfig.strategy || 'compact'
  const secret = getSecretOrThrow(ctx.context.secret)

  let encoded: string
  if (strategy === 'jwt') {
    encoded = await signJwtHS256(sessionData, secret, options.maxAge || DEFAULT_CACHE_MAX_AGE)
  } else if (strategy === 'jwe') {
    throw createError('`jwe` strategy is not supported by the SDK cookie helper.')
  } else {
    const signature = await signHmacBase64Url(
      secret,
      JSON.stringify({
        ...sessionData,
        expiresAt,
      }),
    )
    encoded = encodeStringToBase64Url(
      JSON.stringify({
        session: sessionData,
        expiresAt,
        signature,
      }),
    )
  }

  if (encoded.length > 4093) {
    const store = createSessionStore(ctx.context.authCookies.sessionData.name, options, ctx)
    const cookies = store.chunk(encoded, options)
    store.setCookies(cookies)
  } else {
    const store = createSessionStore(ctx.context.authCookies.sessionData.name, options, ctx)
    if (store.hasChunks()) {
      store.setCookies(store.clean())
    }
    ctx.setCookie(ctx.context.authCookies.sessionData.name, encoded, options)
  }
}

export async function setSessionCookie(
  ctx: AthenaCookieContextRuntime,
  session: AthenaSessionPair,
  dontRememberMe?: boolean,
  overrides?: Partial<AthenaCookieOptions>,
): Promise<void> {
  if (dontRememberMe === undefined && typeof ctx.getSignedCookie === 'function' && ctx.context.secret) {
    const existingFlag = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret)
    dontRememberMe = !!existingFlag
  }

  const resolvedDontRememberMe = dontRememberMe ?? false
  const token = getSessionTokenFromPair(session)
  const options = ctx.context.authCookies.sessionToken.attributes
  const maxAge = resolvedDontRememberMe ? undefined : ctx.context.sessionConfig?.expiresIn
  await setCookieValue(ctx, ctx.context.authCookies.sessionToken.name, token, {
    ...options,
    maxAge,
    ...overrides,
  })

  if (resolvedDontRememberMe) {
    await setCookieValue(
      ctx,
      ctx.context.authCookies.dontRememberToken.name,
      'true',
      ctx.context.authCookies.dontRememberToken.attributes,
    )
  }

  await setCookieCache(ctx, session, resolvedDontRememberMe)
  ctx.context.setNewSession?.(session)
}

/**
 * Expires a cookie by setting `maxAge: 0` while preserving attributes.
 */
export function expireCookie(ctx: AthenaCookieContextRuntime, cookie: AthenaAuthCookie): void {
  ctx.setCookie(cookie.name, '', {
    ...cookie.attributes,
    maxAge: 0,
  })
}

export function deleteSessionCookie(ctx: AthenaCookieContextRuntime, skipDontRememberMe?: boolean): void {
  expireCookie(ctx, ctx.context.authCookies.sessionToken)
  expireCookie(ctx, ctx.context.authCookies.sessionData)

  if (ctx.context.options?.account?.storeAccountCookie) {
    expireCookie(ctx, ctx.context.authCookies.accountData)
    const accountStore = createAccountStore(
      ctx.context.authCookies.accountData.name,
      ctx.context.authCookies.accountData.attributes,
      ctx,
    )
    accountStore.setCookies(accountStore.clean())
  }

  const sessionStore = createSessionStore(
    ctx.context.authCookies.sessionData.name,
    ctx.context.authCookies.sessionData.attributes,
    ctx,
  )
  sessionStore.setCookies(sessionStore.clean())

  if (!skipDontRememberMe) {
    expireCookie(ctx, ctx.context.authCookies.dontRememberToken)
  }
}

export const getSessionCookie = (
  request: Request | Headers,
  config?:
    | {
        cookiePrefix?: string
        cookieName?: string
        path?: string
      }
    | undefined,
): string | null => {
  const cookies = (request instanceof Headers || !('headers' in request) ? request : request.headers).get('cookie')
  if (!cookies) {
    return null
  }

  const { cookieName = 'session_token', cookiePrefix = 'athena-auth' } = config || {}
  const parsedCookie = parseCookies(cookies)
  const getCookie = (name: string): string | undefined =>
    parsedCookie.get(name) || parsedCookie.get(`${SECURE_COOKIE_PREFIX}${name}`)
  const candidateCookieNames = Array.from(new Set([
    cookieName,
    cookieName.replace(/_/g, '-'),
    cookieName.replace(/-/g, '_'),
  ])).filter(Boolean)
  for (const candidateName of candidateCookieNames) {
    const sessionToken =
      getCookie(`${cookiePrefix}.${candidateName}`) || getCookie(`${cookiePrefix}-${candidateName}`)
    if (sessionToken) {
      return sessionToken
    }
  }
  return null
}

export const getCookieCache = async <
  SessionShape extends Record<string, unknown> = Record<string, unknown>,
  UserShape extends Record<string, unknown> = Record<string, unknown>,
>(
  request: Request | Headers,
  config?: AthenaGetCookieCacheConfig<SessionShape, UserShape>,
): Promise<{
  session: SessionShape
  user: UserShape
  updatedAt: number
  version?: string
} | null> => {
  const headers = request instanceof Headers || !('headers' in request) ? request : request.headers
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) {
    return null
  }

  const parsedCookie = parseCookies(cookieHeader)
  const cookieName = config?.cookieName || 'session_data'
  const requestedPrefix = config?.cookiePrefix || DEFAULT_COOKIE_PREFIX
  const strategy = config?.strategy || 'compact'
  const cookiePrefixes = resolveCookiePrefixes(requestedPrefix)
  const isSecure = getIsSecureCookie(config)
  const secret = getSecretOrThrow(config?.secret)

  let sessionData: string | undefined

  for (const prefix of cookiePrefixes) {
    const candidate = getSessionCookieCacheName(prefix, cookieName, isSecure)
    const cookieValue = parsedCookie.get(candidate)
    if (cookieValue) {
      sessionData = cookieValue
      break
    }
  }

  if (!sessionData) {
    const reconstructedChunks: Array<{ index: number; value: string }> = []
    for (const prefix of cookiePrefixes) {
      const candidate = getSessionCookieCacheName(prefix, cookieName, isSecure)
      for (const [name, value] of parsedCookie.entries()) {
        if (!name.startsWith(`${candidate}.`)) {
          continue
        }
        const parts = name.split('.')
        const indexStr = parts[parts.length - 1]
        const index = parseInt(indexStr || '0', 10)
        if (!Number.isNaN(index)) {
          reconstructedChunks.push({ index, value })
        }
      }
      if (reconstructedChunks.length > 0) {
        break
      }
    }

    if (reconstructedChunks.length > 0) {
      reconstructedChunks.sort((left, right) => left.index - right.index)
      sessionData = reconstructedChunks.map((chunk) => chunk.value).join('')
    }
  }

  if (!sessionData) {
    return null
  }

  if (strategy === 'jwe') {
    throw createError(
      '`jwe` strategy is not supported by the SDK cookie helper. Use compact/jwt or pass cookie data through the auth server.',
    )
  }

  if (strategy === 'jwt') {
    const payload = await verifyJwtHS256<Record<string, unknown>>(sessionData, secret)
    if (!payload) {
      return null
    }
    const sessionRecord = asObject(payload.session)
    const userRecord = asObject(payload.user)
    const updatedAt = payload.updatedAt
    if (!sessionRecord || !userRecord || typeof updatedAt !== 'number') {
      return null
    }

    if (config?.version) {
      const cookieVersion = typeof payload.version === 'string' ? payload.version : '1'
      const expectedVersion =
        typeof config.version === 'string'
          ? config.version
          : await config.version(sessionRecord as SessionShape, userRecord as UserShape)
      if (cookieVersion !== expectedVersion) {
        return null
      }
    }

    return {
      session: sessionRecord as SessionShape,
      user: userRecord as UserShape,
      updatedAt,
      version: typeof payload.version === 'string' ? payload.version : undefined,
    }
  }

  const compactPayload = parseJsonSafely<{
    session: {
      session: SessionShape
      user: UserShape
      updatedAt: number
      version?: string
    }
    expiresAt: number
    signature: string
  }>(decodeBase64UrlToString(sessionData))

  if (!compactPayload) {
    return null
  }

  const expectedSignature = await signHmacBase64Url(
    secret,
    JSON.stringify({
      ...compactPayload.session,
      expiresAt: compactPayload.expiresAt,
    }),
  )

  if (expectedSignature !== compactPayload.signature) {
    return null
  }

  if (compactPayload.expiresAt <= Date.now()) {
    return null
  }

  const resolvedSession = compactPayload.session
  if (config?.version) {
    const cookieVersion = resolvedSession.version || '1'
    const expectedVersion =
      typeof config.version === 'string'
        ? config.version
        : await config.version(resolvedSession.session, resolvedSession.user)
    if (cookieVersion !== expectedVersion) {
      return null
    }
  }

  const sessionObject = asObject(resolvedSession.session)
  const userObject = asObject(resolvedSession.user)
  if (!sessionObject || !userObject) {
    return null
  }

  return {
    session: sessionObject as SessionShape,
    user: userObject as UserShape,
    updatedAt: resolvedSession.updatedAt,
    version: resolvedSession.version,
  }
}

export {
  HOST_COOKIE_PREFIX,
  SECURE_COOKIE_PREFIX,
  createSessionStore,
  getAccountCookie,
  getChunkedCookie,
  parseCookies,
  parseSetCookieHeader,
  setCookieToHeader,
  setRequestCookie,
  splitSetCookieHeader,
  stripSecureCookiePrefix,
  toCookieOptions,
}

export type {
  AthenaAuthCookie,
  AthenaAuthCookies,
  AthenaCookieContextRuntime,
  AthenaCookieOptions,
  AthenaCookiesOptions,
  AthenaGetCookieCacheConfig,
}
