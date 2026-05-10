import { isAthenaGatewayError } from '../gateway/errors.ts'
import type {
  AthenaQueryError,
  AthenaQueryResult,
  AthenaResponseLike,
  AthenaRetryCount,
  AthenaRetryDelay,
  QueryKey,
} from './types.ts'

type RetryOptions = {
  retry?: AthenaRetryCount
  retryDelay?: AthenaRetryDelay
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value)
}

function encodePrimitive(value: string | number | boolean | null | undefined): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `str:${value}`
  if (typeof value === 'number') return `num:${Number.isFinite(value) ? value : 'nan'}`
  return `bool:${value ? '1' : '0'}`
}

function stableSerialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  const valueType = typeof value
  if (valueType === 'string') return `"${value}"`
  if (valueType === 'number') return Number.isFinite(value as number) ? String(value) : 'null'
  if (valueType === 'boolean') return (value as boolean) ? 'true' : 'false'
  if (valueType === 'bigint') return `${String(value)}n`
  if (valueType === 'symbol') return `symbol:${String(value)}`
  if (valueType === 'function') {
    const namedFunction = value as { name?: string }
    return `function:${namedFunction.name || 'anonymous'}`
  }

  if (value instanceof Date) return `date:${value.toISOString()}`

  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item, seen)).join(',')}]`
  }

  if (valueType === 'object') {
    const objectValue = value as Record<string, unknown>
    if (seen.has(objectValue)) return '[circular]'
    seen.add(objectValue)
    const keys = Object.keys(objectValue).sort()
    const serialized = `{${keys
      .map(key => `${key}:${stableSerialize(objectValue[key], seen)}`)
      .join(',')}}`
    seen.delete(objectValue)
    return serialized
  }

  return String(value)
}

export function safeSerializeQueryKey(queryKey: QueryKey): string {
  try {
    if (typeof queryKey === 'string') {
      return `key:${queryKey}`
    }

    if (Array.isArray(queryKey) && queryKey.every(isPrimitive)) {
      return `arr:${queryKey.map(item => encodePrimitive(item)).join('|')}`
    }

    return `ser:${stableSerialize(queryKey, new WeakSet<object>())}`
  } catch {
    try {
      return `fallback:${String(queryKey)}`
    } catch {
      return 'fallback:[unserializable-query-key]'
    }
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function resolveRetryCount(retry: AthenaRetryCount | undefined): number {
  if (retry === false || retry == null) return 0
  if (!Number.isFinite(retry)) return 0
  return Math.max(0, Math.trunc(retry))
}

function resolveRetryDelay(retryDelay: AthenaRetryDelay | undefined, attempt: number): number {
  if (typeof retryDelay === 'function') {
    const resolved = retryDelay(attempt)
    if (!Number.isFinite(resolved)) return 0
    return Math.max(0, resolved)
  }
  if (typeof retryDelay === 'number') {
    if (!Number.isFinite(retryDelay)) return 0
    return Math.max(0, retryDelay)
  }
  return 0
}

export async function runWithRetry<T>(
  execute: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const retries = resolveRetryCount(options?.retry)
  let attempt = 0

  for (;;) {
    attempt += 1
    try {
      return await execute(attempt)
    } catch (error) {
      if (attempt > retries) {
        throw error
      }
      const delay = resolveRetryDelay(options?.retryDelay, attempt)
      await sleep(delay)
    }
  }
}

function errorMessageFromUnknown(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (isRecord(error)) {
    const messageCandidate = error.message ?? error.error
    if (typeof messageCandidate === 'string' && messageCandidate.trim()) {
      return messageCandidate.trim()
    }
  }
  return 'Athena request failed'
}

export function normalizeAthenaError(
  error: unknown,
  source?: unknown,
): AthenaQueryError {
  if (
    isRecord(error) &&
    typeof error.message === 'string' &&
    (error.status === undefined || typeof error.status === 'number') &&
    (error.code === undefined || typeof error.code === 'string')
  ) {
    return {
      message: error.message,
      status: typeof error.status === 'number' ? error.status : undefined,
      code: typeof error.code === 'string' ? error.code : undefined,
      details: error.details,
      raw: error.raw ?? source ?? error,
    }
  }

  if (isAthenaGatewayError(error)) {
    const details = error.toDetails()
    return {
      message: details.message,
      status: details.status,
      code: details.code,
      details,
      raw: source ?? error,
    }
  }

  if (isRecord(source) && source.errorDetails && isRecord(source.errorDetails)) {
    const details = source.errorDetails
    return {
      message: errorMessageFromUnknown(error ?? source.error),
      status: typeof source.status === 'number' ? source.status : undefined,
      code: typeof details.code === 'string' ? details.code : undefined,
      details,
      raw: source,
    }
  }

  if (isRecord(source) && typeof source.status === 'number') {
    return {
      message: errorMessageFromUnknown(error),
      status: source.status,
      details: source,
      raw: source,
    }
  }

  return {
    message: errorMessageFromUnknown(error),
    raw: source ?? error,
  }
}

export function isAthenaResponseLike<T>(value: unknown): value is AthenaResponseLike<T> {
  if (!isRecord(value)) return false
  return (
    'data' in value ||
    'error' in value ||
    'status' in value ||
    'raw' in value ||
    'errorDetails' in value
  )
}

export function normalizeAthenaResult<TQueryFnData, TData = TQueryFnData>(
  value: unknown,
  select?: (data: TQueryFnData) => TData,
): AthenaQueryResult<TData> {
  if (isAthenaResponseLike<TQueryFnData>(value)) {
    const status = typeof value.status === 'number' ? value.status : value.error != null ? 500 : 200
    if (value.error != null) {
      return {
        data: undefined,
        error: normalizeAthenaError(value.error, value),
        status,
        raw: value.raw ?? value,
      }
    }

    const sourceData = (value.data ?? undefined) as TQueryFnData | undefined
    const selectedData =
      sourceData === undefined
        ? undefined
        : select
          ? select(sourceData)
          : (sourceData as unknown as TData)

    return {
      data: selectedData,
      error: null,
      status,
      raw: value.raw ?? value,
    }
  }

  const sourceData = value as TQueryFnData
  const selectedData = select
    ? select(sourceData)
    : (sourceData as unknown as TData)

  return {
    data: selectedData,
    error: null,
    status: 200,
    raw: value,
  }
}
