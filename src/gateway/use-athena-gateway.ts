import { useCallback, useMemo, useState } from 'react'
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallLog,
  AthenaGatewayCallOptions,
  AthenaGatewayEndpointPath,
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayMethod,
  AthenaGatewayResponse,
  AthenaGatewayResponseLog,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from './types.js'

const DEFAULT_ATHENA_BASE_URL = 'https://athena-db.com'
const DEFAULT_ATHENA_CLIENT = 'railway_direct'

function parseResponseText(text: string) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function normalizeHeaderValue(value?: string | null) {
  return value ? value : undefined
}

/**
 * useAthenaGateway
 *
 * react hook that wraps the athena database gateway api providing typed fetch
 * insert update and delete operations with loading and error state management.
 *
 * user context (userId, companyId, organizationId) can be supplied via config
 * so that applications without zustand can still inject auth headers.
 */
export function useAthenaGateway(
  config?: AthenaGatewayHookConfig,
): AthenaGatewayHookResult {
  const userId = config?.userId ?? null
  const companyId = config?.companyId ?? null
  const organizationId = config?.organizationId ?? null

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRequest, setLastRequest] = useState<AthenaGatewayCallLog | null>(null)
  const [lastResponse, setLastResponse] = useState<AthenaGatewayResponseLog | null>(null)

  const baseUrl = useMemo(
    () => config?.baseUrl ?? DEFAULT_ATHENA_BASE_URL,
    [config?.baseUrl],
  )

  const buildHeaders = useCallback(
    (options: AthenaGatewayCallOptions = {}): Record<string, string> => {
      const mergedStripNulls = options.stripNulls ?? config?.stripNulls ?? true
      const finalClient = options.client ?? config?.client ?? DEFAULT_ATHENA_CLIENT
      const finalApiKey = options.apiKey ?? config?.apiKey
      const finalSupabaseUrl = options.supabaseUrl ?? config?.supabaseUrl
      const finalSupabaseKey = options.supabaseKey ?? config?.supabaseKey
      const finalPublishEvent = options.publishEvent ?? config?.publishEvent
      const extraHeaders = {
        ...(config?.headers ?? {}),
        ...(options.headers ?? {}),
      }

      const resolvedUserId = options.userId ?? userId
      const resolvedCompanyId = options.companyId ?? companyId
      const resolvedOrganizationId = options.organizationId ?? organizationId

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (resolvedUserId) {
        headers['X-User-Id'] = resolvedUserId
      }
      if (resolvedCompanyId) {
        headers['X-Company-Id'] = resolvedCompanyId
      }
      if (resolvedOrganizationId) {
        headers['X-Organization-Id'] = resolvedOrganizationId
      }

      if (finalClient) {
        headers['X-Athena-Client'] = finalClient
      }

      if (typeof mergedStripNulls === 'boolean') {
        headers['X-Strip-Nulls'] = mergedStripNulls ? 'true' : 'false'
      }

      if (finalPublishEvent) {
        headers['X-Publish-Event'] = finalPublishEvent
      }

      if (finalApiKey) {
        headers['apikey'] = finalApiKey
        // only set x-api-key if not already provided via extraHeaders
        headers['x-api-key'] = headers['x-api-key'] ?? finalApiKey
      }

      if (finalSupabaseUrl) {
        headers['x-supabase-url'] = finalSupabaseUrl
      }
      if (finalSupabaseKey) {
        headers['x-supabase-key'] = finalSupabaseKey
      }

      Object.entries(extraHeaders).forEach(([key, value]) => {
        const normalized = normalizeHeaderValue(value)
        if (normalized) {
          headers[key] = normalized
        }
      })

      return headers
    },
    [
      userId,
      companyId,
      organizationId,
      config?.client,
      config?.stripNulls,
      config?.apiKey,
      config?.supabaseUrl,
      config?.supabaseKey,
      config?.publishEvent,
      config?.headers,
    ],
  )

  /**
   * shared runner for athena gateway requests that logs the request/response
   * and honors the configured headers including optional auth context.
   */
  const callAthena = useCallback(
    async <T>(
      endpoint: AthenaGatewayEndpointPath,
      method: AthenaGatewayMethod,
      payload: unknown,
      options?: AthenaGatewayCallOptions,
    ): Promise<AthenaGatewayResponse<T>> => {
      const requestHeaders = buildHeaders(options)
      const url = `${(options?.baseUrl ?? baseUrl).replace(/\/$/, '')}${endpoint}`
      const requestLog: AthenaGatewayCallLog = {
        endpoint,
        method,
        payload,
        headers: requestHeaders,
        timestamp: new Date().toISOString(),
      }

      setLastRequest(requestLog)
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: JSON.stringify(payload),
        })
        const rawText = await response.text()
        const parsed = parseResponseText(rawText ?? '')
        const parsedPayload = parsed as Record<string, unknown> | null
        const parsedError =
          parsedPayload && typeof parsedPayload === 'object'
            ? ((parsedPayload.error as string | undefined) ??
              (parsedPayload.message as string | undefined))
            : undefined
        const hasError =
          typeof parsedError === 'string' && parsedError.length > 0
            ? parsedError
            : undefined

        const result: AthenaGatewayResponse<T> = {
          ok: response.ok,
          status: response.status,
          data: (parsed as T) ?? null,
          error: hasError,
          raw: parsed,
        }

        const responseLog: AthenaGatewayResponseLog = {
          ...result,
          timestamp: new Date().toISOString(),
        }
        setLastResponse(responseLog)

        if (!response.ok) {
          const message =
            hasError ||
            (typeof parsed === 'string' ? parsed : undefined) ||
            response.statusText ||
            `Athena gateway ${method} ${endpoint} failed`
          setError(message)
          throw new Error(message)
        }

        return result
      } catch (callError) {
        const message =
          callError instanceof Error ? callError.message : String(callError)
        setError(message)
        setLastResponse({
          timestamp: new Date().toISOString(),
          status: 0,
          ok: false,
          data: null,
          raw: null,
          error: message,
        })
        throw callError
      } finally {
        setIsLoading(false)
      }
    },
    [baseUrl, buildHeaders],
  )

  const normalizedConfigStripNulls = useMemo(
    () => config?.stripNulls ?? true,
    [config?.stripNulls],
  )

  // fetch rows (gateway/fetch) - conditions array required by athena spec
  const fetchGateway = useCallback(
    <T = unknown>(payload: AthenaFetchPayload, options?: AthenaGatewayCallOptions) => {
      const normalizedPayload: AthenaFetchPayload = {
        ...payload,
        conditions: payload.conditions ?? [],
        strip_nulls:
          payload.strip_nulls ?? options?.stripNulls ?? normalizedConfigStripNulls,
      }
      return callAthena<T>('/gateway/fetch', 'POST', normalizedPayload, options)
    },
    [callAthena, normalizedConfigStripNulls],
  )

  // insert a new row (gateway/insert) with optional update_body for upserts
  const insertGateway = useCallback(
    <T = unknown>(payload: AthenaInsertPayload, options?: AthenaGatewayCallOptions) =>
      callAthena<T>('/gateway/insert', 'PUT', payload, options),
    [callAthena],
  )

  // update data (gateway/update) reuses the same filters as fetch
  const updateGateway = useCallback(
    <T = unknown>(payload: AthenaUpdatePayload, options?: AthenaGatewayCallOptions) => {
      const normalizedPayload: AthenaUpdatePayload = {
        ...payload,
        conditions: payload.conditions ?? [],
        strip_nulls:
          payload.strip_nulls ?? options?.stripNulls ?? normalizedConfigStripNulls,
      }
      return callAthena<T>('/gateway/update', 'POST', normalizedPayload, options)
    },
    [callAthena, normalizedConfigStripNulls],
  )

  // delete a single record (gateway/delete) by resource_id reference
  const deleteGateway = useCallback(
    <T = unknown>(payload: AthenaDeletePayload, options?: AthenaGatewayCallOptions) => {
      if (!payload.resource_id) {
        throw new Error('deleteGateway requires resource_id (the unique identifier of the record to delete)')
      }
      return callAthena<T>('/gateway/delete', 'DELETE', payload, options)
    },
    [callAthena],
  )

  return {
    fetchGateway,
    insertGateway,
    updateGateway,
    deleteGateway,
    isLoading,
    error,
    lastRequest,
    lastResponse,
    baseUrl,
  }
}
