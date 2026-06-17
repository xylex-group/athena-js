import type { AthenaResult } from './client.ts'
import { AthenaGatewayError, isAthenaGatewayError } from './gateway/errors.ts'
import type { AthenaGatewayErrorCode, AthenaGatewayErrorDetails } from './gateway/types.ts'
import type { AthenaOperationName } from './operation-types.ts'
import { parseBooleanFlag as parseBooleanFlagUtil } from './utils/parse-boolean-flag.ts'

export type AthenaErrorKind =
  | 'unique_violation'
  | 'not_found'
  | 'validation'
  | 'auth'
  | 'rate_limit'
  | 'transient'
  | 'unknown'

export const AthenaErrorKind = {
  UniqueViolation: 'unique_violation',
  NotFound: 'not_found',
  Validation: 'validation',
  Auth: 'auth',
  RateLimit: 'rate_limit',
  Transient: 'transient',
  Unknown: 'unknown',
} as const

export type AthenaErrorCode =
  | 'UNIQUE_VIOLATION'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NETWORK_UNAVAILABLE'
  | 'TRANSIENT_FAILURE'
  | 'HTTP_FAILURE'
  | 'UNKNOWN'

export const AthenaErrorCode = {
  UniqueViolation: 'UNIQUE_VIOLATION',
  NotFound: 'NOT_FOUND',
  ValidationFailed: 'VALIDATION_FAILED',
  AuthUnauthorized: 'AUTH_UNAUTHORIZED',
  AuthForbidden: 'AUTH_FORBIDDEN',
  RateLimited: 'RATE_LIMITED',
  NetworkUnavailable: 'NETWORK_UNAVAILABLE',
  TransientFailure: 'TRANSIENT_FAILURE',
  HttpFailure: 'HTTP_FAILURE',
  Unknown: 'UNKNOWN',
} as const satisfies Record<string, AthenaErrorCode>

export type AthenaErrorCategory = 'transport' | 'client' | 'server' | 'database' | 'unknown'

export const AthenaErrorCategory = {
  Transport: 'transport',
  Client: 'client',
  Server: 'server',
  Database: 'database',
  Unknown: 'unknown',
} as const satisfies Record<string, AthenaErrorCategory>

export interface AthenaOperationContext {
  table?: string
  operation?: AthenaOperationName
  identity?: string | Record<string, unknown>
}

export interface NormalizedAthenaError {
  kind: AthenaErrorKind
  code: AthenaErrorCode
  category: AthenaErrorCategory
  retryable: boolean
  status?: number
  constraint?: string
  table?: string
  operation?: AthenaOperationName
  message: string
  raw: unknown
}

export interface AthenaErrorInput {
  code: AthenaErrorCode
  kind: AthenaErrorKind
  category: AthenaErrorCategory
  message: string
  status?: number
  retryable?: boolean
  requestId?: string
  context?: AthenaOperationContext
  raw?: unknown
}

export interface UnwrapOptions {
  allowNull?: boolean
  context?: AthenaOperationContext
}

export interface UnwrapOneOptions extends UnwrapOptions {
  requireExactlyOne?: boolean
}

export interface IntCoercionOptions {
  strictBigInt?: boolean
  min?: number
  max?: number
}

export type RetryBackoffStrategy =
  | 'linear'
  | 'exponential'
  | ((attempt: number, error: unknown) => number)

export interface RetryConfig {
  retries: number
  baseDelayMs?: number
  maxDelayMs?: number
  backoff?: RetryBackoffStrategy
  jitter?: boolean | number
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
}

export interface RequireAffectedOptions {
  min?: number
}

/**
 * Parses a string-based boolean flag with a deterministic fallback.
 *
 * Accepts common truthy/falsey token variants used by env vars and CLI flags.
 */
export function parseBooleanFlag(
  rawValue: string | undefined,
  fallback: boolean,
): boolean {
  return parseBooleanFlagUtil(rawValue, fallback)
}

export class AthenaError extends Error {
  readonly code: AthenaErrorCode
  readonly kind: AthenaErrorKind
  readonly category: AthenaErrorCategory
  readonly status?: number
  readonly retryable: boolean
  readonly requestId?: string
  readonly context?: AthenaOperationContext
  readonly raw?: unknown

  constructor(input: AthenaErrorInput) {
    super(input.message)
    this.name = 'AthenaError'
    this.code = input.code
    this.kind = input.kind
    this.category = input.category
    this.status = input.status
    this.retryable = input.retryable ?? false
    this.requestId = input.requestId
    this.context = input.context
    this.raw = input.raw
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function messageFromUnknownError(error: unknown): string | undefined {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }
  if (!isRecord(error)) {
    return undefined
  }
  return firstNonEmptyString(error.message, error.error, error.details)
}

function gatewayCodeFromUnknownError(error: unknown): AthenaGatewayErrorCode | undefined {
  if (!isRecord(error) || typeof error.gatewayCode !== 'string') {
    return undefined
  }
  return error.gatewayCode as AthenaGatewayErrorCode
}

function isAthenaResultErrorLike(
  value: unknown,
): value is {
  message: string
  athenaCode?: AthenaErrorCode
  kind?: AthenaErrorKind
  category?: AthenaErrorCategory
  retryable?: boolean
  status?: number
  constraint?: string
  table?: string
  operation?: AthenaOperationName
  raw?: unknown
} {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    (value.athenaCode === undefined || isAthenaErrorCode(value.athenaCode)) &&
    (value.kind === undefined || isAthenaErrorKind(value.kind)) &&
    (value.category === undefined || isAthenaErrorCategory(value.category)) &&
    (value.retryable === undefined || typeof value.retryable === 'boolean') &&
    (value.status === undefined || typeof value.status === 'number')
  )
}

function isAthenaErrorKind(value: unknown): value is AthenaErrorKind {
  return (
    value === 'unique_violation' ||
    value === 'not_found' ||
    value === 'validation' ||
    value === 'auth' ||
    value === 'rate_limit' ||
    value === 'transient' ||
    value === 'unknown'
  )
}

function isAthenaErrorCode(value: unknown): value is AthenaErrorCode {
  return (
    value === 'UNIQUE_VIOLATION' ||
    value === 'NOT_FOUND' ||
    value === 'VALIDATION_FAILED' ||
    value === 'AUTH_UNAUTHORIZED' ||
    value === 'AUTH_FORBIDDEN' ||
    value === 'RATE_LIMITED' ||
    value === 'NETWORK_UNAVAILABLE' ||
    value === 'TRANSIENT_FAILURE' ||
    value === 'HTTP_FAILURE' ||
    value === 'UNKNOWN'
  )
}

function isAthenaErrorCategory(value: unknown): value is AthenaErrorCategory {
  return (
    value === 'transport' ||
    value === 'client' ||
    value === 'server' ||
    value === 'database' ||
    value === 'unknown'
  )
}

function isNormalizedAthenaError(value: unknown): value is NormalizedAthenaError {
  return (
    isRecord(value) &&
    isAthenaErrorKind(value.kind) &&
    isAthenaErrorCode(value.code) &&
    isAthenaErrorCategory(value.category) &&
    typeof value.retryable === 'boolean' &&
    typeof value.message === 'string' &&
    'raw' in value
  )
}

function withContextOverrides(
  normalized: NormalizedAthenaError,
  context?: AthenaOperationContext,
): NormalizedAthenaError {
  if (!context?.table && !context?.operation) {
    return normalized
  }

  return {
    ...normalized,
    table: context.table ?? normalized.table,
    operation: context.operation ?? normalized.operation,
  }
}

function resolveAttachedNormalizedError(resultOrError: unknown): NormalizedAthenaError | undefined {
  if (!isRecord(resultOrError)) return undefined
  if (!('__athenaNormalizedError' in resultOrError)) return undefined
  const candidate = resultOrError.__athenaNormalizedError
  return isNormalizedAthenaError(candidate) ? candidate : undefined
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value)
    return serialized ?? String(value)
  } catch {
    return '[unserializable]'
  }
}

function contextHint(context?: AthenaOperationContext): string | undefined {
  if (!context?.identity) return undefined
  const identity =
    typeof context.identity === 'string' ? context.identity : safeStringify(context.identity)
  return `Identity: ${identity}`
}

function isAthenaResultLike(value: unknown): value is AthenaResult<unknown> {
  return (
    isRecord(value) &&
    'status' in value &&
    'error' in value &&
    'data' in value &&
    typeof value.status === 'number'
  )
}

function operationFromDetails(details?: AthenaGatewayErrorDetails | null): string | undefined {
  if (!details?.endpoint) return undefined
  if (details.endpoint === '/gateway/fetch' || details.endpoint === '/gateway/query') return 'select'
  if (details.endpoint === '/gateway/insert') return 'insert'
  if (details.endpoint === '/gateway/update') return 'update'
  if (details.endpoint === '/gateway/delete') return 'delete'
  if (details.endpoint === '/gateway/rpc' || details.endpoint.startsWith('/rpc/')) return 'rpc'
  return undefined
}

function matchRegex(input: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(input)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function extractConstraint(message: string): string | undefined {
  return matchRegex(message, [
    /unique constraint\s+["'`]([^"'`]+)["'`]/i,
    /constraint\s+["'`]([^"'`]+)["'`]/i,
  ])
}

function extractTable(message: string): string | undefined {
  return matchRegex(message, [
    /(?:table|relation)\s+["'`]([^"'`]+)["'`]/i,
    /on\s+table\s+([a-zA-Z0-9_.]+)/i,
  ])
}

function classifyKind(status: number | undefined, code: AthenaGatewayErrorCode | undefined, message: string): AthenaErrorKind {
  const lower = message.toLowerCase()
  const hasUniquePattern =
    lower.includes('unique constraint') ||
    lower.includes('duplicate key') ||
    lower.includes('already exists') ||
    lower.includes('duplicate')
  const hasNotFoundPattern = lower.includes('not found') || lower.includes('no rows')
  const hasValidationPattern =
    lower.includes('validation') || lower.includes('invalid') || lower.includes('malformed')
  const hasAuthPattern =
    lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('auth')
  const hasRateLimitPattern = lower.includes('rate limit') || lower.includes('too many requests')
  const hasTransientPattern =
    lower.includes('timeout') ||
    lower.includes('temporar') ||
    lower.includes('connection reset') ||
    lower.includes('socket') ||
    lower.includes('deadlock')

  if (status === 409 || hasUniquePattern) return 'unique_violation'
  if (status === 404 || hasNotFoundPattern) return 'not_found'
  if (status === 401 || status === 403 || hasAuthPattern) return 'auth'
  if (status === 429 || hasRateLimitPattern) return 'rate_limit'
  if (code === 'INVALID_URL') return 'validation'
  if (status === 400 || status === 422 || hasValidationPattern) return 'validation'
  if (code === 'NETWORK_ERROR' || status === 0 || (status !== undefined && status >= 500) || hasTransientPattern) {
    return 'transient'
  }
  return 'unknown'
}

function toAthenaErrorCode(
  kind: AthenaErrorKind,
  status: number | undefined,
  gatewayCode?: AthenaGatewayErrorCode,
): AthenaErrorCode {
  if (gatewayCode === 'INVALID_URL') {
    return AthenaErrorCode.ValidationFailed
  }

  if (gatewayCode === 'NETWORK_ERROR' || (kind === 'transient' && status === 0)) {
    return AthenaErrorCode.NetworkUnavailable
  }

  switch (kind) {
    case 'unique_violation':
      return AthenaErrorCode.UniqueViolation
    case 'not_found':
      return AthenaErrorCode.NotFound
    case 'validation':
      return AthenaErrorCode.ValidationFailed
    case 'rate_limit':
      return AthenaErrorCode.RateLimited
    case 'auth':
      if (status === 403) {
        return AthenaErrorCode.AuthForbidden
      }
      return AthenaErrorCode.AuthUnauthorized
    case 'transient':
      return status !== undefined && status >= 500
        ? AthenaErrorCode.HttpFailure
        : AthenaErrorCode.TransientFailure
    case 'unknown':
    default:
      return status !== undefined && status >= 400
        ? AthenaErrorCode.HttpFailure
        : AthenaErrorCode.Unknown
  }
}

function toAthenaErrorCategory(kind: AthenaErrorKind, status: number | undefined): AthenaErrorCategory {
  if (kind === 'transient' && (status === 0 || status === undefined)) {
    return AthenaErrorCategory.Transport
  }
  if (kind === 'unique_violation') return AthenaErrorCategory.Database
  if (kind === 'validation' || kind === 'auth' || kind === 'not_found') return AthenaErrorCategory.Client
  if (kind === 'rate_limit' || kind === 'transient') return AthenaErrorCategory.Server
  return AthenaErrorCategory.Unknown
}

function isRetryable(kind: AthenaErrorKind, status: number | undefined): boolean {
  if (kind === 'rate_limit' || kind === 'transient') return true
  return status !== undefined && status >= 500
}

function toGatewayCode(kind: AthenaErrorKind, status?: number): AthenaGatewayErrorCode {
  if (kind === 'transient' && (status === 0 || status === undefined)) return 'NETWORK_ERROR'
  if (kind === 'validation') return 'INVALID_JSON'
  if (status !== undefined && status >= 400) return 'HTTP_ERROR'
  return 'UNKNOWN_ERROR'
}

function toAthenaGatewayError(
  source: unknown,
  fallbackMessage: string,
  context?: AthenaOperationContext,
): AthenaGatewayError {
  if (isAthenaGatewayError(source)) {
    return source
  }

  if (isAthenaResultLike(source) && source.errorDetails) {
    const message =
      messageFromUnknownError(source.error) ??
      source.errorDetails.message ??
      fallbackMessage
    return new AthenaGatewayError({
      code: source.errorDetails.code,
      message,
      status: source.status,
      endpoint: source.errorDetails.endpoint,
      method: source.errorDetails.method,
      requestId: source.errorDetails.requestId,
      hint:
        (isRecord(source.error) ? firstNonEmptyString(source.error.hint) : undefined) ??
        source.errorDetails.hint,
      cause:
        (isRecord(source.error) ? firstNonEmptyString(source.error.cause) : undefined) ??
        source.errorDetails.cause,
    })
  }

  const normalized = normalizeAthenaError(source, context)
  const message =
    isAthenaResultLike(source) && source.error == null && source.errorDetails == null
      ? fallbackMessage
      : normalized.message || fallbackMessage

  return new AthenaGatewayError({
    code: toGatewayCode(normalized.kind, normalized.status),
    message,
    status: normalized.status ?? 0,
    hint:
      normalized.constraint != null
        ? `Constraint: ${normalized.constraint}`
        : contextHint(context),
    cause: typeof normalized.raw === 'string' ? normalized.raw : safeStringify(normalized.raw),
  })
}

/**
 * Returns `true` when a result is successful (`2xx` status and no `error`).
 */
export function isOk<T>(result: AthenaResult<T>): boolean {
  return result.error == null && result.status >= 200 && result.status < 300
}

/**
 * @deprecated Prefer `result.error` on failed `AthenaResult` values and the
 * structured fields already attached to thrown SDK errors. This helper is
 * retained for compatibility with mixed unknown inputs.
 *
 * Normalizes any Athena failure shape into a stable, typed error envelope.
 *
 * Accepts `AthenaResult`, `AthenaGatewayError`, native `Error`, or unknown values.
 * Optional `context` can override inferred table/operation metadata for clearer diagnostics.
 */
export function normalizeAthenaError(
  resultOrError: unknown,
  context?: AthenaOperationContext,
): NormalizedAthenaError {
  const attached = resolveAttachedNormalizedError(resultOrError)
  if (attached) {
    return withContextOverrides(attached, context)
  }

  if (isAthenaResultLike(resultOrError)) {
    if (isAthenaResultErrorLike(resultOrError.error)) {
      return {
        kind: resultOrError.error.kind ?? classifyKind(resultOrError.status, gatewayCodeFromUnknownError(resultOrError.error), resultOrError.error.message),
        code:
          resultOrError.error.athenaCode ??
          toAthenaErrorCode(
            resultOrError.error.kind ??
              classifyKind(
                resultOrError.status,
                gatewayCodeFromUnknownError(resultOrError.error),
                resultOrError.error.message,
              ),
            resultOrError.error.status ?? resultOrError.status,
            gatewayCodeFromUnknownError(resultOrError.error),
          ),
        category:
          resultOrError.error.category ??
          toAthenaErrorCategory(
            resultOrError.error.kind ??
              classifyKind(
                resultOrError.status,
                gatewayCodeFromUnknownError(resultOrError.error),
                resultOrError.error.message,
              ),
            resultOrError.error.status ?? resultOrError.status,
          ),
        retryable:
          resultOrError.error.retryable ??
          isRetryable(
            resultOrError.error.kind ??
              classifyKind(
                resultOrError.status,
                gatewayCodeFromUnknownError(resultOrError.error),
                resultOrError.error.message,
              ),
            resultOrError.error.status ?? resultOrError.status,
          ),
        status: resultOrError.error.status ?? resultOrError.status,
        constraint: resultOrError.error.constraint,
        table: context?.table ?? resultOrError.error.table,
        operation: context?.operation ?? resultOrError.error.operation,
        message: resultOrError.error.message,
        raw: resultOrError.error.raw ?? resultOrError.raw,
      }
    }

    const details = resultOrError.errorDetails
    const message =
      messageFromUnknownError(resultOrError.error) ??
      details?.message ??
      `Athena ${context?.operation ?? operationFromDetails(details) ?? 'request'} failed`
    const operation = context?.operation ?? operationFromDetails(details)
    const table = context?.table ?? extractTable(message)
    const constraint = extractConstraint(message)
    const gatewayCode = details?.code ?? gatewayCodeFromUnknownError(resultOrError.error)
    const kind = classifyKind(resultOrError.status, gatewayCode, message)
    const code = toAthenaErrorCode(kind, resultOrError.status, gatewayCode)
    const category = toAthenaErrorCategory(kind, resultOrError.status)
    return {
      kind,
      code,
      category,
      retryable: isRetryable(kind, resultOrError.status),
      status: resultOrError.status,
      constraint,
      table,
      operation,
      message,
      raw: resultOrError.raw,
    }
  }

  if (isAthenaGatewayError(resultOrError)) {
    const details = resultOrError.toDetails()
    const operation = context?.operation ?? operationFromDetails(details)
    const table = context?.table ?? extractTable(resultOrError.message)
    const constraint = extractConstraint(resultOrError.message)
    const kind = classifyKind(resultOrError.status, resultOrError.code, resultOrError.message)
    const code = toAthenaErrorCode(kind, resultOrError.status, resultOrError.code)
    const category = toAthenaErrorCategory(kind, resultOrError.status)
    return {
      kind,
      code,
      category,
      retryable: isRetryable(kind, resultOrError.status),
      status: resultOrError.status,
      constraint,
      table,
      operation,
      message: resultOrError.message,
      raw: resultOrError,
    }
  }

  if (resultOrError instanceof Error) {
    const maybeStatus =
      isRecord(resultOrError) && typeof resultOrError.status === 'number'
        ? resultOrError.status
        : undefined
    const kind = classifyKind(maybeStatus, undefined, resultOrError.message)
    return {
      kind,
      code: toAthenaErrorCode(kind, maybeStatus),
      category: toAthenaErrorCategory(kind, maybeStatus),
      retryable: isRetryable(kind, maybeStatus),
      status: maybeStatus,
      constraint: extractConstraint(resultOrError.message),
      table: context?.table ?? extractTable(resultOrError.message),
      operation: context?.operation,
      message: resultOrError.message,
      raw: resultOrError,
    }
  }

  const message = typeof resultOrError === 'string' ? resultOrError : 'Unknown Athena error'
  const kind = classifyKind(undefined, undefined, message)
  return {
    kind,
    code: toAthenaErrorCode(kind, undefined),
    category: toAthenaErrorCategory(kind, undefined),
    retryable: isRetryable(kind, undefined),
    status: undefined,
    constraint: extractConstraint(message),
    table: context?.table ?? extractTable(message),
    operation: context?.operation,
    message,
    raw: resultOrError,
  }
}

/**
 * Unwraps a successful result into a row array.
 *
 * - Throws on failed results.
 * - Converts `null` data to an empty array.
 * - Wraps scalar data in a single-element array.
 */
export function unwrapRows<T>(
  result: AthenaResult<T[] | T | null>,
  options?: UnwrapOptions,
): T[] {
  if (!isOk(result)) {
    throw toAthenaGatewayError(result, 'Athena request failed', options?.context)
  }
  if (result.data == null) return []
  return Array.isArray(result.data) ? result.data : [result.data]
}

/**
 * Unwraps successful result data from `AthenaResult<T | null>`.
 *
 * By default, `null` data throws. Pass `{ allowNull: true }` to permit nullable payloads.
 */
export function unwrap<T>(
  result: AthenaResult<T | null>,
  options: UnwrapOptions & { allowNull: true },
): T | null
export function unwrap<T>(result: AthenaResult<T | null>, options?: UnwrapOptions): T
export function unwrap<T>(
  result: AthenaResult<T | null>,
  options?: UnwrapOptions,
): T | null {
  if (!isOk(result)) {
    throw toAthenaGatewayError(result, 'Athena request failed', options?.context)
  }
  if (result.data == null && !options?.allowNull) {
    throw toAthenaGatewayError(result, 'Expected data but received null', options?.context)
  }
  return result.data
}

/**
 * Unwraps the first row from a successful result that may contain arrays/scalars/null.
 *
 * - Throws on failed results.
 * - Throws when no row exists unless `allowNull: true` is provided.
 * - Optionally enforces exact cardinality via `requireExactlyOne`.
 */
export function unwrapOne<T>(
  result: AthenaResult<T[] | T | null>,
  options: UnwrapOneOptions & { allowNull: true },
): T | null
export function unwrapOne<T>(result: AthenaResult<T[] | T | null>, options?: UnwrapOneOptions): T
export function unwrapOne<T>(
  result: AthenaResult<T[] | T | null>,
  options?: UnwrapOneOptions,
): T | null {
  const rows = unwrapRows(result, options)
  if (!rows.length) {
    if (options?.allowNull) return null
    throw toAthenaGatewayError(result, 'Expected one row but received none', options?.context)
  }
  if (options?.requireExactlyOne && rows.length !== 1) {
    throw toAthenaGatewayError(
      result,
      `Expected exactly one row but received ${rows.length}`,
      options.context,
    )
  }
  return rows[0]
}

/**
 * Asserts that an Athena result is successful.
 *
 * Returns the original result for fluent composition and throws `AthenaGatewayError` on failure.
 */
export function requireSuccess<T>(
  result: AthenaResult<T>,
  context?: AthenaOperationContext,
): AthenaResult<T> {
  if (!isOk(result)) {
    throw toAthenaGatewayError(
      result,
      `Athena ${context?.operation ?? 'request'} failed`,
      context,
    )
  }
  return result
}

/**
 * Enforces mutation postconditions based on `result.count`.
 *
 * - Validates success first.
 * - Requires a non-null count in the response.
 * - Validates `count >= min` (default: `1`).
 *
 * Useful for guaranteeing that critical writes actually affected rows.
 */
export function requireAffected<T>(
  result: AthenaResult<T>,
  options?: RequireAffectedOptions,
  context?: AthenaOperationContext,
): number {
  requireSuccess(result, context)

  const minimum = options?.min ?? 1
  const count = result.count
  if (count == null) {
    throw new AthenaGatewayError({
      code: 'UNKNOWN_ERROR',
      status: result.status,
      message: 'Expected affected row count but response.count is missing',
      hint: 'Set call option { count: "exact" } for mutation postcondition checks.',
      cause: safeStringify(result.raw),
    })
  }

  if (count < minimum) {
    throw new AthenaGatewayError({
      code: 'UNKNOWN_ERROR',
      status: result.status,
      message: `Expected at least ${minimum} affected rows but received ${count}`,
      hint: contextHint(context),
      cause: safeStringify(result.raw),
    })
  }

  return count
}

function applyBounds(value: number, options?: IntCoercionOptions): number | null {
  if (options?.min !== undefined && value < options.min) return null
  if (options?.max !== undefined && value > options.max) return null
  return value
}

function parseIntegerString(value: string): number | null {
  const normalized = value.trim()
  if (!/^[-+]?\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null
  return parsed
}

/**
 * Safely coerces `unknown` values into finite integers.
 *
 * Returns `null` when coercion fails or bounds/strict bigint checks are violated.
 */
export function coerceInt(value: unknown, options?: IntCoercionOptions): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null
    return applyBounds(value, options)
  }

  if (typeof value === 'string') {
    const parsed = parseIntegerString(value)
    if (parsed == null) return null
    return applyBounds(parsed, options)
  }

  if (typeof value === 'bigint') {
    if (options?.strictBigInt) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        return null
      }
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null
    return applyBounds(parsed, options)
  }

  return null
}

/**
 * Strict integer assertion wrapper around `coerceInt`.
 *
 * Throws a `TypeError` with the provided label when coercion fails.
 */
export function assertInt(value: unknown, label = 'value', options?: IntCoercionOptions): number {
  const parsed = coerceInt(value, options)
  if (parsed == null) {
    throw new TypeError(`${label} must be a finite integer`)
  }
  return parsed
}

function defaultShouldRetry(error: unknown): boolean {
  const normalized = normalizeAthenaError(error)
  return normalized.kind === 'transient' || normalized.kind === 'rate_limit'
}

function computeDelayMs(
  attempt: number,
  error: unknown,
  config: Required<Pick<RetryConfig, 'baseDelayMs' | 'backoff' | 'maxDelayMs' | 'jitter'>>,
): number {
  const baseDelay = config.baseDelayMs
  const rawDelay =
    typeof config.backoff === 'function'
      ? config.backoff(attempt, error)
      : config.backoff === 'linear'
        ? baseDelay * attempt
        : baseDelay * Math.pow(2, attempt - 1)

  const safeDelay = Number.isFinite(rawDelay) ? Math.max(0, rawDelay) : 0
  const clamped = Math.min(config.maxDelayMs, safeDelay)
  const jitterFactor =
    typeof config.jitter === 'number'
      ? Math.max(0, Math.min(1, config.jitter))
      : config.jitter
        ? 0.2
        : 0

  if (!jitterFactor) return clamped
  const deviation = clamped * jitterFactor
  const offset = (Math.random() * 2 - 1) * deviation
  return Math.max(0, clamped + offset)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Retries an async operation with configurable backoff and retry policy.
 *
 * `retries` represents additional attempts after the first failure.
 * By default, transient and rate-limit errors are retried.
 */
export async function withRetry<T>(config: RetryConfig, fn: () => Promise<T>): Promise<T> {
  const retries = Math.max(0, Math.trunc(config.retries))
  const shouldRetry = config.shouldRetry ?? defaultShouldRetry
  const resolvedConfig = {
    baseDelayMs: config.baseDelayMs ?? 100,
    maxDelayMs: config.maxDelayMs ?? 10_000,
    backoff: config.backoff ?? 'exponential',
    jitter: config.jitter ?? false,
  } satisfies Required<Pick<RetryConfig, 'baseDelayMs' | 'backoff' | 'maxDelayMs' | 'jitter'>>

  for (let attempts = 0; attempts <= retries; attempts += 1) {
    try {
      return await fn()
    } catch (error) {
      if (attempts >= retries) {
        throw error
      }

      const currentAttempt = attempts + 1
      const retry = await shouldRetry(error, currentAttempt)
      if (!retry) {
        throw error
      }

      const delay = computeDelayMs(currentAttempt, error, resolvedConfig)
      await sleep(delay)
    }
  }

  throw new Error('withRetry reached an unexpected state')
}
