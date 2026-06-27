import type {
  AthenaConditionArrayValue,
  AthenaConditionCastType,
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayCondition,
  AthenaGatewayErrorDetails,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcPayload,
  AthenaSortBy,
  AthenaUpdatePayload,
} from './gateway/types.ts'
import type { BackendConfig, BackendType } from './gateway/types.ts'
import { createAthenaGatewayClient } from './gateway/client.ts'
import { normalizeAthenaGatewayBaseUrl } from './gateway/url.ts'
import { quoteQualifiedIdentifier, quoteSelectColumnToken, quoteSelectColumnsExpression } from './sql-identifiers.ts'
import { createAuthClient } from './auth/client.ts'
import type { AthenaAuthBindings, AthenaAuthClientConfig } from './auth/types.ts'
import { normalizeAthenaError, withRetry } from './auxiliaries.ts'
import type { AthenaOperationContext, NormalizedAthenaError, RetryConfig } from './auxiliaries.ts'
import { createDbModule } from './db/module.ts'
import type { AthenaDbModule } from './db/module.ts'
import { createStorageModule } from './storage/module.ts'
import type { AthenaStorageClientConfig, AthenaStorageModule } from './storage/module.ts'
import { createChatModule } from './chat/module.ts'
import type { AthenaChatModule, AthenaChatWebSocketFactory } from './chat/types.ts'
import { createAthenaClientBuilder, toBackendConfig } from './client-builder.ts'
import { buildSdkHeaderValue } from './sdk-version.ts'
import {
  compileOrderBy,
  compileSelectShape,
  compileWhere,
  selectShapeUsesRelationSchema,
  shouldUseUuidTextComparison,
} from './query-ast.ts'
import type {
  AthenaFindManyOptions,
  AthenaFindManyResult,
  AthenaSelectShape,
  AthenaValidatedSelectShape,
} from './query-ast.ts'
import {
  canUseFindManyAstTransport,
  createSelectTransportPlan,
  findManyAstWhereRequiresLegacyTransport,
  normalizeFindManyAstWhere,
  resolvePagination,
  toFindManyAstOrder,
} from './query-transport.ts'
import type { AthenaFindManyAstPayload } from './query-transport.ts'
import {
  buildDeleteDebugAst,
  buildFindManyCompiledDebugAst,
  buildFindManyDirectDebugAst,
  buildInsertDebugAst,
  buildRawQueryDebugAst,
  buildRpcDebugAst,
  buildSelectDebugAst,
  buildUpdateDebugAst,
  buildUpsertDebugAst,
} from './query-debug-ast.ts'
import type { AthenaQueryDebugAst } from './query-debug-ast.ts'
import {
  captureTraceCallsite,
  createQueryTracer,
  createTraceCallsiteStore,
  executeWithQueryTrace,
} from './query-tracing.ts'
import type {
  AthenaQueryTracer,
} from './query-tracing.ts'
import {
  isAthenaModelTarget,
  resolveAthenaModelTargetTableName,
} from './schema/model-target.ts'
import type {
  AthenaSelectInput,
  AthenaTypecheckedColumnKey,
  AthenaValidatedSelectInput,
} from './select-column-types.ts'
import type {
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from './schema/types.ts'

export interface AthenaResult<T> {
  data: T | null
  error: AthenaResultError | null
  statusText?: string | null
  /**
   * @deprecated Prefer `error?.gatewayCode`, `error?.hint`, and related fields on `error`.
   */
  errorDetails?: AthenaGatewayErrorDetails | null
  status: number
  count?: number | null
  raw: unknown
}

export interface AthenaResultError {
  message: string
  code: string | null
  athenaCode: NormalizedAthenaError['code']
  gatewayCode?: AthenaGatewayErrorDetails['code'] | null
  kind: NormalizedAthenaError['kind']
  category: NormalizedAthenaError['category']
  retryable: boolean
  details: unknown | null
  hint: string | null
  status: number
  statusText: string | null
  constraint?: string
  table?: string
  operation?: string
  endpoint?: AthenaGatewayErrorDetails['endpoint']
  method?: AthenaGatewayErrorDetails['method']
  requestId?: string
  cause?: string
  raw: unknown
}

export type AthenaRequestService = 'db' | 'auth' | 'chat' | 'storage'
export type AthenaRequestMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export interface AthenaRequestQueryValueMap {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | Array<string | number | boolean | null | undefined>
}

export interface AthenaRequestOptions {
  service?: AthenaRequestService
  url?: string
  path?: string
  method?: AthenaRequestMethod
  headers?: Record<string, string>
  query?: AthenaRequestQueryValueMap
  body?: RequestInit['body'] | Record<string, unknown> | unknown[] | null
  signal?: AbortSignal
  credentials?: RequestInit['credentials']
  responseType?: 'json' | 'text' | 'response'
}

export interface AthenaRequestResponse<T = unknown> {
  ok: boolean
  status: number
  statusText: string
  headers: Headers
  data: T | string | null
  raw: Response
}

export interface AthenaClientExperimentalOptions {
  /**
   * @deprecated Failed `AthenaResult` values now include normalized structured `error`
   * envelopes by default. This flag is retained as a no-op compatibility switch.
   */
  enableErrorNormalization?: boolean
  /**
   * Retry retryable read failures (`select`, `findMany`, `query`) with a fixed internal policy.
   *
   * Applies two additional attempts with exponential backoff and jitter.
   */
  retryReads?: boolean
  /**
   * Emit execution diagnostics for every query/mutation/RPC invocation.
   * Includes payload, synthesized SQL, full outcome, and best-effort callsite metadata.
   */
  traceQueries?: boolean | AthenaQueryTraceOptions
  /**
   * Build and attach a normalized operation AST for runtime debugging.
   *
   * When enabled, successful Athena results expose a non-enumerable debug AST
   * that can be read with `getAthenaDebugAst(...)`. If tracing is also enabled,
   * the same AST is included on emitted trace events.
   */
  debugAst?: boolean
  /**
   * Compile-time opt-in for validating simple `select(...)`, `order(...)`, and
   * RPC filter column names against known row keys.
   *
   * This flag is type-only. It does not change runtime request behavior.
   */
  typecheckColumns?: boolean
  /**
   * Send the original `findMany(...)` AST body for clean object-select reads.
   * This requires gateway support and falls back to legacy compiled transport
   * when a chain carries filter/pagination state that the AST payload cannot
   * represent losslessly yet.
   */
  findManyAst?: boolean
  /**
   * Expose the experimental `client.storage.*` bindings for Athena storage APIs.
   */
  athenaStorageBackend?: boolean
  /**
   * Optional storage SDK runtime hooks. Only used when `athenaStorageBackend` is enabled.
   */
  storage?: AthenaStorageClientConfig
}

export interface AthenaQueryTraceOptions {
  /**
   * Custom sink for trace events. Defaults to console.info.
   */
  logger?: (event: AthenaQueryTraceEvent) => void
}

export interface AthenaQueryTraceCallsite {
  filePath: string
  fileName: string
  line: number
  column: number
  frame?: string
  functionName?: string
}

export interface AthenaQueryTraceEvent {
  timestamp: string
  durationMs: number
  operation: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc' | 'query'
  endpoint: '/gateway/fetch' | '/gateway/insert' | '/gateway/update' | '/gateway/delete' | '/gateway/rpc' | '/gateway/query' | `/rpc/${string}`
  table?: string
  functionName?: string
  sql: string
  payload: unknown
  ast?: AthenaQueryDebugAst
  options?: AthenaGatewayCallOptions | AthenaRpcCallOptions
  callsite: AthenaQueryTraceCallsite | null
  outcome?: {
    status: number
    error: AthenaResultError | null
    errorDetails?: AthenaGatewayErrorDetails | null
    count?: number | null
    data: unknown
    raw: unknown
  }
  thrownError?: unknown
}

type TableBuilderState = {
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  order?: AthenaSortBy
  currentPage?: number
  pageSize?: number
  totalPages?: number
}

type ConditionCastHints = {
  valueCast?: AthenaConditionCastType
  columnCast?: AthenaConditionCastType
}

type MutationSingleResult<Result> = Result extends Array<infer Item> ? Item | null : Result | null
type MutationResultRow<Result> = Result extends Array<infer Item> ? Item : Result
type AthenaRowShape = Record<string, AthenaJsonValue | undefined>
type FilterColumnKey<Row> = Extract<keyof NonNullable<Row>, string>
type ResolvedFilterColumnKey<Row> = [FilterColumnKey<Row>] extends [never] ? string : FilterColumnKey<Row>
type SelectColumnsFor<
  Row,
  TStrict extends boolean,
  TValue extends AthenaSelectInput,
> = TStrict extends true ? AthenaValidatedSelectInput<Row, TValue> : TValue
const DEFAULT_COLUMNS = '*'
const SAFE_CAST_PATTERN = /^[a-z_][a-z0-9_]*(?:\[\])?$/i
const ATHENA_NORMALIZED_ERROR_KEY = '__athenaNormalizedError' as const
const SDK_NAME = 'xylex-group/athena'

type SelectDebugAstFactory = (input: {
  tableName: string
  columns: string | string[]
  executionState: TableBuilderState
  plan: ReturnType<typeof createSelectTransportPlan>
}) => AthenaQueryDebugAst

export interface MutationQuery<
  Result,
  Row = MutationResultRow<Result>,
  TStrict extends boolean = false,
> extends PromiseLike<AthenaResult<Result>> {
  select<const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Result>>
  returning<const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Result>>
  single<const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<MutationSingleResult<Result>>>
  maybeSingle<const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<MutationSingleResult<Result>>>
  then<TResult1 = AthenaResult<Result>, TResult2 = never>(
    onfulfilled?: ((value: AthenaResult<Result>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2>
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<AthenaResult<Result> | TResult>
  finally(onfinally?: (() => void) | undefined | null): Promise<AthenaResult<Result>>
}

function formatResult<T>(response: AthenaGatewayResponse<T>): AthenaResult<T> {
  const result: AthenaResult<T> = {
    data: response.data ?? null,
    error: null,
    errorDetails: response.errorDetails ?? null,
    status: response.status,
    statusText: response.statusText ?? null,
    raw: response.raw,
  }
  if (response.count !== undefined) {
    result.count = response.count
  }
  return result
}

type AthenaResultFormatter = <T>(
  response: AthenaGatewayResponse<T>,
  context?: AthenaOperationContext,
) => AthenaResult<T>

const EXPERIMENTAL_READ_RETRY_CONFIG: RetryConfig = {
  retries: 2,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  backoff: 'exponential',
  jitter: true,
}

function attachNormalizedError<T>(
  result: AthenaResult<T>,
  normalizedError: NormalizedAthenaError,
): void {
  Object.defineProperty(result, ATHENA_NORMALIZED_ERROR_KEY, {
    value: normalizedError,
    enumerable: false,
    configurable: true,
    writable: false,
  })
}

function createResultFormatter(
  experimental?: AthenaClientExperimentalOptions,
): AthenaResultFormatter {
  void experimental
  return <T>(response: AthenaGatewayResponse<T>, context?: AthenaOperationContext): AthenaResult<T> => {
    const result = formatResult(response)
    if (response.error == null && response.errorDetails == null) {
      return result
    }
    const normalizedError = normalizeAthenaError(
      {
        ...result,
        error: response.error ?? response.errorDetails?.message ?? null,
      },
      context,
    )
    result.error = createResultError(response, result, normalizedError)
    attachNormalizedError(result, normalizedError)
    return result
  }
}

async function executeExperimentalRead<T>(
  experimental: AthenaClientExperimentalOptions | undefined,
  runner: () => Promise<AthenaResult<T>>,
): Promise<AthenaResult<T>> {
  if (!experimental?.retryReads) {
    return runner()
  }

  let lastRetryableResult: AthenaResult<T> | undefined
  let lastRetrySignal: AthenaResultError | null = null
  try {
    return await withRetry(
      {
        ...EXPERIMENTAL_READ_RETRY_CONFIG,
        shouldRetry: error =>
          error === lastRetrySignal || normalizeAthenaError(error).retryable,
      },
      async () => {
      const result = await runner()
      if (result.error?.retryable) {
        lastRetryableResult = result
        lastRetrySignal = result.error
        throw lastRetrySignal
      }
      return result
      },
    )
  } catch (error) {
    if (lastRetryableResult && error === lastRetrySignal) {
      return lastRetryableResult
    }
    throw error
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

function resolveStructuredErrorPayload(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  return isRecord(raw.error) ? raw.error : raw
}

function resolveStructuredErrorDetails(payload: Record<string, unknown> | null, message: string): unknown | null {
  if (!payload || !('details' in payload)) {
    return null
  }
  const details = payload.details
  if (details == null) {
    return null
  }
  if (typeof details === 'string' && details.trim() === message.trim()) {
    return null
  }
  return details
}

function createResultError<T>(
  response: AthenaGatewayResponse<T>,
  result: AthenaResult<T>,
  normalized: NormalizedAthenaError,
): AthenaResultError {
  const rawRecord = isRecord(response.raw) ? response.raw : null
  const payload = resolveStructuredErrorPayload(response.raw)
  const message =
    firstNonEmptyString(
      response.error,
      payload?.message,
      payload?.error,
      payload?.details,
      response.errorDetails?.message,
      normalized.message,
    ) ?? normalized.message
  const statusText =
    firstNonEmptyString(response.statusText, rawRecord?.statusText) ?? null
  const hint =
    firstNonEmptyString(payload?.hint, response.errorDetails?.hint) ?? null
  const code =
    firstNonEmptyString(payload?.code) ??
    normalized.code
  const details =
    resolveStructuredErrorDetails(payload, message) ??
    response.errorDetails?.cause ??
    null

  return {
    message,
    code,
    athenaCode: normalized.code,
    gatewayCode: response.errorDetails?.code ?? null,
    kind: normalized.kind,
    category: normalized.category,
    retryable: normalized.retryable,
    details,
    hint,
    status: result.status,
    statusText,
    constraint: normalized.constraint,
    table: normalized.table,
    operation: normalized.operation,
    endpoint: response.errorDetails?.endpoint,
    method: response.errorDetails?.method,
    requestId: response.errorDetails?.requestId,
    cause: response.errorDetails?.cause,
    raw: result.raw,
  }
}


function toSingleResult<Result>(response: AthenaResult<Result>): AthenaResult<MutationSingleResult<Result>> {
  const payload = response.data
  const singleData =
    Array.isArray(payload) ? (payload.length ? payload[0] : null) : payload ?? null
  return {
    ...response,
    data: singleData as MutationSingleResult<Result>,
  }
}

function mergeOptions<T extends { headers?: Record<string, string> }>(
  ...options: Array<T | undefined>
): T | undefined {
  return options.reduce<T | undefined>((acc, next) => {
    if (!next) return acc
    const merged = { ...(acc ?? {}), ...next } as T
    if (acc?.headers || next.headers) {
      merged.headers = {
        ...(acc?.headers ?? {}),
        ...(next.headers ?? {}),
      }
    }
    return merged
  }, undefined)
}

function asAthenaJsonObject(value: unknown): AthenaJsonObject {
  return value as unknown as AthenaJsonObject
}

function asAthenaJsonObjectArray(values: unknown[]): AthenaJsonObject[] {
  return values as unknown as AthenaJsonObject[]
}

function parseArbitraryResponseBody(rawText: string, contentType: string | null) {
  if (!rawText) {
    return null as unknown
  }

  const contentTypeSuggestsJson =
    contentType?.toLowerCase().includes('application/json') ?? false
  const looksJson =
    contentTypeSuggestsJson || rawText.startsWith('{') || rawText.startsWith('[')

  if (!looksJson) {
    return rawText as unknown
  }

  try {
    return JSON.parse(rawText) as unknown
  } catch {
    return rawText as unknown
  }
}

function toRequestQueryString(query?: AthenaRequestQueryValueMap): string {
  if (!query) {
    return ''
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item))
        }
      }
      continue
    }

    params.set(key, String(value))
  }

  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

function normalizeSelectColumnsInput(columns?: AthenaSelectInput): string | string[] | undefined {
  if (columns === undefined) {
    return undefined
  }
  if (typeof columns === 'string') {
    return columns
  }
  return [...columns]
}

function createMutationQuery<
  Result,
  Row = MutationResultRow<Result>,
  TStrict extends boolean = false,
>(
  executor: (
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ) => Promise<AthenaResult<Result>>,
  defaultColumns: AthenaSelectInput | null = DEFAULT_COLUMNS,
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
): MutationQuery<Result, Row, TStrict> {
  let selectedColumns: AthenaSelectInput | undefined = defaultColumns === null ? undefined : defaultColumns
  let selectedOptions: AthenaGatewayCallOptions | undefined
  let promise: Promise<AthenaResult<Result>> | null = null
  const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite)

  const run = (
    columns?: AthenaSelectInput,
    options?: AthenaGatewayCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ) => {
    const payloadColumns = columns ?? selectedColumns
    const payloadOptions = options ?? selectedOptions
    if (!promise) {
      promise = executor(
        normalizeSelectColumnsInput(payloadColumns),
        payloadOptions,
        callsiteStore.resolve(callsite),
      )
    }
    return promise
  }

  const mutationQuery: MutationQuery<Result, Row, TStrict> = {
    select(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options, captureTraceCallsite(tracer))
    },
    returning(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
      return mutationQuery.select(columns, options)
    },
    single(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options, captureTraceCallsite(tracer)).then(toSingleResult)
    },
    maybeSingle(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
      return mutationQuery.single(columns, options)
    },
    then(onfulfilled, onrejected) {
      return run(selectedColumns, selectedOptions).then(onfulfilled, onrejected)
    },
    catch(onrejected) {
      return run(selectedColumns, selectedOptions).catch(onrejected)
    },
    finally(onfinally) {
      return run(selectedColumns, selectedOptions).finally(onfinally)
    },
  }

  return mutationQuery
}

export interface OrderOptions {
  ascending?: boolean
}

/** Shared filter chain - supports eq, limit, etc. in any order relative to select/update */
interface FilterChain<Self, Row> {
  eq(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  eqCast(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue, cast: AthenaConditionCastType): Self
  eqUuid(column: ResolvedFilterColumnKey<Row>, value: string): Self
  match(filters: Partial<Record<ResolvedFilterColumnKey<Row>, AthenaConditionValue>>): Self
  range(from: number, to: number): Self
  limit(count: number): Self
  offset(count: number): Self
  currentPage(value: number): Self
  pageSize(value: number): Self
  totalPages(value: number): Self
  order(column: ResolvedFilterColumnKey<Row>, options?: OrderOptions): Self
  gt(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  gte(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  lt(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  lte(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  neq(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  like(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  ilike(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  is(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue): Self
  in(column: ResolvedFilterColumnKey<Row>, values: AthenaConditionArrayValue): Self
  contains(column: ResolvedFilterColumnKey<Row>, values: AthenaConditionArrayValue): Self
  containedBy(column: ResolvedFilterColumnKey<Row>, values: AthenaConditionArrayValue): Self
  not(
    columnOrExpression: ResolvedFilterColumnKey<Row> | string,
    operator?: AthenaConditionOperator,
    value?: AthenaConditionValue,
  ): Self
  or(expression: string): Self
}

/** Chain returned by select() - supports filters and single/maybeSingle before execution */
export interface SelectChain<Row, SelectedRow = Row, TStrict extends boolean = false>
  extends FilterChain<SelectChain<Row, SelectedRow, TStrict>, Row>, PromiseLike<AthenaResult<SelectedRow[]>> {
  single<
    T = SelectedRow,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
  maybeSingle<
    T = SelectedRow,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
}

/** Chain returned by update() - supports filters before execution, plus select/returning */
export interface UpdateChain<Row, TStrict extends boolean = false>
  extends FilterChain<UpdateChain<Row, TStrict>, Row>, MutationQuery<Row[], Row, TStrict> {}

interface RpcFilterChain<Self, Row, TStrict extends boolean = false> {
  eq(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  neq(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  gt(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  gte(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  lt(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  lte(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  like(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  ilike(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  is(column: AthenaTypecheckedColumnKey<Row, TStrict>, value: AthenaConditionValue): Self
  in(column: AthenaTypecheckedColumnKey<Row, TStrict>, values: AthenaConditionArrayValue): Self
}

export interface RpcOrderOptions {
  ascending?: boolean
}

export interface RpcQueryBuilder<Row, TStrict extends boolean = false>
  extends RpcFilterChain<RpcQueryBuilder<Row, TStrict>, Row, TStrict>, PromiseLike<AthenaResult<Row[]>> {
  select<const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaRpcCallOptions,
  ): Promise<AthenaResult<Row[]>>
  single<
    T = Row,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaRpcCallOptions,
  ): Promise<AthenaResult<T | null>>
  maybeSingle<
    T = Row,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaRpcCallOptions,
  ): Promise<AthenaResult<T | null>>
  order(column: AthenaTypecheckedColumnKey<Row, TStrict>, options?: RpcOrderOptions): RpcQueryBuilder<Row, TStrict>
  limit(count: number): RpcQueryBuilder<Row, TStrict>
  offset(count: number): RpcQueryBuilder<Row, TStrict>
  range(from: number, to: number): RpcQueryBuilder<Row, TStrict>
}

export interface AthenaFromOptions {
  schema?: string
}

export interface TableQueryBuilder<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  TContext = unknown,
  TStrict extends boolean = false,
> extends FilterChain<TableQueryBuilder<Row, Insert, Update, TContext, TStrict>, Row> {
  select<
    T = Row,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row, T, TStrict>
  findMany<const TSelect extends AthenaSelectShape>(
    options: AthenaFindManyOptions<Row, TSelect> & {
      select: AthenaValidatedSelectShape<TSelect>
    },
  ): Promise<AthenaResult<Array<AthenaFindManyResult<Row, TSelect, TContext>>>>
  insert(values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row, Row, TStrict>
  insert(values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[], Row, TStrict>
  upsert(
    values: Insert,
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update
      onConflict?: string | string[]
    },
  ): MutationQuery<Row, Row, TStrict>
  upsert(
    values: Insert[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update
      onConflict?: string | string[]
    },
  ): MutationQuery<Row[], Row, TStrict>
  update(values: Update, options?: AthenaGatewayCallOptions): UpdateChain<Row, TStrict>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null, Row, TStrict>
  single<
    T = Row,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
  maybeSingle<
    T = Row,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
  reset(): TableQueryBuilder<Row, Insert, Update, TContext, TStrict>
}

function getResourceId(state: TableBuilderState): string | undefined {
  const candidate = state.conditions.find(
    condition =>
      condition.operator === 'eq' &&
      (condition.column === 'resource_id' || condition.column === 'id'),
  )
  return candidate?.value?.toString()
}

function stringifyFilterValue(value: AthenaConditionValue | AthenaConditionArrayValue | string): string {
  if (Array.isArray(value)) {
    return value.join(',')
  }
  return String(value)
}

function normalizeCast(cast: AthenaConditionCastType): string {
  const normalized = cast.trim().toLowerCase()
  if (!SAFE_CAST_PATTERN.test(normalized)) {
    throw new Error(`Invalid cast type "${cast}"`)
  }
  return normalized
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function toSqlLiteral(value: AthenaConditionValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${escapeSqlStringLiteral(value)}'`
}

function withCast(expression: string, cast?: AthenaConditionCastType): string {
  if (!cast) return expression
  return `${expression}::${normalizeCast(cast)}`
}

function buildSelectColumnsClause(columns: string | string[]): string {
  if (Array.isArray(columns)) {
    return columns.map(column => quoteSelectColumnToken(column)).join(', ')
  }
  return quoteSelectColumnsExpression(columns)
}

interface ParsedIdentifierSegment {
  normalizedValue: string
}

function parseIdentifierSegment(input: string): ParsedIdentifierSegment | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (!trimmed.startsWith('"')) {
    return {
      normalizedValue: trimmed.toLowerCase(),
    }
  }

  let value = ''
  let index = 1
  let closed = false
  while (index < trimmed.length) {
    const char = trimmed[index]
    const next = index + 1 < trimmed.length ? trimmed[index + 1] : ''
    if (char === '"' && next === '"') {
      value += '"'
      index += 2
      continue
    }
    if (char === '"') {
      closed = true
      index += 1
      break
    }
    value += char
    index += 1
  }

  if (!closed || trimmed.slice(index).trim().length > 0 || !value.trim()) {
    return null
  }

  return {
    normalizedValue: value,
  }
}

function splitQualifiedTableName(tableName: string): { schemaSegment: string } | null {
  const trimmed = tableName.trim()
  let inQuotes = false
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    const next = index + 1 < trimmed.length ? trimmed[index + 1] : ''
    if (char === '"') {
      if (inQuotes && next === '"') {
        index += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (char === '.' && !inQuotes) {
      const schemaSegment = trimmed.slice(0, index).trim()
      const tableSegment = trimmed.slice(index + 1).trim()
      if (!schemaSegment || !tableSegment) {
        return null
      }
      return { schemaSegment }
    }
  }
  return null
}

function resolveTableNameForCall(tableName: string, schema: string | undefined): string {
  if (!schema) return tableName
  const normalizedSchema = schema.trim()
  if (!normalizedSchema) {
    throw new Error('schema option must be a non-empty string')
  }
  const normalizedTableName = tableName.trim()
  const parsedSchema = parseIdentifierSegment(normalizedSchema)
  if (!parsedSchema) {
    throw new Error('schema option must be a non-empty string')
  }
  const qualified = splitQualifiedTableName(normalizedTableName)
  if (qualified) {
    const parsedTableSchema = parseIdentifierSegment(qualified.schemaSegment)
    const sameSchema = parsedTableSchema
      ? parsedTableSchema.normalizedValue === parsedSchema.normalizedValue
      : normalizedTableName.startsWith(`${normalizedSchema}.`)
    if (sameSchema) {
      return normalizedTableName
    }
    throw new Error(
      `schema option "${normalizedSchema}" conflicts with schema-qualified table "${normalizedTableName}"`,
    )
  }
  return `${normalizedSchema}.${normalizedTableName}`
}

function conditionToSqlClause(condition: AthenaGatewayCondition): string | null {
  if (!condition.column) return null
  const column = withCast(quoteQualifiedIdentifier(condition.column), condition.column_cast)
  const value = condition.value
  const sqlOperator = {
    eq: '=',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
  } as const

  switch (condition.operator) {
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'like':
    case 'ilike': {
      if (Array.isArray(value) || value === undefined) return null
      const rhs = withCast(toSqlLiteral(value), condition.value_cast)
      return `${column} ${sqlOperator[condition.operator]} ${rhs}`
    }
    case 'is': {
      if (value === null) return `${column} IS NULL`
      if (value === true) return `${column} IS TRUE`
      if (value === false) return `${column} IS FALSE`
      return null
    }
    case 'in': {
      if (!Array.isArray(value)) return null
      if (value.length === 0) return 'FALSE'
      const values = value.map(item => withCast(toSqlLiteral(item), condition.value_cast))
      return `${column} IN (${values.join(', ')})`
    }
    default:
      return null
  }
}

function buildTypedSelectQuery(input: {
  tableName: string
  columns: string | string[]
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  currentPage?: number
  pageSize?: number
  order?: AthenaSortBy
}): string | null {
  const whereClauses: string[] = []
  for (const condition of input.conditions) {
    const clause = conditionToSqlClause(condition)
    if (!clause) return null
    whereClauses.push(clause)
  }

  let limit = input.limit
  let offset = input.offset
  if (limit === undefined && input.pageSize !== undefined) {
    limit = input.pageSize
  }
  if (
    offset === undefined &&
    input.pageSize !== undefined &&
    input.currentPage !== undefined &&
    input.currentPage > 0
  ) {
    offset = (input.currentPage - 1) * input.pageSize
  }

  const sqlParts = [
    `SELECT ${buildSelectColumnsClause(input.columns)} FROM ${quoteQualifiedIdentifier(input.tableName)}`,
  ]

  if (whereClauses.length > 0) {
    sqlParts.push(`WHERE ${whereClauses.join(' AND ')}`)
  }

  if (input.order?.field) {
    const direction = input.order.direction === 'descending' ? 'DESC' : 'ASC'
    sqlParts.push(`ORDER BY ${quoteQualifiedIdentifier(input.order.field)} ${direction}`)
  }

  if (limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`)
  }

  if (offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`)
  }

  return `${sqlParts.join(' ')};`
}

function sanitizeSqlComment(comment: string): string {
  return comment.replace(/\*\//g, '* /')
}

function toSqlJsonLiteral(value: AthenaJsonValue | undefined): string {
  if (value === undefined) return 'DEFAULT'
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return toSqlLiteral(value)
  }
  return `'${escapeSqlStringLiteral(JSON.stringify(value))}'::jsonb`
}

function conditionToDebugSqlClause(condition: AthenaGatewayCondition): string {
  const exact = conditionToSqlClause(condition)
  if (exact) return exact

  const rawCondition = sanitizeSqlComment(JSON.stringify(condition))
  if (!condition.column) {
    return `TRUE /* unsupported condition: ${rawCondition} */`
  }

  const column = withCast(quoteQualifiedIdentifier(condition.column), condition.column_cast)
  const value = condition.value
  const rhs = withCast(toSqlJsonLiteral(value as AthenaJsonValue | undefined), condition.value_cast)

  switch (condition.operator) {
    case 'contains':
      return `${column} @> ${rhs}`
    case 'containedBy':
      return `${column} <@ ${rhs}`
    case 'not':
      return `TRUE /* NOT expression passthrough: ${rawCondition} */`
    case 'or':
      return `TRUE /* OR expression passthrough: ${rawCondition} */`
    default:
      return `TRUE /* unsupported condition: ${rawCondition} */`
  }
}

function appendOrderLimitOffset(
  sqlParts: string[],
  order?: AthenaSortBy,
  limit?: number,
  offset?: number,
) {
  if (order?.field) {
    const direction = order.direction === 'descending' ? 'DESC' : 'ASC'
    sqlParts.push(`ORDER BY ${quoteQualifiedIdentifier(order.field)} ${direction}`)
  }
  if (limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(limit))}`)
  }
  if (offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(offset))}`)
  }
}

function buildDebugSelectQuery(input: {
  tableName: string
  columns: string | string[]
  conditions?: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  currentPage?: number
  pageSize?: number
  order?: AthenaSortBy
}): string {
  const sqlParts = [
    `SELECT ${buildSelectColumnsClause(input.columns)} FROM ${quoteQualifiedIdentifier(input.tableName)}`,
  ]
  if (input.conditions?.length) {
    const whereClauses = input.conditions.map(conditionToDebugSqlClause)
    sqlParts.push(`WHERE ${whereClauses.join(' AND ')}`)
  }
  const pagination = resolvePagination(input)
  appendOrderLimitOffset(sqlParts, input.order, pagination.limit, pagination.offset)
  return `${sqlParts.join(' ')};`
}

function resolveDebugTableIdentifier(tableName: string | undefined): string {
  if (!tableName?.trim()) {
    return '"__unknown_table__"'
  }
  return quoteQualifiedIdentifier(tableName)
}

function buildInsertDebugSql(payload: AthenaInsertPayload): string {
  const rows = Array.isArray(payload.insert_body)
    ? payload.insert_body
    : [payload.insert_body]
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seen.has(column)) continue
      seen.add(column)
      columns.push(column)
    }
  }

  const sqlParts = [`INSERT INTO ${quoteQualifiedIdentifier(payload.table_name)}`]

  if (!rows.length || !columns.length) {
    sqlParts.push('DEFAULT VALUES')
    if (rows.length > 1) {
      sqlParts.push(`/* trace: ${rows.length} rows collapsed to DEFAULT VALUES */`)
    }
  } else {
    const valuesClause = rows
      .map(row => {
        const values = columns.map(column => {
          const hasColumn = Object.prototype.hasOwnProperty.call(row, column)
          if (!hasColumn) {
            return payload.default_to_null ? 'NULL' : 'DEFAULT'
          }
          const rowValue = (row as Record<string, AthenaJsonValue | undefined>)[column]
          return toSqlJsonLiteral(rowValue)
        })
        return `(${values.join(', ')})`
      })
      .join(', ')
    const columnClause = columns.map(column => quoteQualifiedIdentifier(column)).join(', ')
    sqlParts.push(`(${columnClause})`)
    sqlParts.push(`VALUES ${valuesClause}`)
  }

  if (payload.on_conflict) {
    const conflictColumns = Array.isArray(payload.on_conflict)
      ? payload.on_conflict.map(column => quoteQualifiedIdentifier(column)).join(', ')
      : payload.on_conflict
    if (payload.update_body && Object.keys(payload.update_body).length > 0) {
      const assignments = Object.entries(payload.update_body).map(([column, value]) =>
        `${quoteQualifiedIdentifier(column)} = ${toSqlJsonLiteral(value as AthenaJsonValue)}`,
      )
      sqlParts.push(`ON CONFLICT (${conflictColumns}) DO UPDATE SET ${assignments.join(', ')}`)
    } else {
      sqlParts.push(`ON CONFLICT (${conflictColumns}) DO NOTHING`)
    }
  }

  if (payload.columns) {
    sqlParts.push(`RETURNING ${buildSelectColumnsClause(payload.columns)}`)
  }

  return `${sqlParts.join(' ')};`
}

function buildUpdateDebugSql(payload: AthenaUpdatePayload): string {
  const set = payload.set ?? payload.data ?? {}
  const assignments = Object.entries(set).map(([column, value]) =>
    `${quoteQualifiedIdentifier(column)} = ${toSqlJsonLiteral(value as AthenaJsonValue)}`,
  )
  const sqlParts = [
    `UPDATE ${resolveDebugTableIdentifier(payload.table_name)} SET ${assignments.length ? assignments.join(', ') : '/* empty set */'}`,
  ]
  if (payload.conditions?.length) {
    const whereClauses = payload.conditions.map(conditionToDebugSqlClause)
    sqlParts.push(`WHERE ${whereClauses.join(' AND ')}`)
  }
  const pagination = resolvePagination({
    currentPage: payload.current_page,
    pageSize: payload.page_size,
  })
  appendOrderLimitOffset(sqlParts, payload.sort_by, pagination.limit, pagination.offset)
  if (payload.columns) {
    sqlParts.push(`RETURNING ${buildSelectColumnsClause(payload.columns)}`)
  }
  return `${sqlParts.join(' ')};`
}

function buildDeleteDebugSql(payload: AthenaDeletePayload): string {
  const sqlParts = [`DELETE FROM ${quoteQualifiedIdentifier(payload.table_name)}`]
  const whereClauses: string[] = []
  if (payload.resource_id) {
    whereClauses.push(`"resource_id" = ${toSqlLiteral(payload.resource_id)}`)
  }
  if (payload.conditions?.length) {
    whereClauses.push(...payload.conditions.map(conditionToDebugSqlClause))
  }
  if (whereClauses.length) {
    sqlParts.push(`WHERE ${whereClauses.join(' AND ')}`)
  }
  const pagination = resolvePagination({
    currentPage: payload.current_page,
    pageSize: payload.page_size,
  })
  appendOrderLimitOffset(sqlParts, payload.sort_by, pagination.limit, pagination.offset)
  if (payload.columns) {
    sqlParts.push(`RETURNING ${buildSelectColumnsClause(payload.columns)}`)
  }
  return `${sqlParts.join(' ')};`
}

function rpcFilterToSqlClause(filter: AthenaRpcFilter): string {
  const column = quoteQualifiedIdentifier(filter.column)
  const value = filter.value
  switch (filter.operator) {
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'like':
    case 'ilike': {
      if (value === undefined || Array.isArray(value)) {
        return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`
      }
      const operatorMap = {
        eq: '=',
        neq: '!=',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
        like: 'LIKE',
        ilike: 'ILIKE',
      } as const
      return `${column} ${operatorMap[filter.operator]} ${toSqlLiteral(value)}`
    }
    case 'is':
      if (value === null) return `${column} IS NULL`
      if (value === true) return `${column} IS TRUE`
      if (value === false) return `${column} IS FALSE`
      return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`
    case 'in':
      if (!Array.isArray(value)) {
        return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`
      }
      if (value.length === 0) return 'FALSE'
      return `${column} IN (${value.map(item => toSqlLiteral(item)).join(', ')})`
    default:
      return `TRUE /* unsupported rpc filter: ${sanitizeSqlComment(JSON.stringify(filter))} */`
  }
}

function buildRpcDebugSql(payload: AthenaRpcPayload): string {
  const argsEntries = payload.args ? Object.entries(payload.args) : []
  const argsClause = argsEntries
    .map(([key, value]) => `${quoteQualifiedIdentifier(key)} => ${toSqlJsonLiteral(value as AthenaJsonValue)}`)
    .join(', ')
  const functionRef = payload.schema
    ? `${quoteQualifiedIdentifier(payload.schema)}.${quoteQualifiedIdentifier(payload.function)}`
    : quoteQualifiedIdentifier(payload.function)
  const sqlParts = [
    `SELECT ${payload.select ? quoteSelectColumnsExpression(payload.select) : '*'} FROM ${functionRef}(${argsClause})`,
  ]
  if (payload.filters?.length) {
    sqlParts.push(`WHERE ${payload.filters.map(rpcFilterToSqlClause).join(' AND ')}`)
  }
  if (payload.order?.column) {
    const direction = payload.order.ascending === false ? 'DESC' : 'ASC'
    sqlParts.push(`ORDER BY ${quoteQualifiedIdentifier(payload.order.column)} ${direction}`)
  }
  if (payload.limit !== undefined) {
    sqlParts.push(`LIMIT ${Math.max(0, Math.trunc(payload.limit))}`)
  }
  if (payload.offset !== undefined) {
    sqlParts.push(`OFFSET ${Math.max(0, Math.trunc(payload.offset))}`)
  }
  return `${sqlParts.join(' ')};`
}

function createFilterMethods<Self, Row>(
  state: TableBuilderState,
  addCondition: (
    operator: AthenaConditionOperator,
    column?: string,
    value?: AthenaConditionValue | AthenaConditionArrayValue | string,
    hints?: ConditionCastHints,
  ) => void,
  self: Self,
): FilterChain<Self, Row> {
  return {
    eq(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      const columnName = String(column)
      if (shouldUseUuidTextComparison(columnName, value)) {
        addCondition('eq', columnName, value, { columnCast: 'text' })
      } else {
        addCondition('eq', columnName, value)
      }
      return self
    },
    eqCast(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue, cast: AthenaConditionCastType) {
      addCondition('eq', String(column), value, { valueCast: cast })
      return self
    },
    eqUuid(column: ResolvedFilterColumnKey<Row>, value: string) {
      addCondition('eq', String(column), value, { valueCast: 'uuid' })
      return self
    },
    match(filters: Partial<Record<ResolvedFilterColumnKey<Row>, AthenaConditionValue>>) {
      Object.entries(filters as Record<string, AthenaConditionValue | undefined>).forEach(([column, value]) => {
        if (value === undefined) {
          return
        }
        if (shouldUseUuidTextComparison(column, value)) {
          addCondition('eq', column, value, { columnCast: 'text' })
        } else {
          addCondition('eq', column, value)
        }
      })
      return self
    },
    range(from: number, to: number) {
      state.offset = from
      state.limit = to - from + 1
      return self
    },
    limit(count: number) {
      state.limit = count
      return self
    },
    offset(count: number) {
      state.offset = count
      return self
    },
    currentPage(value: number) {
      state.currentPage = value
      return self
    },
    pageSize(value: number) {
      state.pageSize = value
      return self
    },
    totalPages(value: number) {
      state.totalPages = value
      return self
    },
    order(column: ResolvedFilterColumnKey<Row>, options?: OrderOptions) {
      state.order = {
        field: String(column),
        direction: options?.ascending === false ? 'descending' : 'ascending',
      }
      return self
    },
    gt(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('gt', String(column), value)
      return self
    },
    gte(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('gte', String(column), value)
      return self
    },
    lt(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('lt', String(column), value)
      return self
    },
    lte(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('lte', String(column), value)
      return self
    },
    neq(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('neq', String(column), value)
      return self
    },
    like(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('like', String(column), value)
      return self
    },
    ilike(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('ilike', String(column), value)
      return self
    },
    is(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
      addCondition('is', String(column), value)
      return self
    },
    in(column: ResolvedFilterColumnKey<Row>, values: AthenaConditionArrayValue) {
      addCondition('in', String(column), values)
      return self
    },
    contains(column: ResolvedFilterColumnKey<Row>, values: AthenaConditionArrayValue) {
      addCondition('contains', String(column), values)
      return self
    },
    containedBy(column: ResolvedFilterColumnKey<Row>, values: AthenaConditionArrayValue) {
      addCondition('containedBy', String(column), values)
      return self
    },
    not(
      columnOrExpression: ResolvedFilterColumnKey<Row> | string,
      operator?: AthenaConditionOperator,
      value?: AthenaConditionValue,
    ) {
      const expression = String(columnOrExpression)
      if (operator != null && value !== undefined) {
        addCondition('not', undefined, `${expression}.${operator}.${stringifyFilterValue(value)}`)
      } else {
        addCondition('not', undefined, expression)
      }
      return self
    },
    or(expression: string) {
      addCondition('or', undefined, expression)
      return self
    },
  }
}

function toRpcSelect(columns?: AthenaSelectInput) {
  if (!columns) return undefined
  if (typeof columns === 'string') {
    return columns
  }
  return columns.join(',')
}

function createRpcFilterMethods<Self>(
  filters: AthenaRpcFilter[],
  self: Self,
) {
  const addFilter = (
    operator: AthenaRpcFilterOperator,
    column: string,
    value: AthenaConditionValue | AthenaConditionArrayValue | string,
  ) => {
    filters.push({ column, operator, value })
  }

  return {
    eq(column: string, value: AthenaConditionValue) {
      addFilter('eq', column, value)
      return self
    },
    neq(column: string, value: AthenaConditionValue) {
      addFilter('neq', column, value)
      return self
    },
    gt(column: string, value: AthenaConditionValue) {
      addFilter('gt', column, value)
      return self
    },
    gte(column: string, value: AthenaConditionValue) {
      addFilter('gte', column, value)
      return self
    },
    lt(column: string, value: AthenaConditionValue) {
      addFilter('lt', column, value)
      return self
    },
    lte(column: string, value: AthenaConditionValue) {
      addFilter('lte', column, value)
      return self
    },
    like(column: string, value: AthenaConditionValue) {
      addFilter('like', column, value)
      return self
    },
    ilike(column: string, value: AthenaConditionValue) {
      addFilter('ilike', column, value)
      return self
    },
    is(column: string, value: AthenaConditionValue) {
      addFilter('is', column, value)
      return self
    },
    in(column: string, values: AthenaConditionArrayValue) {
      addFilter('in', column, values)
      return self
    },
  }
}

function createRpcBuilder<Row, TStrict extends boolean = false>(
  functionName: string,
  args: AthenaJsonObject | undefined,
  baseOptions: AthenaRpcCallOptions | undefined,
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
  debugAstEnabled = false,
): RpcQueryBuilder<Row, TStrict> {
  const state: {
    filters: AthenaRpcFilter[]
    limit?: number
    offset?: number
    order?: { column: string; ascending?: boolean }
  } = {
    filters: [],
  }

  let selectedColumns: AthenaSelectInput | undefined
  let selectedOptions: AthenaRpcCallOptions | undefined
  let promise: Promise<AthenaResult<Row[]>> | null = null
  const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite)

  const executeRpc = async <SelectedRow = Row>(
    columns?: AthenaSelectInput,
    options?: AthenaRpcCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ): Promise<AthenaResult<SelectedRow[]>> => {
    const mergedOptions = mergeOptions(baseOptions, options)
    const normalizedSelectedColumns = normalizeSelectColumnsInput(columns)
    const payload: AthenaRpcPayload = {
      function: functionName,
      args,
      schema: mergedOptions?.schema,
      select: toRpcSelect(columns),
      filters: state.filters.length ? [...state.filters] : undefined,
      count: mergedOptions?.count,
      head: mergedOptions?.head,
      limit: state.limit,
      offset: state.offset,
      order: state.order,
    }
    const endpoint: AthenaQueryTraceEvent['endpoint'] = mergedOptions?.get
      ? `/rpc/${functionName}`
      : '/gateway/rpc'
    const sql = buildRpcDebugSql(payload)
    const debugAst = debugAstEnabled
      ? buildRpcDebugAst({
          functionName,
          args,
          selectedColumns: normalizedSelectedColumns,
          state,
          payload,
          endpoint,
        })
      : undefined
    return executeWithQueryTrace(
      tracer,
      {
        operation: 'rpc',
        endpoint,
        functionName,
        sql,
        payload,
        ast: debugAst,
        options: mergedOptions,
      },
      async () => {
        const response = await client.rpcGateway<SelectedRow[]>(payload, mergedOptions)
        return formatGatewayResult(response, { operation: 'rpc' })
      },
      callsite,
    )
  }

  const run = (
    columns?: AthenaSelectInput,
    options?: AthenaRpcCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ) => {
    const payloadColumns = columns ?? selectedColumns
    const payloadOptions = options ?? selectedOptions
    if (!promise) {
      promise = executeRpc<Row>(payloadColumns, payloadOptions, callsiteStore.resolve(callsite))
    }
    return promise
  }

  const builder = {} as RpcQueryBuilder<Row, TStrict>
  const filterMethods = createRpcFilterMethods(state.filters, builder)

  Object.assign(builder, filterMethods, {
    select(columns?: AthenaSelectInput, options?: AthenaRpcCallOptions) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options, captureTraceCallsite(tracer))
    },
    async single<T = Row>(columns?: AthenaSelectInput, options?: AthenaRpcCallOptions) {
      const result = await run(columns, options, captureTraceCallsite(tracer))
      return toSingleResult(result) as AthenaResult<T | null>
    },
    maybeSingle<T = Row>(columns?: AthenaSelectInput, options?: AthenaRpcCallOptions) {
      return builder.single<T, AthenaSelectInput>(columns, options)
    },
    order(column: string, options?: RpcOrderOptions) {
      state.order = { column, ascending: options?.ascending ?? true }
      return builder
    },
    limit(count: number) {
      state.limit = count
      return builder
    },
    offset(count: number) {
      state.offset = count
      return builder
    },
    range(from: number, to: number) {
      state.offset = from
      state.limit = to - from + 1
      return builder
    },
    then<T1 = AthenaResult<Row[]>, T2 = never>(
      onfulfilled?: (v: AthenaResult<Row[]>) => T1 | PromiseLike<T1>,
      onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
    ) {
      return run(selectedColumns, selectedOptions).then(onfulfilled, onrejected)
    },
    catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
      return run(selectedColumns, selectedOptions).catch(onrejected)
    },
    finally(onfinally?: () => void) {
      return run(selectedColumns, selectedOptions).finally(onfinally)
    },
  })

  return builder
}

function createTableBuilder<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  TContext = unknown,
  TStrict extends boolean = false,
>(
  tableName: string,
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
  tracer?: AthenaQueryTracer,
  experimental?: AthenaClientExperimentalOptions,
): TableQueryBuilder<Row, Insert, Update, TContext, TStrict> {
  const state: TableBuilderState = {
    conditions: [],
  }
  const debugAstEnabled = Boolean(experimental?.debugAst)

  const addCondition = (
    operator: AthenaConditionOperator,
    column?: string,
    value?: AthenaConditionValue | AthenaConditionArrayValue | string,
    hints?: ConditionCastHints,
  ) => {
    const condition: AthenaGatewayCondition = { operator }
    if (column) {
      condition.column = column
      if (operator === 'eq') {
        // include legacy gateway shape for compatibility
        condition.eq_column = column
      }
    }
    if (value !== undefined) {
      condition.value = value
      if (operator === 'eq') {
        condition.eq_value = value
      }
    }
    if (hints?.valueCast) {
      condition.value_cast = hints.valueCast
      if (operator === 'eq') {
        condition.eq_value_cast = hints.valueCast
      }
    }
    if (hints?.columnCast) {
      condition.column_cast = hints.columnCast
      if (operator === 'eq') {
        condition.eq_column_cast = hints.columnCast
      }
    }
    state.conditions.push(condition)
  }

  const snapshotState = (): TableBuilderState => ({
    conditions: state.conditions.map(condition => ({ ...condition })),
    limit: state.limit,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
    currentPage: state.currentPage,
    pageSize: state.pageSize,
    totalPages: state.totalPages,
  })

  const builder = {} as TableQueryBuilder<Row, Insert, Update, TContext, TStrict>

  const filterMethods = createFilterMethods<TableQueryBuilder<Row, Insert, Update, TContext, TStrict>, Row>(
    state,
    addCondition,
    builder,
  )

  const runSelect = async <T = Row>(
    columns: AthenaSelectInput = DEFAULT_COLUMNS,
    options?: AthenaGatewayCallOptions,
    executionState: TableBuilderState = snapshotState(),
    callsite?: AthenaQueryTraceCallsite | null,
    debugAstFactory?: SelectDebugAstFactory,
  ) => {
    const runtimeColumns = normalizeSelectColumnsInput(columns) ?? DEFAULT_COLUMNS
    const resolvedTableName = resolveTableNameForCall(tableName, options?.schema)
    const plan = createSelectTransportPlan({
      tableName: resolvedTableName,
      columns: runtimeColumns,
      state: executionState,
      options,
      buildTypedSelectQuery,
    })
    const debugAst = debugAstEnabled
      ? (debugAstFactory?.({
          tableName: resolvedTableName,
          columns: runtimeColumns,
          executionState,
          plan,
        }) ?? buildSelectDebugAst({
          tableName: resolvedTableName,
          columns: runtimeColumns,
          state: executionState,
          plan,
        }))
      : undefined

    if (plan.kind === 'query') {
      return executeExperimentalRead(experimental, () =>
        executeWithQueryTrace(
          tracer,
          {
            operation: 'select',
            endpoint: '/gateway/query',
            table: resolvedTableName,
            sql: plan.query,
            payload: plan.payload,
            ast: debugAst,
            options,
          },
          async () => {
            const queryResponse = await client.queryGateway<T>(plan.payload, options)
            return formatGatewayResult(queryResponse, { table: resolvedTableName, operation: 'select' })
          },
          callsite,
        ),
      )
    }

    const sql = buildDebugSelectQuery({
      tableName: resolvedTableName,
      ...plan.debug,
    })
    return executeExperimentalRead(experimental, () =>
      executeWithQueryTrace(
        tracer,
        {
          operation: 'select',
          endpoint: '/gateway/fetch',
          table: resolvedTableName,
          sql,
          payload: plan.payload,
          ast: debugAst,
          options,
        },
        async () => {
          const response = await client.fetchGateway<T>(plan.payload, options)
          return formatGatewayResult(response, { table: resolvedTableName, operation: 'select' })
        },
        callsite,
      ),
    )
  }

  const createSelectChain = <SelectedRow>(
    columns: AthenaSelectInput,
    options?: AthenaGatewayCallOptions,
    initialCallsite?: AthenaQueryTraceCallsite | null,
  ): SelectChain<Row, SelectedRow, TStrict> => {
    const chain = {} as SelectChain<Row, SelectedRow, TStrict>
    const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite)
    const filterMethods = createFilterMethods<SelectChain<Row, SelectedRow, TStrict>, Row>(
      state,
      addCondition,
      chain,
    )
    Object.assign(chain, filterMethods, {
      async single<T = SelectedRow>(cols?: AthenaSelectInput, opts?: AthenaGatewayCallOptions) {
        const r = await runSelect<T[]>(
          cols ?? columns,
          opts ?? options,
          snapshotState(),
          callsiteStore.resolve(captureTraceCallsite(tracer)),
        )
        return toSingleResult(r)
      },
      maybeSingle<T = SelectedRow>(cols?: AthenaSelectInput, opts?: AthenaGatewayCallOptions) {
        return chain.single<T, AthenaSelectInput>(cols, opts)
      },
      then<T1 = AthenaResult<SelectedRow[]>, T2 = never>(
        onfulfilled?: (v: AthenaResult<SelectedRow[]>) => T1 | PromiseLike<T1>,
        onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
      ) {
        return runSelect<SelectedRow[]>(
          columns,
          options,
          snapshotState(),
          callsiteStore.resolve(),
        ).then(onfulfilled, onrejected)
      },
      catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
        return runSelect<SelectedRow[]>(columns, options, snapshotState(), callsiteStore.resolve()).catch(
          onrejected,
        )
      },
      finally(onfinally?: () => void) {
        return runSelect<SelectedRow[]>(columns, options, snapshotState(), callsiteStore.resolve()).finally(
          onfinally,
        )
      },
    })
    return chain
  }

  Object.assign(builder, filterMethods, {
    reset() {
      state.conditions = []
      state.limit = undefined
      state.offset = undefined
      state.order = undefined
      state.currentPage = undefined
      state.pageSize = undefined
      state.totalPages = undefined
      return builder
    },
    select<T = Row>(columns: AthenaSelectInput = DEFAULT_COLUMNS, options?: AthenaGatewayCallOptions) {
      return createSelectChain<T>(columns, options, captureTraceCallsite(tracer))
    },
    async findMany<const TSelect extends AthenaSelectShape>(
      options: AthenaFindManyOptions<Row, TSelect> & {
        select: AthenaValidatedSelectShape<TSelect>
      },
    ) {
      const columns = compileSelectShape(options.select)
      const baseState = snapshotState()
      const executionState = snapshotState()
      const callsite = captureTraceCallsite(tracer)
      const compiledWhere = compileWhere(options.where)
      if (compiledWhere?.length) {
        executionState.conditions.push(...compiledWhere)
      }
      if (options.orderBy !== undefined) {
        executionState.order = compileOrderBy<Row>(options.orderBy)
      }
      if (options.limit !== undefined) {
        executionState.limit = options.limit
      }
      if (
        experimental?.findManyAst &&
        canUseFindManyAstTransport(baseState) &&
        !selectShapeUsesRelationSchema(options.select) &&
        !findManyAstWhereRequiresLegacyTransport(options.where)
      ) {
        const resolvedTableName = resolveTableNameForCall(tableName, undefined)
        const payload: AthenaFindManyAstPayload<Row, TSelect> = {
          table_name: resolvedTableName,
          select: options.select,
        }
        if (options.where !== undefined) {
          payload.where = normalizeFindManyAstWhere(options.where)
        }
        const astOrder = toFindManyAstOrder<Row>(executionState.order)
        if (astOrder !== undefined) {
          payload.orderBy = astOrder
        }
        if (executionState.limit !== undefined) {
          payload.limit = executionState.limit
        }
        const sql = buildDebugSelectQuery({
          tableName: resolvedTableName,
          columns,
          conditions: executionState.conditions,
          limit: executionState.limit,
          order: executionState.order,
        })
        const debugAst = debugAstEnabled
          ? buildFindManyDirectDebugAst({
              tableName: resolvedTableName,
              options,
              compiledColumns: columns,
              baseState,
              executionState,
              payload,
            })
          : undefined
        return executeExperimentalRead(experimental, () =>
          executeWithQueryTrace(
            tracer,
            {
              operation: 'select',
              endpoint: '/gateway/fetch',
              table: resolvedTableName,
              sql,
              payload,
              ast: debugAst,
            },
            async () => {
              const response = await client.fetchGateway<Array<AthenaFindManyResult<Row, TSelect, TContext>>>(
                payload,
              )
              return formatGatewayResult(response, { table: resolvedTableName, operation: 'select' })
            },
            callsite,
          ),
        )
      }
      return runSelect<Array<AthenaFindManyResult<Row, TSelect, TContext>>>(
        columns,
        undefined,
        executionState,
        callsite,
        debugAstEnabled
          ? ({ tableName: resolvedTableName, executionState: tracedState, plan }) =>
              buildFindManyCompiledDebugAst({
                tableName: resolvedTableName,
                options,
                compiledColumns: columns,
                baseState,
                executionState: tracedState,
                plan,
              })
          : undefined,
      )
    },
    insert(values: Insert | Insert[], options?: AthenaGatewayCallOptions) {
      const mutationCallsite = captureTraceCallsite(tracer)
      if (Array.isArray(values)) {
        const executeInsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
          callsite?: AthenaQueryTraceCallsite | null,
        ) => {
          const mergedOptions = mergeOptions(options, selectOptions)
          const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
          const payload: AthenaInsertPayload = {
            table_name: resolvedTableName,
            insert_body: asAthenaJsonObjectArray(values),
          }
          if (columns) payload.columns = columns
          if (mergedOptions?.count) payload.count = mergedOptions.count
          if (mergedOptions?.head) payload.head = mergedOptions.head
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull
          }
          const sql = buildInsertDebugSql(payload)
          const debugAst = debugAstEnabled ? buildInsertDebugAst(payload) : undefined
          return executeWithQueryTrace(
            tracer,
            {
              operation: 'insert',
              endpoint: '/gateway/insert',
              table: resolvedTableName,
              sql,
              payload,
              ast: debugAst,
              options: mergedOptions,
            },
            async () => {
              const response = await client.insertGateway<Row[]>(payload, mergedOptions)
              return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
            },
            callsite,
          )
        }
        return createMutationQuery<Row[]>(executeInsertMany, DEFAULT_COLUMNS, tracer, mutationCallsite)
      }
      const executeInsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
        const payload: AthenaInsertPayload = {
          table_name: resolvedTableName,
          insert_body: asAthenaJsonObject(values),
        }
        if (columns) payload.columns = columns
        if (mergedOptions?.count) payload.count = mergedOptions.count
        if (mergedOptions?.head) payload.head = mergedOptions.head
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull
        }
        const sql = buildInsertDebugSql(payload)
        const debugAst = debugAstEnabled ? buildInsertDebugAst(payload) : undefined
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'insert',
            endpoint: '/gateway/insert',
            table: resolvedTableName,
            sql,
            payload,
            ast: debugAst,
            options: mergedOptions,
          },
          async () => {
            const response = await client.insertGateway<Row>(payload, mergedOptions)
            return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
          },
          callsite,
        )
      }
      return createMutationQuery<Row>(executeInsertOne, DEFAULT_COLUMNS, tracer, mutationCallsite)
    },
    upsert(
      values: Insert | Insert[],
      options?: AthenaGatewayCallOptions & { updateBody?: Update; onConflict?: string | string[] },
    ) {
      const mutationCallsite = captureTraceCallsite(tracer)
      if (Array.isArray(values)) {
        const executeUpsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
          callsite?: AthenaQueryTraceCallsite | null,
        ) => {
          const mergedOptions = mergeOptions(options, selectOptions)
          const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
          const payload: AthenaInsertPayload = {
            table_name: resolvedTableName,
            insert_body: asAthenaJsonObjectArray(values),
            update_body: options?.updateBody ? asAthenaJsonObject(options.updateBody) : undefined,
          }
          if (columns) payload.columns = columns
          if (options?.onConflict) payload.on_conflict = options.onConflict
          if (mergedOptions?.count) payload.count = mergedOptions.count
          if (mergedOptions?.head) payload.head = mergedOptions.head
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull
          }
          const sql = buildInsertDebugSql(payload)
          const debugAst = debugAstEnabled ? buildUpsertDebugAst(payload) : undefined
          return executeWithQueryTrace(
            tracer,
            {
              operation: 'upsert',
              endpoint: '/gateway/insert',
              table: resolvedTableName,
              sql,
              payload,
              ast: debugAst,
              options: mergedOptions,
            },
            async () => {
              const response = await client.insertGateway<Row[]>(payload, mergedOptions)
              return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
            },
            callsite,
          )
        }
        return createMutationQuery<Row[]>(executeUpsertMany, DEFAULT_COLUMNS, tracer, mutationCallsite)
      }
      const executeUpsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
        const payload: AthenaInsertPayload = {
          table_name: resolvedTableName,
          insert_body: asAthenaJsonObject(values),
          update_body: options?.updateBody ? asAthenaJsonObject(options.updateBody) : undefined,
        }
        if (columns) payload.columns = columns
        if (options?.onConflict) payload.on_conflict = options.onConflict
        if (mergedOptions?.count) payload.count = mergedOptions.count
        if (mergedOptions?.head) payload.head = mergedOptions.head
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull
        }
        const sql = buildInsertDebugSql(payload)
        const debugAst = debugAstEnabled ? buildUpsertDebugAst(payload) : undefined
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'upsert',
            endpoint: '/gateway/insert',
            table: resolvedTableName,
            sql,
            payload,
            ast: debugAst,
            options: mergedOptions,
          },
          async () => {
            const response = await client.insertGateway<Row>(payload, mergedOptions)
            return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
          },
          callsite,
        )
      }
      return createMutationQuery<Row>(executeUpsertOne, DEFAULT_COLUMNS, tracer, mutationCallsite)
    },
    update(values: Update, options?: AthenaGatewayCallOptions) {
      const mutationCallsite = captureTraceCallsite(tracer)
      const executeUpdate = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null,
      ) => {
        const executionState = snapshotState()
        const filters = executionState.conditions.length ? [...executionState.conditions] : undefined
        const mergedOptions = mergeOptions(options, selectOptions)
        const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
        const payload: AthenaUpdatePayload = {
          table_name: resolvedTableName,
          set: asAthenaJsonObject(values),
          conditions: filters,
          strip_nulls: mergedOptions?.stripNulls ?? true,
        }
        if (executionState.order) payload.sort_by = executionState.order
        if (executionState.currentPage !== undefined) payload.current_page = executionState.currentPage
        if (executionState.pageSize !== undefined) payload.page_size = executionState.pageSize
        if (executionState.totalPages !== undefined) payload.total_pages = executionState.totalPages
        if (columns) payload.columns = columns
        const sql = buildUpdateDebugSql(payload)
        const debugAst = debugAstEnabled
          ? buildUpdateDebugAst({
              state: executionState,
              payload,
            })
          : undefined
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'update',
            endpoint: '/gateway/update',
            table: resolvedTableName,
            sql,
            payload,
            ast: debugAst,
            options: mergedOptions,
          },
          async () => {
            const response = await client.updateGateway<Row[]>(payload, mergedOptions)
            return formatGatewayResult(response, { table: resolvedTableName, operation: 'update' })
          },
          callsite,
        )
      }
      const mutation = createMutationQuery<Row[]>(executeUpdate, null, tracer, mutationCallsite)
      const updateChain = {} as UpdateChain<Row>
      const filterMethods = createFilterMethods<UpdateChain<Row>, Row>(state, addCondition, updateChain)
      Object.assign(updateChain, filterMethods, mutation)
      return updateChain
    },
    delete(options?: AthenaGatewayCallOptions & { resourceId?: string }) {
      const filters = state.conditions.length ? [...state.conditions] : undefined
      const resourceId = options?.resourceId ?? getResourceId(state)
      if (!resourceId && !filters?.length) {
        throw new Error('delete requires a resource_id either via eq("resource_id", ...) or options.resourceId')
      }
      const mutationCallsite = captureTraceCallsite(tracer)
      const executeDelete = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null,
      ) => {
        const executionState = snapshotState()
        const debugState: TableBuilderState = {
          ...executionState,
          conditions: filters ? filters.map(condition => ({ ...condition })) : [],
        }
        const mergedOptions = mergeOptions(options, selectOptions)
        const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
        const payload: AthenaDeletePayload = {
          table_name: resolvedTableName,
          resource_id: resourceId,
          conditions: filters,
        }
        if (executionState.order) payload.sort_by = executionState.order
        if (executionState.currentPage !== undefined) payload.current_page = executionState.currentPage
        if (executionState.pageSize !== undefined) payload.page_size = executionState.pageSize
        if (executionState.totalPages !== undefined) payload.total_pages = executionState.totalPages
        if (columns) payload.columns = columns
        const sql = buildDeleteDebugSql(payload)
        const debugAst = debugAstEnabled
          ? buildDeleteDebugAst({
              state: debugState,
              payload,
            })
          : undefined
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'delete',
            endpoint: '/gateway/delete',
            table: resolvedTableName,
            sql,
            payload,
            ast: debugAst,
            options: mergedOptions,
          },
          async () => {
            const response = await client.deleteGateway<Row | null>(payload, mergedOptions)
            return formatGatewayResult(response, { table: resolvedTableName, operation: 'delete' })
          },
          callsite,
        )
      }
      return createMutationQuery<Row | null>(executeDelete, null, tracer, mutationCallsite)
    },
    async single<T = Row>(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
      const response = await runSelect<T[]>(
        columns ?? DEFAULT_COLUMNS,
        options,
        snapshotState(),
        captureTraceCallsite(tracer),
      )
      return toSingleResult(response)
    },
    async maybeSingle<T = Row>(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
      return builder.single<T, AthenaSelectInput>(columns, options)
    },
  })

  return builder
}

function createQueryBuilder(
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
  experimental?: AthenaClientExperimentalOptions,
  tracer?: AthenaQueryTracer,
) {
  const debugAstEnabled = Boolean(experimental?.debugAst)
  return async function query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      throw new Error('query requires a non-empty string')
    }
    const payload = { query: normalizedQuery }
    const callsite = captureTraceCallsite(tracer)
    return executeExperimentalRead(experimental, () =>
      executeWithQueryTrace(
        tracer,
        {
          operation: 'query',
          endpoint: '/gateway/query',
          sql: normalizedQuery,
          payload,
          ast: debugAstEnabled ? buildRawQueryDebugAst(normalizedQuery) : undefined,
          options,
        },
        async () => {
          const response = await client.queryGateway<Row[]>(payload, options)
          return formatGatewayResult(response, { operation: 'query' })
        },
        callsite,
      ),
    )
  }
}

export interface AthenaSdkClient<TStrict extends boolean = false> {
  from<TModel extends AthenaModelTarget>(
    model: TModel,
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown, TStrict>
  from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update, unknown, TStrict>
  db: AthenaDbModule<TStrict>
  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row, TStrict>
  query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions): Promise<AthenaResult<Row[]>>
  request<T = unknown>(options: AthenaRequestOptions): Promise<AthenaRequestResponse<T>>
  verifyConnection(options?: AthenaGatewayConnectionOptions): Promise<AthenaGatewayConnectionResult>
  withContext(context?: AthenaClientContextOptions): AthenaSdkClient<TStrict>
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): AthenaSdkClient<TStrict>
}

export interface AthenaSdkClientWithAuth<TStrict extends boolean = false> extends AthenaSdkClient<TStrict> {
  auth: AthenaAuthBindings
  chat: AthenaChatModule
  withContext(context?: AthenaClientContextOptions): AthenaSdkClientWithAuth<TStrict>
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): AthenaSdkClientWithAuth<TStrict>
  withOptions(options?: AthenaClientOverrideOptions): AthenaSdkClientWithAuth<TStrict>
}

export interface AthenaSdkClientWithStorage<TStrict extends boolean = false> extends AthenaSdkClientWithAuth<TStrict> {
  storage: AthenaStorageModule
  withContext(context?: AthenaClientContextOptions): AthenaSdkClientWithStorage<TStrict>
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): AthenaSdkClientWithStorage<TStrict>
  withOptions(options?: AthenaClientOverrideOptions): AthenaSdkClientWithStorage<TStrict>
}

export interface AthenaHeaderBag {
  get(name: string): string | null
}

export interface AthenaClientSessionLike {
  user?: {
    id?: string | null | undefined
  } | null | undefined
  session?: {
    token?: string | null | undefined
    activeOrganizationId?: string | null | undefined
  } | null | undefined
}

export interface AthenaCreateClientServiceUrlConfig {
  url?: string | null | undefined
}

export interface AthenaCreateClientChatOptions extends AthenaCreateClientServiceUrlConfig {
  wsUrl?: string | null | undefined
  webSocketFactory?: AthenaChatWebSocketFactory | null | undefined
}

export interface AthenaCreateClientAuthOptions
  extends Omit<AthenaAuthClientConfig, 'baseUrl' | 'apiKey' | 'bearerToken' | 'cookie' | 'sessionToken'> {
  url?: string | null | undefined
  baseUrl?: string | null | undefined
  apiKey?: string | null | undefined
  bearerToken?: string | null | undefined
  cookie?: string | null | undefined
  sessionToken?: string | null | undefined
}

export interface AthenaCreateClientOptions {
  client?: string | null | undefined
  userId?: string | null | undefined
  organizationId?: string | null | undefined
  forceNoCache?: boolean
  headers?: Record<string, string>
  backend?: BackendConfig | BackendType
  db?: AthenaCreateClientServiceUrlConfig
  gateway?: AthenaCreateClientServiceUrlConfig
  auth?: AthenaCreateClientAuthOptions
  chat?: AthenaCreateClientChatOptions
  storage?: AthenaCreateClientServiceUrlConfig
  dbUrl?: string | null | undefined
  gatewayUrl?: string | null | undefined
  authUrl?: string | null | undefined
  chatUrl?: string | null | undefined
  chatWsUrl?: string | null | undefined
  storageUrl?: string | null | undefined
  experimental?: AthenaClientExperimentalOptions
}

export interface AthenaCreateClientOptionsWithStorage extends AthenaCreateClientOptions {
  experimental: AthenaClientExperimentalOptions & {
    athenaStorageBackend: true
  }
}

export interface AthenaCreateClientOptionsWithTypecheckedColumns extends AthenaCreateClientOptions {
  experimental: AthenaClientExperimentalOptions & {
    typecheckColumns: true
  }
}

export interface AthenaCreateClientOptionsWithStorageAndTypecheckedColumns extends AthenaCreateClientOptions {
  experimental: AthenaClientExperimentalOptions & {
    athenaStorageBackend: true
    typecheckColumns: true
  }
}

export interface AthenaCreateClientConfig extends AthenaCreateClientOptions {
  url?: string | null | undefined
  key: string | null | undefined
}

export interface AthenaCreateClientConfigWithStorage extends AthenaCreateClientOptionsWithStorage {
  url?: string | null | undefined
  key: string | null | undefined
}

export interface AthenaCreateClientConfigWithTypecheckedColumns extends AthenaCreateClientOptionsWithTypecheckedColumns {
  url?: string | null | undefined
  key: string | null | undefined
}

export interface AthenaCreateClientConfigWithStorageAndTypecheckedColumns extends AthenaCreateClientOptionsWithStorageAndTypecheckedColumns {
  url?: string | null | undefined
  key: string | null | undefined
}

export interface AthenaClientOverrideOptions extends Omit<AthenaCreateClientOptions, 'experimental'> {
  url?: string | null | undefined
  key?: string | null | undefined
}

export interface AthenaClientContextOptions {
  userId?: string | null | undefined
  organizationId?: string | null | undefined
  forceNoCache?: boolean
  headers?: Record<string, string>
  auth?: Omit<AthenaCreateClientAuthOptions, 'url' | 'baseUrl' | 'apiKey'>
}

export interface AthenaClientSessionOptions extends AthenaClientContextOptions {
  requestHeaders?: AthenaHeaderBag | Record<string, string | null | undefined>
}

export interface AthenaClientFromEnvironmentOptions extends AthenaCreateClientOptions {
  env?: Record<string, string | undefined>
  url?: string | null | undefined
  key?: string | null | undefined
}

export interface AthenaClientFromEnvironmentOptionsWithStorage
  extends AthenaClientFromEnvironmentOptions {
  experimental: AthenaClientExperimentalOptions & {
    athenaStorageBackend: true
  }
}

export interface AthenaClientFromEnvironmentOptionsWithTypecheckedColumns
  extends AthenaClientFromEnvironmentOptions {
  experimental: AthenaClientExperimentalOptions & {
    typecheckColumns: true
  }
}

export interface AthenaClientFromEnvironmentOptionsWithStorageAndTypecheckedColumns
  extends AthenaClientFromEnvironmentOptions {
  experimental: AthenaClientExperimentalOptions & {
    athenaStorageBackend: true
    typecheckColumns: true
  }
}

/** Client config for builder */
export interface AthenaClientConfig {
  baseUrl: string
  apiKey: string
  client?: string
  userId?: string | null | undefined
  organizationId?: string | null | undefined
  forceNoCache?: boolean
  backend?: BackendConfig
  headers?: Record<string, string>
  auth?: AthenaCreateClientAuthOptions
  authUrl?: string
  chat?: AthenaCreateClientChatOptions
  chatUrl?: string
  chatWsUrl?: string
  storageUrl?: string
  experimental?: AthenaClientExperimentalOptions
}

const ATHENA_ENV_URL_KEYS = ['ATHENA_URL', 'NEXT_PUBLIC_ATHENA_URL'] as const
const ATHENA_ENV_GATEWAY_URL_KEYS = [
  'ATHENA_DB_URL',
  'ATHENA_GATEWAY_URL',
  'NEXT_PUBLIC_ATHENA_DB_API_URL',
] as const
const ATHENA_ENV_AUTH_URL_KEYS = ['ATHENA_AUTH_URL', 'NEXT_PUBLIC_ATHENA_AUTH_URL'] as const
const ATHENA_ENV_CHAT_URL_KEYS = ['ATHENA_CHAT_URL', 'NEXT_PUBLIC_ATHENA_CHAT_URL'] as const
const ATHENA_ENV_CHAT_WS_URL_KEYS = ['ATHENA_CHAT_WS_URL', 'NEXT_PUBLIC_ATHENA_CHAT_WS_URL'] as const
const ATHENA_ENV_STORAGE_URL_KEYS = ['ATHENA_STORAGE_URL', 'NEXT_PUBLIC_ATHENA_STORAGE_URL'] as const
const ATHENA_ENV_KEY_KEYS = [
  'ATHENA_API_KEY',
  'NEXT_PUBLIC_ATHENA_API_KEY',
  'ATHENA_GATEWAY_API_KEY',
  'X_API_KEY',
] as const
const ATHENA_ENV_CLIENT_KEYS = ['ATHENA_CLIENT', 'NEXT_PUBLIC_ATHENA_CLIENT'] as const

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : undefined
}

function readFirstEnvValue(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = normalizeOptionalString(env[key])
    if (value) {
      return value
    }
  }

  return undefined
}

function readHeaderBagValue(
  headers: AthenaClientSessionOptions['requestHeaders'],
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

    if (typeof value === 'string') {
      return normalizeOptionalString(value)
    }

    return undefined
  }

  return undefined
}

function resolveSessionContextOptions(
  session?: AthenaClientSessionLike | null,
  options?: AthenaClientSessionOptions,
): AthenaClientContextOptions | undefined {
  const sessionToken = normalizeOptionalString(session?.session?.token)
  const requestCookie =
    readHeaderBagValue(options?.requestHeaders, 'cookie') ??
    readHeaderBagValue(options?.headers, 'cookie')

  const authInput = options?.auth
  const resolvedUserId =
    options?.userId !== undefined ? options.userId : session?.user?.id
  const resolvedOrganizationId =
    options?.organizationId !== undefined
      ? options.organizationId
      : session?.session?.activeOrganizationId
  const resolvedBearerToken =
    authInput?.bearerToken !== undefined ? authInput.bearerToken : sessionToken
  const resolvedSessionToken =
    authInput?.sessionToken !== undefined ? authInput.sessionToken : sessionToken
  const resolvedCookie =
    authInput?.cookie !== undefined ? authInput.cookie : requestCookie

  const auth =
    authInput !== undefined ||
    resolvedBearerToken !== undefined ||
    resolvedSessionToken !== undefined ||
    resolvedCookie !== undefined
      ? {
          ...(authInput ?? {}),
          ...(resolvedBearerToken !== undefined
            ? { bearerToken: resolvedBearerToken }
            : {}),
          ...(resolvedSessionToken !== undefined
            ? { sessionToken: resolvedSessionToken }
            : {}),
          ...(resolvedCookie !== undefined ? { cookie: resolvedCookie } : {}),
          headers: authInput?.headers ? { ...authInput.headers } : undefined,
        }
      : undefined

  if (
    resolvedUserId === undefined &&
    resolvedOrganizationId === undefined &&
    options?.forceNoCache === undefined &&
    !options?.headers &&
    !auth
  ) {
    return undefined
  }

  return {
    userId: resolvedUserId,
    organizationId: resolvedOrganizationId,
    forceNoCache: options?.forceNoCache,
    headers: options?.headers ? { ...options.headers } : undefined,
    auth,
  }
}

function resolveClientServiceBaseUrl(
  value: string | null | undefined,
  label: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  return normalizeAthenaGatewayBaseUrl(value, { label })
}

function appendServicePath(baseUrl: string, segment: string): string {
  const normalizedBaseUrl = normalizeAthenaGatewayBaseUrl(baseUrl, { label: 'Athena public base URL' })
  return `${normalizedBaseUrl}/${segment.replace(/^\/+/, '')}`
}

function appendRealtimeGatewayPath(baseUrl: string): string {
  const normalizedBaseUrl = normalizeAthenaGatewayBaseUrl(baseUrl, { label: 'Athena public base URL' })
  const wsUrl = new URL(normalizedBaseUrl)
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl.pathname = `${wsUrl.pathname.replace(/\/+$/, '')}/wss/gateway`
  wsUrl.search = ''
  wsUrl.hash = ''
  return wsUrl.toString()
}

function resolveServiceUrlOverride(
  value: string | null | undefined,
  label: string,
): string | undefined {
  return resolveClientServiceBaseUrl(value, label)
}

function resolveServiceUrls(config: AthenaCreateClientConfig) {
  const baseUrl = resolveClientServiceBaseUrl(config.url, 'Athena public base URL')

  return {
    dbUrl:
      resolveServiceUrlOverride(config.db?.url, 'Athena DB base URL') ??
      resolveServiceUrlOverride(config.gateway?.url, 'Athena gateway base URL') ??
      resolveServiceUrlOverride(config.dbUrl, 'Athena DB base URL') ??
      resolveServiceUrlOverride(config.gatewayUrl, 'Athena gateway base URL') ??
      (baseUrl ? appendServicePath(baseUrl, 'db') : undefined),
    authUrl:
      resolveServiceUrlOverride(config.auth?.url, 'Athena auth base URL') ??
      resolveServiceUrlOverride(config.auth?.baseUrl, 'Athena auth base URL') ??
      resolveServiceUrlOverride(config.authUrl, 'Athena auth base URL') ??
      (baseUrl ? appendServicePath(baseUrl, 'auth') : undefined),
    chatUrl:
      resolveServiceUrlOverride(config.chat?.url, 'Athena chat base URL') ??
      resolveServiceUrlOverride(config.chatUrl, 'Athena chat base URL') ??
      (baseUrl ? appendServicePath(baseUrl, 'chat') : undefined),
    chatWsUrl:
      normalizeOptionalString(config.chat?.wsUrl) ??
      normalizeOptionalString(config.chatWsUrl) ??
      (baseUrl ? appendRealtimeGatewayPath(baseUrl) : undefined),
    storageUrl:
      resolveServiceUrlOverride(config.storage?.url, 'Athena storage base URL') ??
      resolveServiceUrlOverride(config.storageUrl, 'Athena storage base URL') ??
      (baseUrl ? appendServicePath(baseUrl, 'storage') : undefined),
  }
}

function resolveOptionalClientName(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : undefined
}

function resolveRequiredClientApiKey(value: string | null | undefined): string {
  if (value === undefined || value === null) {
    throw new Error(
      'Athena API key is required. Pass createClient(url, key) with a real API key, or set key in the config object.',
    )
  }

  const normalizedValue = value.trim()
  if (!normalizedValue) {
    throw new Error(
      'Athena API key is required. Pass createClient(url, key) with a real API key, or set key in the config object.',
    )
  }

  return normalizedValue
}

function hasHeaderIgnoreCase(headers: Record<string, string>, targetKey: string): boolean {
  const normalizedTargetKey = targetKey.toLowerCase()
  return Object.keys(headers).some(key => key.toLowerCase() === normalizedTargetKey)
}

function mergeClientHeaders(
  current: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!current && !next) {
    return undefined
  }
  return {
    ...(current ?? {}),
    ...(next ?? {}),
  }
}

function mergeDefinedObject<T extends object>(
  current: T | undefined,
  next: Partial<T> | undefined,
): T | undefined {
  if (!current && !next) {
    return undefined
  }

  const merged = {
    ...(current ?? {}),
  } as T
  const mutableMerged = merged as Record<string, unknown>
  for (const [key, value] of Object.entries(next ?? {})) {
    if (value !== undefined) {
      mutableMerged[key] = value
    }
  }
  return merged
}

function mergeAuthClientOptions(
  current: AthenaCreateClientAuthOptions | undefined,
  next: AthenaCreateClientAuthOptions | undefined,
): AthenaCreateClientAuthOptions | undefined {
  const merged = mergeDefinedObject(current, next)
  if (!merged) {
    return undefined
  }

  const mergedHeaders = mergeClientHeaders(current?.headers, next?.headers)
  if (mergedHeaders) {
    merged.headers = mergedHeaders
  }
  return merged
}

function mergeServiceUrlOverrides(
  current: AthenaCreateClientServiceUrlConfig | undefined,
  next: AthenaCreateClientServiceUrlConfig | undefined,
): AthenaCreateClientServiceUrlConfig | undefined {
  return mergeDefinedObject(current, next)
}

function toClientContextOverrides(
  context?: AthenaClientContextOptions,
): AthenaClientOverrideOptions | undefined {
  if (!context) {
    return undefined
  }

  return {
    userId: context.userId,
    organizationId: context.organizationId,
    forceNoCache: context.forceNoCache,
    headers: context.headers,
    auth: context.auth
      ? {
          ...context.auth,
          headers: context.auth.headers ? { ...context.auth.headers } : undefined,
        }
      : undefined,
  }
}

function mergeClientOverrideOptions(
  base: AthenaCreateClientConfig,
  overrides?: AthenaClientOverrideOptions,
): AthenaCreateClientConfig {
  if (!overrides) {
    return {
      ...base,
      headers: base.headers ? { ...base.headers } : undefined,
      auth: base.auth
        ? {
            ...base.auth,
            headers: base.auth.headers ? { ...base.auth.headers } : undefined,
          }
        : undefined,
      db: base.db ? { ...base.db } : undefined,
      gateway: base.gateway ? { ...base.gateway } : undefined,
      chat: base.chat ? { ...base.chat } : undefined,
      storage: base.storage ? { ...base.storage } : undefined,
    }
  }

  const merged = mergeDefinedObject(base, overrides) ?? { ...base }
  return {
    ...merged,
    headers: mergeClientHeaders(base.headers, overrides.headers),
    auth: mergeAuthClientOptions(base.auth, overrides.auth),
    db: mergeServiceUrlOverrides(base.db, overrides.db),
    gateway: mergeServiceUrlOverrides(base.gateway, overrides.gateway),
    chat: mergeServiceUrlOverrides(base.chat, overrides.chat) as AthenaCreateClientChatOptions | undefined,
    storage: mergeServiceUrlOverrides(base.storage, overrides.storage),
  }
}

function normalizeAuthClientConfig(
  auth: AthenaCreateClientAuthOptions | undefined,
  defaultBaseUrl?: string,
): AthenaAuthClientConfig | undefined {
  if (!auth && defaultBaseUrl === undefined) {
    return undefined
  }

  const {
    url,
    baseUrl,
    apiKey,
    bearerToken,
    cookie,
    sessionToken,
    ...rest
  } = auth ?? {}
  const normalized: AthenaAuthClientConfig = {
    ...rest,
  }
  const resolvedBaseUrl = resolveClientServiceBaseUrl(
    url ?? baseUrl ?? defaultBaseUrl,
    'Athena auth base URL',
  )

  if (resolvedBaseUrl !== undefined) {
    normalized.baseUrl = resolvedBaseUrl
  }
  if (typeof apiKey === 'string') {
    normalized.apiKey = apiKey
  }
  if (typeof bearerToken === 'string') {
    normalized.bearerToken = bearerToken
  }
  if (typeof cookie === 'string') {
    normalized.cookie = cookie
  }
  if (typeof sessionToken === 'string') {
    normalized.sessionToken = sessionToken
  }

  return normalized
}

function resolveCreateClientConfig(
  config: AthenaCreateClientConfig,
): AthenaClientConfig {
  const resolvedUrls = resolveServiceUrls(config)
  if (!resolvedUrls.dbUrl) {
    throw new Error(
      'Athena DB base URL is required. Pass createClient(url, key) for a unified root, or set db.url / gateway.url / gatewayUrl explicitly.',
    )
  }

  return {
    baseUrl: resolvedUrls.dbUrl,
    apiKey: resolveRequiredClientApiKey(config.key),
    client: resolveOptionalClientName(config.client),
    userId: config.userId,
    organizationId: config.organizationId,
    forceNoCache: config.forceNoCache,
    backend: toBackendConfig(config.backend),
    headers: config.headers,
    auth: config.auth,
    authUrl: resolvedUrls.authUrl,
    chat: config.chat,
    chatUrl: resolvedUrls.chatUrl,
    chatWsUrl: resolvedUrls.chatWsUrl,
    storageUrl: resolvedUrls.storageUrl,
    experimental: config.experimental,
  }
}

function createClientFromInput<TStrict extends boolean = false>(
  sourceConfig: AthenaCreateClientConfig,
): AthenaSdkClientWithAuth<TStrict> {
  return createClientFromConfig(resolveCreateClientConfig(sourceConfig), sourceConfig)
}

function createClientFromConfig<TStrict extends boolean = false>(
  config: AthenaClientConfig,
  sourceConfig: AthenaCreateClientConfig,
): AthenaSdkClientWithAuth<TStrict> {
  const normalizedAuthConfig = normalizeAuthClientConfig(config.auth, config.authUrl)
  const gatewayHeaders: Record<string, string> = {
    ...(config.headers ?? {}),
  }
  if (
    normalizedAuthConfig?.bearerToken &&
    !hasHeaderIgnoreCase(gatewayHeaders, 'X-Athena-Auth-Bearer-Token')
  ) {
    gatewayHeaders['X-Athena-Auth-Bearer-Token'] = normalizedAuthConfig.bearerToken
  }
  if (
    normalizedAuthConfig?.cookie &&
    !hasHeaderIgnoreCase(gatewayHeaders, 'Cookie')
  ) {
    gatewayHeaders.Cookie = normalizedAuthConfig.cookie
  }
  if (
    normalizedAuthConfig?.sessionToken &&
    !hasHeaderIgnoreCase(gatewayHeaders, 'X-Athena-Auth-Session-Token')
  ) {
    gatewayHeaders['X-Athena-Auth-Session-Token'] = normalizedAuthConfig.sessionToken
  }

  const gateway = createAthenaGatewayClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    client: config.client,
    userId: config.userId,
    organizationId: config.organizationId,
    forceNoCache: config.forceNoCache,
    backend: config.backend,
    headers: gatewayHeaders,
  })
  const formatGatewayResult = createResultFormatter(config.experimental)
  const queryTracer = createQueryTracer(config.experimental)
  const auth = createAuthClient({
    ...(normalizedAuthConfig ?? {}),
    ...(config.forceNoCache ? { forceNoCache: true } : {}),
  })
  function from<TModel extends AthenaModelTarget>(
    model: TModel,
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown, TStrict>
  function from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update, unknown, TStrict>
  function from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    tableOrModel: string | AthenaModelTarget<Row, Insert, Update>,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update, unknown, TStrict> {
    if (isAthenaModelTarget(tableOrModel)) {
      if (options?.schema !== undefined) {
        throw new Error(
          'from(model) does not accept a schema override because the model already defines its target.',
        )
      }
      return createTableBuilder<Row, Insert, Update, unknown, TStrict>(
        resolveAthenaModelTargetTableName(tableOrModel),
        gateway,
        formatGatewayResult,
        queryTracer,
        config.experimental,
      )
    }

    const resolvedTableName = resolveTableNameForCall(tableOrModel as string, options?.schema)
    return createTableBuilder<Row, Insert, Update, unknown, TStrict>(
      resolvedTableName,
      gateway,
      formatGatewayResult,
      queryTracer,
      config.experimental,
    )
  }
  const rpc: AthenaSdkClient<TStrict>['rpc'] = <Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ) => {
    const normalizedFn = fn.trim()
    if (!normalizedFn) {
      throw new Error('rpc requires a function name')
    }
    return createRpcBuilder<Row, TStrict>(
      normalizedFn,
      args as AthenaJsonObject | undefined,
      options,
      gateway,
      formatGatewayResult,
      queryTracer,
      captureTraceCallsite(queryTracer),
      Boolean(config.experimental?.debugAst),
    )
  }
  const query = createQueryBuilder(
    gateway,
    formatGatewayResult,
    config.experimental,
    queryTracer,
  ) as AthenaSdkClient<TStrict>['query']
  const db = createDbModule({ from, rpc, query })
  const chat = createChatModule({
    baseUrl: config.chatUrl,
    apiKey: config.apiKey,
    client: config.client,
    headers: config.headers,
    bearerToken: normalizedAuthConfig?.bearerToken,
    cookie: normalizedAuthConfig?.cookie,
    sessionToken: normalizedAuthConfig?.sessionToken,
    forceNoCache: config.forceNoCache,
    wsUrl: config.chatWsUrl,
    webSocketFactory: config.chat?.webSocketFactory ?? undefined,
  })
  const request: AthenaSdkClient<TStrict>['request'] = async <T = unknown>(
    options: AthenaRequestOptions,
  ): Promise<AthenaRequestResponse<T>> => {
    const method = options.method ?? 'GET'
    const responseType = options.responseType ?? 'json'
    const service = options.service ?? 'db'
    const baseUrlByService: Record<AthenaRequestService, string | undefined> = {
      db: config.baseUrl,
      auth: config.authUrl,
      chat: config.chatUrl,
      storage: config.storageUrl,
    }

    const resolvedBaseUrl = options.url ?? baseUrlByService[service]
    if (!resolvedBaseUrl) {
      throw new Error(
        `Athena ${service} base URL is not configured. Pass createClient({ url }) for unified routing or set the service-specific URL first.`,
      )
    }

    const normalizedBaseUrl = normalizeAthenaGatewayBaseUrl(resolvedBaseUrl, {
      label: `Athena ${service} base URL`,
    })
    const normalizedPath = options.url
      ? ''
      : (() => {
          const path = options.path?.trim()
          if (!path) {
            throw new Error('client.request(...) requires either an absolute url or a non-empty path.')
          }
          return path.startsWith('/') ? path : `/${path}`
        })()
    const targetUrl = options.url
      ? `${normalizedBaseUrl}${toRequestQueryString(options.query)}`
      : `${normalizedBaseUrl}${normalizedPath}${toRequestQueryString(options.query)}`

    const headers: Record<string, string> = {
      'X-Athena-Sdk': buildSdkHeaderValue(SDK_NAME),
      ...(config.headers ?? {}),
      ...(options.headers ?? {}),
    }

    if (service !== 'auth') {
      headers.apikey = headers.apikey ?? config.apiKey
      headers['x-api-key'] = headers['x-api-key'] ?? config.apiKey
      if (config.client && !hasHeaderIgnoreCase(headers, 'X-Athena-Client')) {
        headers['X-Athena-Client'] = config.client
      }
      if (config.userId && !hasHeaderIgnoreCase(headers, 'X-User-Id')) {
        headers['X-User-Id'] = config.userId
      }
      if (config.organizationId && !hasHeaderIgnoreCase(headers, 'X-Organization-Id')) {
        headers['X-Organization-Id'] = config.organizationId
      }
      if (normalizedAuthConfig?.sessionToken && !hasHeaderIgnoreCase(headers, 'X-Athena-Auth-Session-Token')) {
        headers['X-Athena-Auth-Session-Token'] = normalizedAuthConfig.sessionToken
      }
      if (normalizedAuthConfig?.bearerToken && !hasHeaderIgnoreCase(headers, 'X-Athena-Auth-Bearer-Token')) {
        headers['X-Athena-Auth-Bearer-Token'] = normalizedAuthConfig.bearerToken
      }
      if (normalizedAuthConfig?.cookie && !hasHeaderIgnoreCase(headers, 'Cookie')) {
        headers.Cookie = normalizedAuthConfig.cookie
      }
    } else {
      const authApiKey = normalizedAuthConfig?.apiKey ?? config.apiKey
      if (authApiKey && !hasHeaderIgnoreCase(headers, 'x-api-key')) {
        headers.apikey = headers.apikey ?? authApiKey
        headers['x-api-key'] = headers['x-api-key'] ?? authApiKey
      }
      if (normalizedAuthConfig?.bearerToken && !hasHeaderIgnoreCase(headers, 'Authorization')) {
        headers.Authorization = `Bearer ${normalizedAuthConfig.bearerToken}`
      }
      if (normalizedAuthConfig?.cookie && !hasHeaderIgnoreCase(headers, 'Cookie')) {
        headers.Cookie = normalizedAuthConfig.cookie
      }
      if (normalizedAuthConfig?.sessionToken && !hasHeaderIgnoreCase(headers, 'X-Athena-Auth-Session-Token')) {
        headers['X-Athena-Auth-Session-Token'] = normalizedAuthConfig.sessionToken
      }
    }

    const shouldSendJsonBody =
      options.body !== undefined &&
      options.body !== null &&
      !(options.body instanceof FormData) &&
      !(options.body instanceof Blob) &&
      !(options.body instanceof URLSearchParams) &&
      !(options.body instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(options.body) &&
      typeof options.body !== 'string'

    if (shouldSendJsonBody && !hasHeaderIgnoreCase(headers, 'Content-Type')) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(targetUrl, {
      method,
      headers,
      body:
        options.body === undefined || options.body === null
          ? undefined
          : shouldSendJsonBody
            ? JSON.stringify(options.body)
            : (options.body as RequestInit['body']),
      signal: options.signal,
      credentials: options.credentials,
    })

    if (responseType === 'response') {
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: null,
        raw: response,
      }
    }

    const rawText = await response.text()
    const parsed =
      responseType === 'text'
        ? rawText
        : parseArbitraryResponseBody(rawText, response.headers.get('content-type'))

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: parsed as T | string | null,
      raw: response,
    }
  }
  const withContext: AthenaSdkClientWithAuth<TStrict>['withContext'] = context =>
    createClientFromInput<TStrict>(
      mergeClientOverrideOptions(sourceConfig, toClientContextOverrides(context)),
    )
  const withSession: AthenaSdkClientWithAuth<TStrict>['withSession'] = (session, options) =>
    createClientFromInput<TStrict>(
      mergeClientOverrideOptions(
        sourceConfig,
        toClientContextOverrides(resolveSessionContextOptions(session, options)),
      ),
    )
  const authWithOptions: AthenaSdkClientWithAuth<TStrict>['withOptions'] = options =>
    createClientFromInput<TStrict>(mergeClientOverrideOptions(sourceConfig, options))

  const sdkClient: AthenaSdkClientWithAuth<TStrict> = {
    from,
    db,
    rpc,
    query,
    request,
    verifyConnection: gateway.verifyConnection,
    auth: auth.auth,
    chat,
    withContext,
    withSession,
    withOptions: authWithOptions,
  }

  if (config.experimental?.athenaStorageBackend) {
    const storageWithContext: AthenaSdkClientWithStorage<TStrict>['withContext'] = context =>
      createClientFromInput<TStrict>(
        mergeClientOverrideOptions(sourceConfig, toClientContextOverrides(context)),
      ) as AthenaSdkClientWithStorage<TStrict>
    const storageWithSession: AthenaSdkClientWithStorage<TStrict>['withSession'] = (session, options) =>
      createClientFromInput<TStrict>(
        mergeClientOverrideOptions(
          sourceConfig,
          toClientContextOverrides(resolveSessionContextOptions(session, options)),
        ),
      ) as AthenaSdkClientWithStorage<TStrict>
    const storageWithOptions: AthenaSdkClientWithStorage<TStrict>['withOptions'] = options =>
      createClientFromInput<TStrict>(
        mergeClientOverrideOptions(sourceConfig, options),
      ) as AthenaSdkClientWithStorage<TStrict>
    const storageClient: AthenaSdkClientWithStorage<TStrict> = {
      ...sdkClient,
      withContext: storageWithContext,
      withSession: storageWithSession,
      withOptions: storageWithOptions,
      storage: createStorageModule(gateway, {
        ...config.experimental.storage,
        ...(config.storageUrl
          ? {
              baseUrl: config.storageUrl,
              stripBasePath: true,
            }
          : {}),
      } as AthenaStorageClientConfig),
    }
    return storageClient
  }

  return sdkClient
}

export interface AthenaClientBuilder<
  StorageEnabled extends boolean = false,
  TStrict extends boolean = false,
> {
  /** Set the public Athena base URL. */
  url(url: string | null | undefined): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Set the API key used for all requests. */
  key(apiKey: string | null | undefined): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Set the default backend routing strategy. */
  backend(backend: BackendConfig | BackendType): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Set the default Athena client routing key. */
  client(clientName: string | null | undefined): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Attach static headers to every request. */
  headers(headers: Record<string, string>): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Configure Athena Auth client behavior for `client.auth.*` methods. */
  auth(config: AthenaCreateClientAuthOptions): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Configure experimental client options and narrow the built client when storage or strict column checks are enabled. */
  experimental(
    options: AthenaClientExperimentalOptions & { athenaStorageBackend: true; typecheckColumns: true },
  ): AthenaClientBuilder<true, true>
  experimental(
    options: AthenaClientExperimentalOptions & { athenaStorageBackend: true },
  ): AthenaClientBuilder<true, TStrict>
  experimental(
    options: AthenaClientExperimentalOptions & { typecheckColumns: true },
  ): AthenaClientBuilder<StorageEnabled, true>
  experimental(options: AthenaClientExperimentalOptions): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Apply createClient options and narrow the built client when storage is enabled. */
  options(options: AthenaCreateClientOptionsWithStorageAndTypecheckedColumns): AthenaClientBuilder<true, true>
  options(options: AthenaCreateClientOptionsWithStorage): AthenaClientBuilder<true, TStrict>
  options(options: AthenaCreateClientOptionsWithTypecheckedColumns): AthenaClientBuilder<StorageEnabled, true>
  options(options: AthenaCreateClientOptions): AthenaClientBuilder<StorageEnabled, TStrict>
  /** Build the immutable Athena SDK client. */
  build(): StorageEnabled extends true ? AthenaSdkClientWithStorage<TStrict> : AthenaSdkClientWithAuth<TStrict>
}

/** Canonical Athena client factory with builder-based configuration. */
export class AthenaClient {
  /** Create a fluent builder for a strongly-typed Athena SDK client. */
  static builder(): AthenaClientBuilder<false, false> {
    return createAthenaClientBuilder(config => createClientFromInput(config))
  }

  /** Build a client from process environment variables. */
  static fromEnvironment(
    options: AthenaClientFromEnvironmentOptionsWithStorageAndTypecheckedColumns,
  ): AthenaSdkClientWithStorage<true>
  static fromEnvironment(
    options: AthenaClientFromEnvironmentOptionsWithStorage,
  ): AthenaSdkClientWithStorage<false>
  static fromEnvironment(
    options: AthenaClientFromEnvironmentOptionsWithTypecheckedColumns,
  ): AthenaSdkClientWithAuth<true>
  static fromEnvironment(
    options?: AthenaClientFromEnvironmentOptions,
  ): AthenaSdkClientWithAuth<false>
  static fromEnvironment(
    options: AthenaClientFromEnvironmentOptions = {},
  ): AthenaSdkClientWithAuth<false> {
    const env = options.env ?? process.env
    const url = options.url ?? readFirstEnvValue(env, ATHENA_ENV_URL_KEYS)
    const gatewayUrl =
      options.gatewayUrl ?? readFirstEnvValue(env, ATHENA_ENV_GATEWAY_URL_KEYS)
    const authUrl =
      options.authUrl ?? readFirstEnvValue(env, ATHENA_ENV_AUTH_URL_KEYS)
    const chatUrl =
      options.chatUrl ?? readFirstEnvValue(env, ATHENA_ENV_CHAT_URL_KEYS)
    const chatWsUrl =
      options.chatWsUrl ?? readFirstEnvValue(env, ATHENA_ENV_CHAT_WS_URL_KEYS)
    const storageUrl =
      options.storageUrl ?? readFirstEnvValue(env, ATHENA_ENV_STORAGE_URL_KEYS)
    const key = options.key ?? readFirstEnvValue(env, ATHENA_ENV_KEY_KEYS)
    const client =
      options.client ?? readFirstEnvValue(env, ATHENA_ENV_CLIENT_KEYS)

    if ((!url && !gatewayUrl) || !key) {
      throw new Error(
        'AthenaClient.fromEnvironment() requires an API key plus a public or gateway URL. Supported aliases include ATHENA_API_KEY, NEXT_PUBLIC_ATHENA_API_KEY, ATHENA_GATEWAY_API_KEY, X_API_KEY, ATHENA_URL, NEXT_PUBLIC_ATHENA_URL, ATHENA_GATEWAY_URL, and ATHENA_DB_URL.',
      )
    }

    const { env: _env, ...clientOptions } = options
    void _env

    return createClient({
      ...clientOptions,
      url,
      gatewayUrl,
      authUrl,
      chatUrl,
      chatWsUrl,
      storageUrl,
      key,
      client,
    })
  }
}

/** Create client (convenience wrapper; use AthenaClient.builder() for full control) */
export function createClient(
  config: AthenaCreateClientConfigWithStorageAndTypecheckedColumns,
): AthenaSdkClientWithStorage<true>
export function createClient(
  config: AthenaCreateClientConfigWithStorage,
): AthenaSdkClientWithStorage<false>
export function createClient(
  config: AthenaCreateClientConfigWithTypecheckedColumns,
): AthenaSdkClientWithAuth<true>
export function createClient(
  config: AthenaCreateClientConfig,
): AthenaSdkClientWithAuth<false>
export function createClient(
  url: string | null | undefined,
  apiKey: string | null | undefined,
  options: AthenaCreateClientOptionsWithStorageAndTypecheckedColumns,
): AthenaSdkClientWithStorage<true>
export function createClient(
  url: string | null | undefined,
  apiKey: string | null | undefined,
  options: AthenaCreateClientOptionsWithStorage,
): AthenaSdkClientWithStorage<false>
export function createClient(
  url: string | null | undefined,
  apiKey: string | null | undefined,
  options: AthenaCreateClientOptionsWithTypecheckedColumns,
): AthenaSdkClientWithAuth<true>
export function createClient(
  url: string | null | undefined,
  apiKey: string | null | undefined,
  options?: AthenaCreateClientOptions,
): AthenaSdkClientWithAuth<false>
export function createClient(
  configOrUrl: AthenaCreateClientConfig | string | null | undefined,
  apiKey?: string | null,
  options?: AthenaCreateClientOptions,
): AthenaSdkClientWithAuth<false> {
  if (typeof configOrUrl === 'string' || configOrUrl === null || configOrUrl === undefined) {
    return createClientFromInput({
      url: configOrUrl,
      key: apiKey ?? '',
      ...options,
    })
  }

  return createClientFromInput(configOrUrl)
}
