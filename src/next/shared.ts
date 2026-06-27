import { AthenaClient } from '../client.ts'
import type {
  AthenaClientExperimentalOptions,
  AthenaClientSessionLike,
  AthenaClientSessionOptions,
  AthenaCreateClientAuthOptions,
  AthenaHeaderBag,
  AthenaSdkClientWithAuth,
  AthenaSdkClientWithStorage,
} from '../client.ts'
import type { AthenaAuthSessionResponse } from '../auth/types.ts'
import type { BackendConfig, BackendType } from '../gateway/types.ts'

export interface AthenaRequestCookiesBag {
  getAll(): Array<{
    name: string
    value: string
  }>
}

export type AthenaRequestHeadersInput =
  | AthenaHeaderBag
  | Record<string, string | null | undefined>

export type AthenaRequestCookiesInput =
  | AthenaRequestCookiesBag
  | string
  | null
  | undefined

export type AthenaAdapterExperimentalOptions = Omit<
  AthenaClientExperimentalOptions,
  'athenaStorageBackend'
>

export interface AthenaAdapterBaseOptions {
  env?: Record<string, string | undefined>
  url?: string | null | undefined
  gatewayUrl?: string | null | undefined
  authUrl?: string | null | undefined
  chatUrl?: string | null | undefined
  chatWsUrl?: string | null | undefined
  storageUrl?: string | null | undefined
  key?: string | null | undefined
  client?: string | null | undefined
  backend?: BackendConfig | BackendType
  headers?: Record<string, string>
  auth?: AthenaCreateClientAuthOptions
  forceNoCache?: boolean
  storage?: boolean
  experimental?: AthenaAdapterExperimentalOptions
}

export interface AthenaServerRequestOptions {
  requestHeaders?: AthenaRequestHeadersInput
  requestCookies?: AthenaRequestCookiesInput
}

export interface AthenaServerSessionInput {
  session?: AthenaClientSessionLike | AthenaAuthSessionResponse | null
}

type InferStrict<TOptions> =
  TOptions extends { experimental: { typecheckColumns: true } } ? true : false

export type AthenaAdapterClient<TOptions> =
  TOptions extends { storage: true }
    ? AthenaSdkClientWithStorage<InferStrict<TOptions>>
    : AthenaSdkClientWithAuth<InferStrict<TOptions>>

export interface AthenaResolvedRequestContext {
  requestHeaders?: AthenaRequestHeadersInput
  cookieHeader?: string
  bearerToken?: string
}

function cloneHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  return headers ? { ...headers } : undefined
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : undefined
}

function readHeaderValue(
  headers: AthenaRequestHeadersInput | undefined,
  targetKey: string,
): string | undefined {
  if (!headers) {
    return undefined
  }

  if (typeof (headers as AthenaHeaderBag).get === 'function') {
    return normalizeOptionalString((headers as AthenaHeaderBag).get(targetKey))
  }

  const normalizedTargetKey = targetKey.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedTargetKey) {
      continue
    }

    return normalizeOptionalString(value ?? undefined)
  }

  return undefined
}

function resolveBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) {
    return undefined
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  return token ? token : undefined
}

function serializeRequestCookies(
  requestCookies: AthenaRequestCookiesInput,
): string | undefined {
  if (typeof requestCookies === 'string') {
    return normalizeOptionalString(requestCookies)
  }

  if (!requestCookies) {
    return undefined
  }

  const pairs = requestCookies
    .getAll()
    .map(cookie => {
      const name = normalizeOptionalString(cookie.name)
      if (!name) {
        return undefined
      }

      return `${name}=${cookie.value}`
    })
    .filter((value): value is string => Boolean(value))

  return pairs.length > 0 ? pairs.join('; ') : undefined
}

async function loadNextHeadersModule() {
  try {
    return await import('next/headers')
  } catch {
    throw new Error(
      'Athena Next server helpers require a Next.js server runtime. Call them from a Server Component, Route Handler, or pass requestHeaders/requestCookies explicitly.',
    )
  }
}

export async function resolveServerRequestContext(
  options: AthenaServerRequestOptions = {},
): Promise<AthenaResolvedRequestContext> {
  let requestHeaders = options.requestHeaders
  let requestCookies = options.requestCookies

  if (!requestHeaders && !requestCookies) {
    const nextHeaders = await loadNextHeadersModule()
    const [headersList, cookiesList] = await Promise.all([
      nextHeaders.headers(),
      nextHeaders.cookies(),
    ])
    requestHeaders = headersList
    requestCookies = cookiesList
  }

  const cookieHeader =
    serializeRequestCookies(requestCookies) ??
    readHeaderValue(requestHeaders, 'cookie')
  const authorizationHeader = readHeaderValue(requestHeaders, 'authorization')

  const sessionHeaders =
    cookieHeader || authorizationHeader
      ? {
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          ...(authorizationHeader
            ? { authorization: authorizationHeader }
            : {}),
        }
      : requestHeaders

  return {
    requestHeaders: sessionHeaders,
    cookieHeader,
    bearerToken: resolveBearerToken(authorizationHeader),
  }
}

function buildRequestScopedAuthConfig(
  auth: AthenaCreateClientAuthOptions | undefined,
  context: AthenaResolvedRequestContext | undefined,
): AthenaCreateClientAuthOptions {
  return {
    credentials: 'include',
    ...auth,
    headers: cloneHeaders(auth?.headers),
    ...(auth?.cookie === undefined && context?.cookieHeader
      ? { cookie: context.cookieHeader }
      : {}),
    ...(auth?.bearerToken === undefined && context?.bearerToken
      ? { bearerToken: context.bearerToken }
      : {}),
  }
}

export function createAdapterClient<
  TOptions extends AthenaAdapterBaseOptions | undefined = undefined,
>(
  options?: TOptions,
  context?: AthenaResolvedRequestContext,
): AthenaAdapterClient<TOptions> {
  const experimental = options?.storage
    ? {
        ...(options.experimental ?? {}),
        athenaStorageBackend: true as const,
      }
    : options?.experimental

  const client = AthenaClient.fromEnvironment({
    env: options?.env,
    url: options?.url,
    gatewayUrl: options?.gatewayUrl,
    authUrl: options?.authUrl,
    chatUrl: options?.chatUrl,
    chatWsUrl: options?.chatWsUrl,
    storageUrl: options?.storageUrl,
    key: options?.key,
    client: options?.client,
    backend: options?.backend,
    headers: cloneHeaders(options?.headers),
    forceNoCache: options?.forceNoCache,
    auth: buildRequestScopedAuthConfig(options?.auth, context),
    ...(experimental ? { experimental } : {}),
  })

  return client as AthenaAdapterClient<TOptions>
}

export function buildSessionClientOptions(
  context: AthenaResolvedRequestContext,
  options: Pick<AthenaAdapterBaseOptions, 'auth' | 'forceNoCache' | 'headers'>,
): AthenaClientSessionOptions {
  return {
    requestHeaders: context.requestHeaders,
    forceNoCache: options.forceNoCache,
    headers: cloneHeaders(options.headers),
    auth: {
      ...(options.auth ?? {}),
      headers: cloneHeaders(options.auth?.headers),
      ...(options.auth?.bearerToken === undefined
        ? { bearerToken: null }
        : {}),
    },
  }
}
