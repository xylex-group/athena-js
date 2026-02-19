import type {
  AthenaGatewayBaseOptions,
  AthenaGatewayCallOptions,
  AthenaGatewayEndpointPath,
  AthenaGatewayMethod,
  AthenaGatewayResponse,
} from './types.js'
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from './types.js'

const DEFAULT_BASE_URL = 'https://athena-db.com'
const DEFAULT_CLIENT = 'railway_direct'

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

function buildHeaders(
  config: AthenaGatewayBaseOptions,
  options?: AthenaGatewayCallOptions,
): Record<string, string> {
  const mergedStripNulls = options?.stripNulls ?? config.stripNulls ?? true
  const finalClient = options?.client ?? config.client ?? DEFAULT_CLIENT
  const finalApiKey = options?.apiKey ?? config.apiKey
  const finalSupabaseUrl = options?.supabaseUrl ?? config.supabaseUrl
  const finalSupabaseKey = options?.supabaseKey ?? config.supabaseKey
  const finalPublishEvent = options?.publishEvent ?? config.publishEvent
  const extraHeaders = {
    ...(config.headers ?? {}),
    ...(options?.headers ?? {}),
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (options?.userId ?? config.userId) {
    headers['X-User-Id'] = options?.userId ?? config.userId ?? ''
  }

  if (options?.companyId ?? config.companyId) {
    headers['X-Company-Id'] = options?.companyId ?? config.companyId ?? ''
  }

  if (options?.organizationId ?? config.organizationId) {
    headers['X-Organization-Id'] = options?.organizationId ?? config.organizationId ?? ''
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
}

async function callAthena<T>(
  config: AthenaGatewayBaseOptions,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  payload: unknown,
  options?: AthenaGatewayCallOptions,
): Promise<AthenaGatewayResponse<T>> {
  const baseUrl = (options?.baseUrl ?? config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = `${baseUrl}${endpoint}`
  const headers = buildHeaders(config, options)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload),
    })

    const rawText = await response.text()
    const parsed = parseResponseText(rawText ?? '')
    const parsedPayload = parsed as Record<string, unknown> | null
    const parsedError =
      parsedPayload && typeof parsedPayload === 'object'
        ? ((parsedPayload.error as string | undefined) ?? (parsedPayload.message as string | undefined))
        : undefined
    const hasError = typeof parsedError === 'string' && parsedError.length > 0 ? parsedError : undefined

    return {
      ok: response.ok,
      status: response.status,
      data: (parsed as T) ?? null,
      error: hasError,
      raw: parsed,
    }
  } catch (callError) {
    const message = callError instanceof Error ? callError.message : String(callError)
    return {
      ok: false,
      status: 0,
      data: null,
      error: message,
      raw: null,
    }
  }
}

export interface AthenaGatewayClient {
  baseUrl: string
  buildHeaders(options?: AthenaGatewayCallOptions): Record<string, string>
  fetchGateway<T>(payload: AthenaFetchPayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  insertGateway<T>(payload: AthenaInsertPayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  updateGateway<T>(payload: AthenaUpdatePayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  deleteGateway<T>(payload: AthenaDeletePayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
}

export function createAthenaGatewayClient(config: AthenaGatewayBaseOptions = {}): AthenaGatewayClient {
  return {
    baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
    buildHeaders(options) {
      return buildHeaders(config, options)
    },
    fetchGateway(payload, options) {
      return callAthena(config, '/gateway/fetch', 'POST', payload, options)
    },
    insertGateway(payload, options) {
      return callAthena(config, '/gateway/insert', 'PUT', payload, options)
    },
    updateGateway(payload, options) {
      return callAthena(config, '/gateway/update', 'POST', payload, options)
    },
    deleteGateway(payload, options) {
      return callAthena(config, '/gateway/delete', 'DELETE', payload, options)
    },
  }
}
