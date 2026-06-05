import { AthenaGatewayError } from './errors.ts'

export const ATHENA_DEFAULT_BASE_URL = 'https://athena-db.com'

function describeReceivedValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') {
    return value.trim().length > 0 ? JSON.stringify(value) : 'an empty string'
  }
  return `${typeof value} ${JSON.stringify(value)}`
}

function invalidBaseUrlError(message: string, hint: string): AthenaGatewayError {
  return new AthenaGatewayError({
    code: 'INVALID_URL',
    message,
    status: 0,
    hint,
  })
}

export interface NormalizeAthenaGatewayBaseUrlOptions {
  defaultBaseUrl?: string
  label?: string
}

export function normalizeAthenaGatewayBaseUrl(
  input: string | null | undefined,
  options: NormalizeAthenaGatewayBaseUrlOptions = {},
): string {
  const label = options.label ?? 'Athena gateway base URL'
  const candidate = input ?? options.defaultBaseUrl

  if (candidate === undefined || candidate === null) {
    throw invalidBaseUrlError(
      `${label} must be a non-empty absolute http(s) URL. Received ${describeReceivedValue(input)}.`,
      'Set ATHENA_URL (or pass createClient(url, ...)) to a full URL such as "https://mirror3.athena-db.com".',
    )
  }

  const trimmed = candidate.trim()
  if (!trimmed) {
    throw invalidBaseUrlError(
      `${label} must be a non-empty absolute http(s) URL. Received ${describeReceivedValue(candidate)}.`,
      'Set ATHENA_URL (or pass createClient(url, ...)) to a full URL such as "https://mirror3.athena-db.com".',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw invalidBaseUrlError(
      `${label} must be a valid absolute http(s) URL. Received ${describeReceivedValue(candidate)}.`,
      'Use a full URL including the protocol, for example "https://mirror3.athena-db.com".',
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidBaseUrlError(
      `${label} must use http or https. Received ${JSON.stringify(trimmed)}.`,
      'Use an Athena gateway URL such as "https://mirror3.athena-db.com".',
    )
  }

  if (parsed.search || parsed.hash) {
    throw invalidBaseUrlError(
      `${label} must not include query parameters or hash fragments. Received ${JSON.stringify(trimmed)}.`,
      'Pass only the base URL. Endpoint paths such as "/gateway/fetch" are appended by the SDK.',
    )
  }

  return parsed.toString().replace(/\/+$/, '')
}

export function buildAthenaGatewayUrl(baseUrl: string, path: string): string {
  if (!path.startsWith('/')) {
    throw invalidBaseUrlError(
      `Athena gateway path must start with "/". Received ${JSON.stringify(path)}.`,
      'Use a leading slash such as "/gateway/fetch" or "/".',
    )
  }

  return `${baseUrl}${path}`
}
