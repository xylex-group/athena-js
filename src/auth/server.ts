import {
  deleteSessionCookie,
  getCookieCache,
  getCookies,
  getSessionCookie,
  parseCookies,
  setSessionCookie,
  type AthenaAuthCookies,
  type AthenaCookieContextRuntime,
  type AthenaCookieOptions,
  type AthenaCookiesOptions,
} from '../cookies/index.ts'
import type { AthenaSessionPair } from '../cookies/types.ts'

type AthenaMaybePromise<T> = T | Promise<T>
type AthenaAuthServerCookieOptions = Pick<AthenaCookiesOptions, 'session' | 'advanced'>

const DEFAULT_AUTH_BASE_PATH = '/api/auth'

export const ATHENA_AUTH_BASE_ERROR_CODES = {
  HANDLER_NOT_CONFIGURED: 'HANDLER_NOT_CONFIGURED',
  INVALID_BASE_URL: 'INVALID_BASE_URL',
  UNTRUSTED_HOST: 'UNTRUSTED_HOST',
} as const

export interface AthenaAuthSocialProviderConfig {
  clientId: string
  clientSecret: string
  scope?: string[]
  [key: string]: unknown
}

export interface AthenaAuthPluginContext {
  path?: string
  headers?: Headers
  context: {
    returned?: unknown
    responseHeaders?: Headers
    setSession?: AthenaSessionPair | null
    clearSession?: boolean
    dontRememberMe?: boolean
    cookieOverrides?: Partial<AthenaCookieOptions>
    [key: string]: unknown
  }
}

export interface AthenaAuthPluginHandlerContext extends AthenaAuthPluginContext {
  auth: AthenaAuthServer
}

export interface AthenaAuthPlugin {
  id: string
  version: string
  $ERROR_CODES?: Record<string, string>
  hooks?: {
    after?: Array<{
      matcher: (ctx: AthenaAuthPluginContext) => boolean
      handler: (ctx: AthenaAuthPluginHandlerContext) => Promise<void> | void
    }>
  }
}

export interface AthenaAuthCookieRuntimeInput {
  headers?: Headers
  responseHeaders?: Headers
  cookies?: AthenaAuthCookies
  getCookie?: (name: string) => string | null | undefined
  setCookie?: (name: string, value: string, attributes: AthenaCookieOptions) => void
  logger?: AthenaCookieContextRuntime['logger']
  setSignedCookie?: AthenaCookieContextRuntime['setSignedCookie']
  getSignedCookie?: AthenaCookieContextRuntime['getSignedCookie']
  setNewSession?: AthenaCookieContextRuntime['context']['setNewSession']
}

export interface AthenaAuthServerRuntimeOptions {
  baseURL?: string
  basePath: string
  secret: string
  cookies: AthenaAuthServerCookieOptions
}

export type AthenaAuthDatabaseFactory<TDatabase = unknown> = (
  options: AthenaAuthServerRuntimeOptions,
) => TDatabase

export type AthenaAuthBaseURLConfig = AthenaCookiesOptions['baseURL']

export type AthenaAuthTrustedOrigins =
  | string[]
  | ((request?: Request) => AthenaMaybePromise<string[]>)

export type AthenaAuthTrustedProviders =
  | string[]
  | ((request?: Request) => AthenaMaybePromise<string[]>)

export interface AthenaAuthHandlerResult {
  response?: Response
  returned?: unknown
  setSession?: AthenaSessionPair | null
  clearSession?: boolean
  dontRememberMe?: boolean
  cookieOverrides?: Partial<AthenaCookieOptions>
}

export interface AthenaAuthServerConfig<
  TDatabase = unknown,
> extends AthenaAuthServerCookieOptions {
  baseURL?: AthenaAuthBaseURLConfig
  basePath?: string
  secret: string
  database: TDatabase | AthenaAuthDatabaseFactory<TDatabase>
  socialProviders?: Record<string, AthenaAuthSocialProviderConfig>
  trustedOrigins?: AthenaAuthTrustedOrigins
  trustedProviders?: AthenaAuthTrustedProviders
  api?: Record<string, unknown>
  errorCodes?: Record<string, string>
  handler?: (
    ctx: AthenaAuthRequestContext,
  ) => AthenaMaybePromise<Response | AthenaAuthHandlerResult>
  plugins?: AthenaAuthPlugin[]
}

type ResolveAthenaAuthDatabase<TConfig extends AthenaAuthServerConfig> =
  TConfig['database'] extends (...args: never[]) => infer TResult
    ? TResult
    : TConfig['database']

export interface AthenaAuthRequestContext<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  auth: AthenaAuthServer<TConfig>
  request: Request
  url: URL
  path: string
  basePath: string
  baseURL: string
  origin: string
  headers: Headers
  cookies: AthenaAuthCookies
  trustedOrigins: string[]
  trustedProviders: string[]
  options: TConfig
  runtime: AthenaAuthServerRuntimeOptions
  database: ResolveAthenaAuthDatabase<TConfig>
  socialProviders: NonNullable<TConfig['socialProviders']>
}

export interface AthenaAuthContext<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  auth: AthenaAuthServer<TConfig>
  options: TConfig
  runtime: AthenaAuthServerRuntimeOptions
  basePath: string
  baseURL?: string
  origin?: string
  database: ResolveAthenaAuthDatabase<TConfig>
  socialProviders: NonNullable<TConfig['socialProviders']>
  plugins: AthenaAuthPlugin[]
  cookies: AthenaAuthCookies
  trustedOrigins: string[]
  trustedProviders: string[]
}

export interface AthenaAuthServerApi<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  applyResponseCookies: AthenaAuthServer<TConfig>['applyResponseCookies']
  clearSession: AthenaAuthServer<TConfig>['clearSession']
  createCookieContext: AthenaAuthServer<TConfig>['createCookieContext']
  getCookieCache: typeof getCookieCache
  getSessionCookie: typeof getSessionCookie
  resolveRequestContext: AthenaAuthServer<TConfig>['resolveRequestContext']
  runAfterHooks: AthenaAuthServer<TConfig>['runAfterHooks']
  setSession: AthenaAuthServer<TConfig>['setSession']
}

export interface AthenaAuthServer<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  config: TConfig
  options: TConfig
  runtime: AthenaAuthServerRuntimeOptions
  database: ResolveAthenaAuthDatabase<TConfig>
  socialProviders: NonNullable<TConfig['socialProviders']>
  plugins: AthenaAuthPlugin[]
  cookies: AthenaAuthCookies
  api: AthenaAuthServerApi<TConfig> & Record<string, unknown>
  $context: Promise<AthenaAuthContext<TConfig>>
  $ERROR_CODES: Record<string, string>
  createCookieContext: (input?: AthenaAuthCookieRuntimeInput) => AthenaCookieContextRuntime
  setSession: (
    input: AthenaAuthCookieRuntimeInput | undefined,
    session: AthenaSessionPair,
    dontRememberMe?: boolean,
    overrides?: Partial<AthenaCookieOptions>,
  ) => Promise<void>
  clearSession: (
    input?: AthenaAuthCookieRuntimeInput,
    skipDontRememberMe?: boolean,
  ) => void
  applyResponseCookies: (ctx: AthenaAuthPluginContext) => Promise<Headers>
  runAfterHooks: (ctx: AthenaAuthPluginContext) => Promise<AthenaAuthPluginContext>
  resolveRequestContext: (request: Request) => Promise<AthenaAuthRequestContext<TConfig>>
  handler: (request: Request) => Promise<Response>
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value
}

function serializeSetCookieValue(
  name: string,
  value: string,
  attributes: AthenaCookieOptions,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  const knownKeys = new Set([
    'maxAge',
    'expires',
    'domain',
    'path',
    'secure',
    'httpOnly',
    'partitioned',
    'sameSite',
  ])

  if (attributes.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(attributes.maxAge)}`)
  }
  if (attributes.expires instanceof Date) {
    parts.push(`Expires=${attributes.expires.toUTCString()}`)
  }
  if (attributes.domain) {
    parts.push(`Domain=${attributes.domain}`)
  }
  if (attributes.path) {
    parts.push(`Path=${attributes.path}`)
  }
  if (attributes.secure) {
    parts.push('Secure')
  }
  if (attributes.httpOnly) {
    parts.push('HttpOnly')
  }
  if (attributes.partitioned) {
    parts.push('Partitioned')
  }
  if (attributes.sameSite) {
    parts.push(`SameSite=${capitalize(attributes.sameSite)}`)
  }

  for (const [key, rawValue] of Object.entries(attributes)) {
    if (knownKeys.has(key) || rawValue === undefined || rawValue === null || rawValue === false) {
      continue
    }
    if (rawValue === true) {
      parts.push(key)
      continue
    }
    parts.push(`${key}=${String(rawValue)}`)
  }

  return parts.join('; ')
}

function readCookieFromHeaders(headers: Headers | undefined, name: string): string | undefined {
  const cookieHeader = headers?.get('cookie')
  if (!cookieHeader) {
    return undefined
  }
  return parseCookies(cookieHeader).get(name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveSessionCandidate(value: unknown): AthenaSessionPair | null {
  if (!isRecord(value)) {
    return null
  }

  const session = isRecord(value.session) ? value.session : undefined
  const user = isRecord(value.user) ? value.user : undefined
  if (session && typeof session.token === 'string' && session.token.length > 0 && user) {
    return {
      session: session as Record<string, unknown> & { token: string },
      user: user as Record<string, unknown>,
    }
  }

  return null
}

function inferSessionPair(returned: unknown): AthenaSessionPair | null {
  return (
    resolveSessionCandidate(returned) ??
    (isRecord(returned) ? resolveSessionCandidate(returned.data) : null) ??
    (isRecord(returned) ? resolveSessionCandidate(returned.session) : null)
  )
}

function resolveResponseHeaders(ctx: AthenaAuthPluginContext): Headers {
  if (ctx.context.responseHeaders instanceof Headers) {
    return ctx.context.responseHeaders
  }

  const headers = new Headers()
  ctx.context.responseHeaders = headers
  return headers
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/$/, '')
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === '/') {
    return DEFAULT_AUTH_BASE_PATH
  }

  const normalized = basePath.startsWith('/') ? basePath : `/${basePath}`
  return normalized.endsWith('/') && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized
}

function isDynamicBaseURLConfig(
  baseURL: AthenaAuthBaseURLConfig | undefined,
): baseURL is Exclude<AthenaAuthBaseURLConfig, string | undefined> {
  return (
    typeof baseURL === 'object' &&
    baseURL !== null &&
    'allowedHosts' in baseURL &&
    Array.isArray((baseURL as { allowedHosts?: unknown }).allowedHosts)
  )
}

function getRequestUrl(request: Request): URL {
  try {
    return new URL(request.url)
  } catch {
    return new URL('http://localhost')
  }
}

function getRequestHost(request: Request, url: URL): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || url.host
  return host || null
}

function getRequestProtocol(
  request: Request,
  configuredProtocol: 'http' | 'https' | 'auto' | undefined,
  url: URL,
): 'http' | 'https' {
  if (configuredProtocol === 'http' || configuredProtocol === 'https') {
    return configuredProtocol
  }

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.protocol.slice(0, -1) as 'http' | 'https'
  }

  return 'http'
}

function resolveRequestBaseURL(
  baseURL: AthenaAuthBaseURLConfig | undefined,
  request: Request,
): string | null {
  if (typeof baseURL === 'string') {
    return normalizeBaseURL(baseURL)
  }

  const requestUrl = getRequestUrl(request)
  const host = getRequestHost(request, requestUrl)
  if (!host) {
    return null
  }

  if (isDynamicBaseURLConfig(baseURL)) {
    const allowedHosts = baseURL.allowedHosts ?? []
    if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
      return null
    }
  }

  const protocol =
    typeof baseURL === 'object' && baseURL !== null
      ? getRequestProtocol(request, baseURL.protocol, requestUrl)
      : getRequestProtocol(request, undefined, requestUrl)

  return `${protocol}://${host}`
}

function getOrigin(baseURL: string | undefined): string | undefined {
  if (!baseURL) {
    return undefined
  }

  try {
    return new URL(baseURL).origin
  } catch {
    return undefined
  }
}

async function resolveTrustedOrigins(
  config: AthenaAuthServerConfig,
  baseURL: string | undefined,
  request?: Request,
): Promise<string[]> {
  const resolved =
    typeof config.trustedOrigins === 'function'
      ? await config.trustedOrigins(request)
      : (config.trustedOrigins ?? [])

  const values = [
    getOrigin(baseURL),
    ...resolved,
  ]

  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

async function resolveTrustedProviders(
  config: AthenaAuthServerConfig,
  request?: Request,
): Promise<string[]> {
  const configured =
    typeof config.trustedProviders === 'function'
      ? await config.trustedProviders(request)
      : (config.trustedProviders ?? [])

  const values = [
    ...Object.keys(config.socialProviders ?? {}),
    ...configured,
  ]

  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function createJsonResponse(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  })
}

function mergeResponseHeaders(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function defineAthenaAuthConfig<TConfig extends AthenaAuthServerConfig>(
  config: TConfig,
): TConfig {
  return config
}

export function athenaAuth<TConfig extends AthenaAuthServerConfig>(
  config: TConfig,
): AthenaAuthServer<TConfig> {
  const normalizedBasePath = normalizeBasePath(config.basePath)
  const staticBaseURL =
    typeof config.baseURL === 'string' ? normalizeBaseURL(config.baseURL) : undefined
  const runtime: AthenaAuthServerRuntimeOptions = {
    baseURL: staticBaseURL,
    basePath: normalizedBasePath,
    secret: config.secret,
    cookies: {
      session: config.session,
      advanced: config.advanced,
    },
  }
  const resolvedDatabase = (
    typeof config.database === 'function'
      ? config.database(runtime)
      : config.database
  ) as ResolveAthenaAuthDatabase<TConfig>
  const cookies = getCookies({
    baseURL: staticBaseURL ?? config.baseURL,
    session: config.session,
    advanced: config.advanced,
  })

  const auth = {} as AthenaAuthServer<TConfig>

  const createCookieContext: AthenaAuthServer<TConfig>['createCookieContext'] = (input = {}) => {
    const responseHeaders = input.responseHeaders ?? new Headers()
    const runtimeHeaders = input.headers
    const authCookies = input.cookies ?? auth.cookies

    const setCookie = input.setCookie ?? ((name, value, attributes) => {
      responseHeaders.append(
        'set-cookie',
        serializeSetCookieValue(name, value, attributes),
      )
    })

    return {
      headers: runtimeHeaders,
      getCookie: input.getCookie ?? (name => readCookieFromHeaders(runtimeHeaders, name)),
      setCookie,
      logger: input.logger,
      setSignedCookie: input.setSignedCookie,
      getSignedCookie: input.getSignedCookie,
      context: {
        secret: runtime.secret,
        authCookies,
        sessionConfig: {
          expiresIn: config.session?.expiresIn,
        },
        options: {
          session: {
            cookieCache: config.session?.cookieCache,
          },
          account: {
            storeAccountCookie: true,
          },
        },
        setNewSession: input.setNewSession,
      },
    }
  }

  const setSession: AthenaAuthServer<TConfig>['setSession'] = async (
    input,
    session,
    dontRememberMe,
    overrides,
  ) => {
    const cookieContext = createCookieContext(input)
    await setSessionCookie(cookieContext, session, dontRememberMe, overrides)
  }

  const clearSession: AthenaAuthServer<TConfig>['clearSession'] = (
    input,
    skipDontRememberMe,
  ) => {
    const cookieContext = createCookieContext(input)
    deleteSessionCookie(cookieContext, skipDontRememberMe)
  }

  const applyResponseCookies: AthenaAuthServer<TConfig>['applyResponseCookies'] = async ctx => {
    const responseHeaders = resolveResponseHeaders(ctx)
    const session =
      ctx.context.setSession ??
      inferSessionPair(ctx.context.returned)

    if (ctx.context.clearSession) {
      clearSession({
        headers: ctx.headers,
        responseHeaders,
      })
    }

    if (session) {
      await setSession(
        {
          headers: ctx.headers,
          responseHeaders,
        },
        session,
        ctx.context.dontRememberMe,
        ctx.context.cookieOverrides,
      )
    }

    return responseHeaders
  }

  const runAfterHooks: AthenaAuthServer<TConfig>['runAfterHooks'] = async ctx => {
    for (const plugin of auth.plugins) {
      for (const hook of plugin.hooks?.after ?? []) {
        if (!hook.matcher(ctx)) {
          continue
        }
        await hook.handler({
          ...ctx,
          auth,
        })
      }
    }
    return ctx
  }

  const resolveRequestContext: AthenaAuthServer<TConfig>['resolveRequestContext'] = async request => {
    const requestUrl = getRequestUrl(request)
    const resolvedBaseURL = resolveRequestBaseURL(config.baseURL, request)
    if (!resolvedBaseURL) {
      throw new Error(
        isDynamicBaseURLConfig(config.baseURL)
          ? 'Could not resolve base URL from request. Check allowedHosts/baseURL.'
          : 'Could not resolve base URL from request.',
      )
    }

    const requestCookies = getCookies({
      baseURL: resolvedBaseURL,
      session: config.session,
      advanced: config.advanced,
    })
    const trustedOrigins = await resolveTrustedOrigins(config, resolvedBaseURL, request)
    const trustedProviders = await resolveTrustedProviders(config, request)

    return {
      auth,
      request,
      url: requestUrl,
      path: requestUrl.pathname,
      basePath: normalizedBasePath,
      baseURL: resolvedBaseURL,
      origin: getOrigin(resolvedBaseURL) ?? resolvedBaseURL,
      headers: request.headers,
      cookies: requestCookies,
      trustedOrigins,
      trustedProviders,
      options: config,
      runtime: {
        ...runtime,
        baseURL: resolvedBaseURL,
      },
      database: auth.database,
      socialProviders: auth.socialProviders,
    }
  }

  const handler: AthenaAuthServer<TConfig>['handler'] = async request => {
    const requestContext = await resolveRequestContext(request)

    if (typeof config.handler !== 'function') {
      return createJsonResponse(
        {
          ok: false,
          code: ATHENA_AUTH_BASE_ERROR_CODES.HANDLER_NOT_CONFIGURED,
          error: 'No native auth handler was configured for this Athena auth instance.',
          path: requestContext.path,
          basePath: requestContext.basePath,
        },
        { status: 501 },
      )
    }

    const result = await config.handler(requestContext)
    if (result instanceof Response) {
      return result
    }

    const response =
      result.response ??
      (result.returned !== undefined
        ? createJsonResponse(result.returned)
        : new Response(null, { status: 204 }))

    const responseHeaders = new Headers(response.headers)
    await runAfterHooks({
      path: requestContext.path,
      headers: request.headers,
      context: {
        responseHeaders,
        returned: result.returned,
        setSession: result.setSession,
        clearSession: result.clearSession,
        dontRememberMe: result.dontRememberMe,
        cookieOverrides: result.cookieOverrides,
      },
    })

    return mergeResponseHeaders(response, responseHeaders)
  }

  const api: AthenaAuthServer<TConfig>['api'] = Object.assign(
    {
      applyResponseCookies,
      clearSession,
      createCookieContext,
      getCookieCache,
      getSessionCookie,
      resolveRequestContext,
      runAfterHooks,
      setSession,
    } satisfies AthenaAuthServerApi<TConfig>,
    config.api ?? {},
  )

  const $ERROR_CODES = {
    ...auth.plugins?.reduce<Record<string, string>>((acc, plugin) => {
      if (plugin.$ERROR_CODES) {
        return {
          ...acc,
          ...plugin.$ERROR_CODES,
        }
      }
      return acc
    }, {}),
    ...(config.errorCodes ?? {}),
    ...ATHENA_AUTH_BASE_ERROR_CODES,
  }

  Object.assign(auth, {
    config,
    options: config,
    runtime,
    database: resolvedDatabase,
    socialProviders: (config.socialProviders ?? {}) as NonNullable<TConfig['socialProviders']>,
    plugins: [...(config.plugins ?? [])],
    cookies,
    api,
    $ERROR_CODES,
    createCookieContext,
    setSession,
    clearSession,
    applyResponseCookies,
    runAfterHooks,
    resolveRequestContext,
    handler,
  } satisfies Omit<AthenaAuthServer<TConfig>, '$context'>)

  auth.$context = Promise.all([
    resolveTrustedOrigins(config, staticBaseURL),
    resolveTrustedProviders(config),
  ]).then(([trustedOrigins, trustedProviders]) => ({
    auth,
    options: config,
    runtime,
    basePath: normalizedBasePath,
    baseURL: staticBaseURL,
    origin: getOrigin(staticBaseURL),
    database: auth.database,
    socialProviders: auth.socialProviders,
    plugins: auth.plugins,
    cookies: auth.cookies,
    trustedOrigins,
    trustedProviders,
  }))

  return auth
}
