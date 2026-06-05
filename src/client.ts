import type {
  AthenaConditionArrayValue,
  AthenaConditionCastType,
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
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
import { quoteQualifiedIdentifier, quoteSelectColumnToken, quoteSelectColumnsExpression } from './sql-identifiers.ts'
import { createAuthClient } from './auth/client.ts'
import type { AthenaAuthBindings, AthenaAuthClientConfig } from './auth/types.ts'
import { normalizeAthenaError } from './auxiliaries.ts'
import type { AthenaOperationContext, NormalizedAthenaError } from './auxiliaries.ts'
import { createDbModule } from './db/module.ts'
import type { AthenaDbModule } from './db/module.ts'
import {
  compileOrderBy,
  compileSelectShape,
  compileWhere,
  shouldUseUuidTextComparison,
} from './query-ast.ts'
import type {
  AthenaFindManyOptions,
  AthenaFindManyResult,
  AthenaOrderBy,
  AthenaSelectShape,
  AthenaWhere,
} from './query-ast.ts'

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

export interface AthenaClientExperimentalOptions {
  /**
   * @deprecated Failed `AthenaResult` values now include normalized structured `error`
   * envelopes by default. This flag is retained as a no-op compatibility switch.
   */
  enableErrorNormalization?: boolean
  /**
   * Emit execution diagnostics for every query/mutation/RPC invocation.
   * Includes payload, synthesized SQL, full outcome, and best-effort callsite metadata.
   */
  traceQueries?: boolean | AthenaQueryTraceOptions
  /**
   * Send the original `findMany(...)` AST body for clean object-select reads.
   * This requires gateway support and falls back to legacy compiled transport
   * when a chain carries filter/pagination state that the AST payload cannot
   * represent losslessly yet.
   */
  findManyAst?: boolean
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
type AthenaRowShape = Record<string, AthenaJsonValue | undefined>
type FilterColumnKey<Row> = Extract<keyof NonNullable<Row>, string>
type ResolvedFilterColumnKey<Row> = [FilterColumnKey<Row>] extends [never] ? string : FilterColumnKey<Row>
type AthenaFindManyAstPayload<
  Row,
  TSelect extends AthenaSelectShape,
> = {
  table_name: string
  select: TSelect
  where?: AthenaWhere<Row>
  orderBy?: AthenaOrderBy<Row>
  limit?: number
}
const DEFAULT_COLUMNS = '*'
const SAFE_CAST_PATTERN = /^[a-z_][a-z0-9_]*(?:\[\])?$/i
const ATHENA_NORMALIZED_ERROR_KEY = '__athenaNormalizedError' as const
const QUERY_TRACE_STACK_SKIP_PATTERNS = [
  'src\\client.ts',
  'src/client.ts',
  'dist\\client.',
  'dist/client.',
  'node_modules\\@xylex-group\\athena',
  'node_modules/@xylex-group/athena',
  'node:internal',
  'internal/process',
] as const

type AthenaTraceOperation = AthenaQueryTraceEvent['operation']
type AthenaTraceEndpoint = AthenaQueryTraceEvent['endpoint']

function canUseFindManyAstTransport(state: TableBuilderState): boolean {
  return (
    state.conditions.length === 0 &&
    state.offset === undefined &&
    state.currentPage === undefined &&
    state.pageSize === undefined &&
    state.totalPages === undefined
  )
}

function toFindManyAstOrder<Row>(order?: AthenaSortBy): AthenaOrderBy<Row> | undefined {
  if (!order) {
    return undefined
  }
  return {
    column: order.field as ResolvedFilterColumnKey<Row>,
    ascending: order.direction !== 'descending',
  }
}

interface AthenaTraceContext {
  operation: AthenaTraceOperation
  endpoint: AthenaTraceEndpoint
  table?: string
  functionName?: string
  sql: string
  payload: unknown
  options?: AthenaGatewayCallOptions | AthenaRpcCallOptions
}

type AthenaQueryTracer = {
  captureCallsite: () => AthenaQueryTraceCallsite | null
  publishSuccess: <T>(
    context: AthenaTraceContext,
    result: AthenaResult<T>,
    durationMs: number,
    callsite: AthenaQueryTraceCallsite | null,
  ) => void
  publishFailure: (
    context: AthenaTraceContext,
    error: unknown,
    durationMs: number,
    callsite: AthenaQueryTraceCallsite | null,
  ) => void
}

type AthenaTraceCallsiteStore = {
  resolve: (callsite?: AthenaQueryTraceCallsite | null) => AthenaQueryTraceCallsite | null
}

export interface MutationQuery<Result> extends PromiseLike<AthenaResult<Result>> {
  select(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>
  returning(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>
  single(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<MutationSingleResult<Result>>>
  maybeSingle(
    columns?: string | string[],
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

function parseQueryTraceCallsiteFrame(frame: string): AthenaQueryTraceCallsite | null {
  const trimmed = frame.trim()
  if (!trimmed) {
    return null
  }

  let body = trimmed.replace(/^at\s+/, '')
  if (body.startsWith('async ')) {
    body = body.slice(6)
  }

  let functionName: string | undefined
  let location = body
  const wrappedMatch = body.match(/^(.*?)\s+\((.*)\)$/)
  if (wrappedMatch) {
    functionName = wrappedMatch[1].trim() || undefined
    location = wrappedMatch[2].trim()
  }

  const locationMatch = location.match(/^(.*):(\d+):(\d+)$/)
  if (!locationMatch) {
    return null
  }

  const filePath = locationMatch[1].replace(/^file:\/\//, '')
  const line = Number(locationMatch[2])
  const column = Number(locationMatch[3])
  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    return null
  }

  const normalizedPath = filePath.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').at(-1) ?? filePath
  return {
    filePath,
    fileName,
    line,
    column,
    frame: trimmed,
    functionName,
  }
}

function captureQueryTraceCallsite(): AthenaQueryTraceCallsite | null {
  const stack = new Error().stack
  if (!stack) return null
  const frames = stack
    .split('\n')
    .slice(2)
    .map(frame => frame.trim())
    .filter(Boolean)

  for (const frame of frames) {
    if (QUERY_TRACE_STACK_SKIP_PATTERNS.some(pattern => frame.includes(pattern))) {
      continue
    }
    const callsite = parseQueryTraceCallsiteFrame(frame)
    if (callsite) return callsite
  }

  const fallback = frames.find(frame => !frame.includes('captureQueryTraceCallsite'))
  return fallback ? parseQueryTraceCallsiteFrame(fallback) : null
}

function defaultQueryTraceLogger(event: AthenaQueryTraceEvent): void {
  const target = event.table ?? event.functionName ?? 'gateway'
  const outcomeState = event.outcome?.error ? 'error' : 'ok'
  const banner = `[athena-js][trace] ${event.operation.toUpperCase()} ${event.endpoint} ${target} ${event.durationMs}ms ${outcomeState}`
  console.info(banner, event)
}

function captureTraceCallsite(tracer?: AthenaQueryTracer): AthenaQueryTraceCallsite | null {
  return tracer?.captureCallsite() ?? null
}

function createTraceCallsiteStore(
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
): AthenaTraceCallsiteStore {
  let storedCallsite = initialCallsite ?? undefined

  return {
    resolve(callsite) {
      if (callsite) {
        storedCallsite = callsite
        return callsite
      }
      if (storedCallsite !== undefined) {
        return storedCallsite
      }
      const capturedCallsite = captureTraceCallsite(tracer)
      if (capturedCallsite) {
        storedCallsite = capturedCallsite
      }
      return capturedCallsite
    },
  }
}

function createQueryTracer(experimental?: AthenaClientExperimentalOptions): AthenaQueryTracer | undefined {
  const traceOption = experimental?.traceQueries
  if (!traceOption) {
    return undefined
  }

  const logger =
    typeof traceOption === 'object' && traceOption.logger ? traceOption.logger : defaultQueryTraceLogger

  const emit = (event: AthenaQueryTraceEvent) => {
    try {
      logger(event)
    } catch (error) {
      console.warn('[athena-js][trace] logger failed', error)
    }
  }

  return {
    captureCallsite: captureQueryTraceCallsite,
    publishSuccess<T>(
      context: AthenaTraceContext,
      result: AthenaResult<T>,
      durationMs: number,
      callsite: AthenaQueryTraceCallsite | null,
    ) {
      emit({
        timestamp: new Date().toISOString(),
        durationMs,
        operation: context.operation,
        endpoint: context.endpoint,
        table: context.table,
        functionName: context.functionName,
        sql: context.sql,
        payload: context.payload,
        options: context.options,
        callsite,
        outcome: {
          status: result.status,
          error: result.error,
          errorDetails: result.errorDetails ?? null,
          count: result.count ?? null,
          data: result.data,
          raw: result.raw,
        },
      })
    },
    publishFailure(
      context: AthenaTraceContext,
      error: unknown,
      durationMs: number,
      callsite: AthenaQueryTraceCallsite | null,
    ) {
      emit({
        timestamp: new Date().toISOString(),
        durationMs,
        operation: context.operation,
        endpoint: context.endpoint,
        table: context.table,
        functionName: context.functionName,
        sql: context.sql,
        payload: context.payload,
        options: context.options,
        callsite,
        thrownError: error,
      })
    },
  }
}

async function executeWithQueryTrace<T>(
  tracer: AthenaQueryTracer | undefined,
  context: AthenaTraceContext,
  runner: () => Promise<AthenaResult<T>>,
  callsiteOverride?: AthenaQueryTraceCallsite | null,
): Promise<AthenaResult<T>> {
  if (!tracer) {
    return runner()
  }

  const callsite = callsiteOverride ?? tracer.captureCallsite()
  const startedAt = Date.now()
  try {
    const result = await runner()
    tracer.publishSuccess(context, result, Date.now() - startedAt, callsite)
    return result
  } catch (error) {
    tracer.publishFailure(context, error, Date.now() - startedAt, callsite)
    throw error
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

function mergeOptions<T extends object>(...options: Array<T | undefined>): T | undefined {
  return options.reduce<T | undefined>((acc, next) => {
    if (!next) return acc
    return { ...acc, ...next }
  }, undefined)
}

function asAthenaJsonObject(value: unknown): AthenaJsonObject {
  return value as unknown as AthenaJsonObject
}

function asAthenaJsonObjectArray(values: unknown[]): AthenaJsonObject[] {
  return values as unknown as AthenaJsonObject[]
}

function createMutationQuery<Result>(
  executor: (
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ) => Promise<AthenaResult<Result>>,
  defaultColumns: string | string[] | null = DEFAULT_COLUMNS,
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
): MutationQuery<Result> {
  let selectedColumns: string | string[] | undefined = defaultColumns === null ? undefined : defaultColumns
  let selectedOptions: AthenaGatewayCallOptions | undefined
  let promise: Promise<AthenaResult<Result>> | null = null
  const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite)

  const run = (
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ) => {
    const payloadColumns = columns ?? selectedColumns
    const payloadOptions = options ?? selectedOptions
    if (!promise) {
      promise = executor(payloadColumns, payloadOptions, callsiteStore.resolve(callsite))
    }
    return promise
  }

  const mutationQuery: MutationQuery<Result> = {
    select(columns = selectedColumns, options) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options, captureTraceCallsite(tracer))
    },
    returning(columns = selectedColumns, options) {
      return mutationQuery.select(columns, options)
    },
    single(columns = selectedColumns, options) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options, captureTraceCallsite(tracer)).then(toSingleResult)
    },
    maybeSingle(columns = selectedColumns, options) {
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
export interface SelectChain<Row, SelectedRow = Row>
  extends FilterChain<SelectChain<Row, SelectedRow>, Row>, PromiseLike<AthenaResult<SelectedRow[]>> {
  single<T = SelectedRow>(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
  maybeSingle<T = SelectedRow>(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
}

/** Chain returned by update() - supports filters before execution, plus select/returning */
export interface UpdateChain<Row>
  extends FilterChain<UpdateChain<Row>, Row>, MutationQuery<Row[]> {}

interface RpcFilterChain<Self> {
  eq(column: string, value: AthenaConditionValue): Self
  neq(column: string, value: AthenaConditionValue): Self
  gt(column: string, value: AthenaConditionValue): Self
  gte(column: string, value: AthenaConditionValue): Self
  lt(column: string, value: AthenaConditionValue): Self
  lte(column: string, value: AthenaConditionValue): Self
  like(column: string, value: AthenaConditionValue): Self
  ilike(column: string, value: AthenaConditionValue): Self
  is(column: string, value: AthenaConditionValue): Self
  in(column: string, values: AthenaConditionArrayValue): Self
}

export interface RpcOrderOptions {
  ascending?: boolean
}

export interface RpcQueryBuilder<Row>
  extends RpcFilterChain<RpcQueryBuilder<Row>>, PromiseLike<AthenaResult<Row[]>> {
  select(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<Row[]>>
  single<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(
    columns?: string | string[],
    options?: AthenaRpcCallOptions,
  ): Promise<AthenaResult<T | null>>
  order(column: string, options?: RpcOrderOptions): RpcQueryBuilder<Row>
  limit(count: number): RpcQueryBuilder<Row>
  offset(count: number): RpcQueryBuilder<Row>
  range(from: number, to: number): RpcQueryBuilder<Row>
}

export interface TableQueryBuilder<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  TContext = unknown,
> extends FilterChain<TableQueryBuilder<Row, Insert, Update, TContext>, Row> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<Row, T>
  findMany<const TSelect extends AthenaSelectShape>(
    options: AthenaFindManyOptions<Row, TSelect>,
  ): Promise<AthenaResult<Array<AthenaFindManyResult<Row, TSelect, TContext>>>>
  insert(values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row>
  insert(values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[]>
  upsert(
    values: Insert,
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update
      onConflict?: string | string[]
    },
  ): MutationQuery<Row>
  upsert(
    values: Insert[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update
      onConflict?: string | string[]
    },
  ): MutationQuery<Row[]>
  update(values: Update, options?: AthenaGatewayCallOptions): UpdateChain<Row>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  reset(): TableQueryBuilder<Row, Insert, Update, TContext>
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

function resolvePagination(input: {
  limit?: number
  offset?: number
  currentPage?: number
  pageSize?: number
}) {
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
  return { limit, offset }
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

function toRpcSelect(columns?: string | string[]) {
  if (!columns) return undefined
  return Array.isArray(columns) ? columns.join(',') : columns
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

function createRpcBuilder<Row>(
  functionName: string,
  args: AthenaJsonObject | undefined,
  baseOptions: AthenaRpcCallOptions | undefined,
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
): RpcQueryBuilder<Row> {
  const state: {
    filters: AthenaRpcFilter[]
    limit?: number
    offset?: number
    order?: { column: string; ascending?: boolean }
  } = {
    filters: [],
  }

  let selectedColumns: string | string[] | undefined
  let selectedOptions: AthenaRpcCallOptions | undefined
  let promise: Promise<AthenaResult<Row[]>> | null = null
  const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite)

  const executeRpc = async <SelectedRow = Row>(
    columns?: string | string[],
    options?: AthenaRpcCallOptions,
    callsite?: AthenaQueryTraceCallsite | null,
  ): Promise<AthenaResult<SelectedRow[]>> => {
    const mergedOptions = mergeOptions(baseOptions, options)
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
    const endpoint: AthenaTraceEndpoint = mergedOptions?.get ? `/rpc/${functionName}` : '/gateway/rpc'
    const sql = buildRpcDebugSql(payload)
    return executeWithQueryTrace(
      tracer,
      {
        operation: 'rpc',
        endpoint,
        functionName,
        sql,
        payload,
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
    columns?: string | string[],
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

  const builder = {} as RpcQueryBuilder<Row>
  const filterMethods = createRpcFilterMethods(state.filters, builder)

  Object.assign(builder, filterMethods, {
    select(columns = selectedColumns, options?: AthenaRpcCallOptions) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options, captureTraceCallsite(tracer))
    },
    async single<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions) {
      const result = await run(columns, options, captureTraceCallsite(tracer))
      return toSingleResult(result) as AthenaResult<T | null>
    },
    maybeSingle<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions) {
      return builder.single<T>(columns, options)
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
>(
  tableName: string,
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
  tracer?: AthenaQueryTracer,
  experimental?: AthenaClientExperimentalOptions,
): TableQueryBuilder<Row, Insert, Update, TContext> {
  const state: TableBuilderState = {
    conditions: [],
  }

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

  const builder = {} as TableQueryBuilder<Row, Insert, Update, TContext>

  const filterMethods = createFilterMethods<TableQueryBuilder<Row, Insert, Update, TContext>, Row>(
    state,
    addCondition,
    builder,
  )

  const runSelect = async <T = Row>(
    columns: string | string[] = DEFAULT_COLUMNS,
    options?: AthenaGatewayCallOptions,
    executionState: TableBuilderState = snapshotState(),
    callsite?: AthenaQueryTraceCallsite | null,
  ) => {
    const resolvedTableName = resolveTableNameForCall(tableName, options?.schema)
    const conditions = executionState.conditions.length
      ? executionState.conditions.map(condition => ({ ...condition }))
      : undefined
    const hasTypedEqualityComparison =
      conditions?.some(
        condition =>
          condition.operator === 'eq' &&
          (condition.value_cast !== undefined || condition.column_cast !== undefined),
      ) ?? false

    if (hasTypedEqualityComparison && !options?.head && !options?.count && conditions) {
      const query = buildTypedSelectQuery({
        tableName: resolvedTableName,
        columns,
        conditions,
        limit: executionState.limit,
        offset: executionState.offset,
        currentPage: executionState.currentPage,
        pageSize: executionState.pageSize,
        order: executionState.order,
      })
      if (query) {
        const payload = { query }
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'select',
            endpoint: '/gateway/query',
            table: resolvedTableName,
            sql: query,
            payload,
            options,
          },
          async () => {
            const queryResponse = await client.queryGateway<T>(payload, options)
            return formatGatewayResult(queryResponse, { table: resolvedTableName, operation: 'select' })
          },
          callsite,
        )
      }
    }

    const payload = {
      table_name: resolvedTableName,
      columns,
      conditions,
      limit: executionState.limit,
      offset: executionState.offset,
      current_page: executionState.currentPage,
      page_size: executionState.pageSize,
      total_pages: executionState.totalPages,
      sort_by: executionState.order,
      strip_nulls: options?.stripNulls ?? true,
      count: options?.count,
      head: options?.head,
    }
    const sql = buildDebugSelectQuery({
      tableName: resolvedTableName,
      columns,
      conditions,
      limit: executionState.limit,
      offset: executionState.offset,
      currentPage: executionState.currentPage,
      pageSize: executionState.pageSize,
      order: executionState.order,
    })
    return executeWithQueryTrace(
      tracer,
      {
        operation: 'select',
        endpoint: '/gateway/fetch',
        table: resolvedTableName,
        sql,
        payload,
        options,
      },
      async () => {
        const response = await client.fetchGateway<T>(payload, options)
        return formatGatewayResult(response, { table: resolvedTableName, operation: 'select' })
      },
      callsite,
    )
  }

  const createSelectChain = <SelectedRow>(
    columns: string | string[],
    options?: AthenaGatewayCallOptions,
    initialCallsite?: AthenaQueryTraceCallsite | null,
  ): SelectChain<Row, SelectedRow> => {
    const chain = {} as SelectChain<Row, SelectedRow>
    const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite)
    const filterMethods = createFilterMethods<SelectChain<Row, SelectedRow>, Row>(state, addCondition, chain)
    Object.assign(chain, filterMethods, {
      async single<T = SelectedRow>(cols?: string | string[], opts?: AthenaGatewayCallOptions) {
        const r = await runSelect<T[]>(
          cols ?? columns,
          opts ?? options,
          snapshotState(),
          callsiteStore.resolve(captureTraceCallsite(tracer)),
        )
        return toSingleResult(r)
      },
      maybeSingle<T = SelectedRow>(cols?: string | string[], opts?: AthenaGatewayCallOptions) {
        return chain.single<T>(cols, opts)
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
    select<T = Row>(columns: string | string[] = DEFAULT_COLUMNS, options?: AthenaGatewayCallOptions) {
      return createSelectChain<T>(columns, options, captureTraceCallsite(tracer))
    },
    async findMany<const TSelect extends AthenaSelectShape>(options: AthenaFindManyOptions<Row, TSelect>) {
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
      if (experimental?.findManyAst && canUseFindManyAstTransport(baseState)) {
        const resolvedTableName = resolveTableNameForCall(tableName, undefined)
        const payload: AthenaFindManyAstPayload<Row, TSelect> = {
          table_name: resolvedTableName,
          select: options.select,
        }
        if (options.where !== undefined) {
          payload.where = options.where
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
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'select',
            endpoint: '/gateway/fetch',
            table: resolvedTableName,
            sql,
            payload,
          },
          async () => {
            const response = await client.fetchGateway<Array<AthenaFindManyResult<Row, TSelect, TContext>>>(
              payload,
            )
            return formatGatewayResult(response, { table: resolvedTableName, operation: 'select' })
          },
          callsite,
        )
      }
      return runSelect<Array<AthenaFindManyResult<Row, TSelect, TContext>>>(
        columns,
        undefined,
        executionState,
        callsite,
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
          return executeWithQueryTrace(
            tracer,
            {
              operation: 'insert',
              endpoint: '/gateway/insert',
              table: resolvedTableName,
              sql,
              payload,
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
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'insert',
            endpoint: '/gateway/insert',
            table: resolvedTableName,
            sql,
            payload,
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
          return executeWithQueryTrace(
            tracer,
            {
              operation: 'upsert',
              endpoint: '/gateway/insert',
              table: resolvedTableName,
              sql,
              payload,
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
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'upsert',
            endpoint: '/gateway/insert',
            table: resolvedTableName,
            sql,
            payload,
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
        const filters = state.conditions.length ? [...state.conditions] : undefined
        const mergedOptions = mergeOptions(options, selectOptions)
        const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
        const payload: AthenaUpdatePayload = {
          table_name: resolvedTableName,
          set: asAthenaJsonObject(values),
          conditions: filters,
          strip_nulls: mergedOptions?.stripNulls ?? true,
        }
        if (state.order) payload.sort_by = state.order
        if (state.currentPage !== undefined) payload.current_page = state.currentPage
        if (state.pageSize !== undefined) payload.page_size = state.pageSize
        if (state.totalPages !== undefined) payload.total_pages = state.totalPages
        if (columns) payload.columns = columns
        const sql = buildUpdateDebugSql(payload)
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'update',
            endpoint: '/gateway/update',
            table: resolvedTableName,
            sql,
            payload,
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
        const mergedOptions = mergeOptions(options, selectOptions)
        const resolvedTableName = resolveTableNameForCall(tableName, mergedOptions?.schema)
        const payload: AthenaDeletePayload = {
          table_name: resolvedTableName,
          resource_id: resourceId,
          conditions: filters,
        }
        if (state.order) payload.sort_by = state.order
        if (state.currentPage !== undefined) payload.current_page = state.currentPage
        if (state.pageSize !== undefined) payload.page_size = state.pageSize
        if (state.totalPages !== undefined) payload.total_pages = state.totalPages
        if (columns) payload.columns = columns
        const sql = buildDeleteDebugSql(payload)
        return executeWithQueryTrace(
          tracer,
          {
            operation: 'delete',
            endpoint: '/gateway/delete',
            table: resolvedTableName,
            sql,
            payload,
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
    async single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      const response = await runSelect<T[]>(
        columns ?? DEFAULT_COLUMNS,
        options,
        snapshotState(),
        captureTraceCallsite(tracer),
      )
      return toSingleResult(response)
    },
    async maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      return builder.single<T>(columns, options)
    },
  })

  return builder
}

function createQueryBuilder(
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
  tracer?: AthenaQueryTracer,
) {
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
    return executeWithQueryTrace(
      tracer,
      {
        operation: 'query',
        endpoint: '/gateway/query',
        sql: normalizedQuery,
        payload,
        options,
      },
      async () => {
        const response = await client.queryGateway<Row[]>(payload, options)
        return formatGatewayResult(response, { operation: 'query' })
      },
      callsite,
    )
  }
}

export interface AthenaSdkClient {
  from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string): TableQueryBuilder<Row, Insert, Update>
  db: AthenaDbModule
  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>
  query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions): Promise<AthenaResult<Row[]>>
}

export interface AthenaSdkClientWithAuth extends AthenaSdkClient {
  auth: AthenaAuthBindings
}

/** Client config for builder */
export interface AthenaClientConfig {
  baseUrl: string
  apiKey: string
  client?: string
  backend?: BackendConfig
  headers?: Record<string, string>
  healthTracking?: boolean
  auth?: AthenaAuthClientConfig
  experimental?: AthenaClientExperimentalOptions
}

function createClientFromConfig(config: AthenaClientConfig): AthenaSdkClientWithAuth {
  const gateway = createAthenaGatewayClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    client: config.client,
    backend: config.backend,
    headers: config.headers,
  })
  const formatGatewayResult = createResultFormatter(config.experimental)
  const queryTracer = createQueryTracer(config.experimental)
  const auth = createAuthClient(config.auth)
  const from: AthenaSdkClient['from'] = <
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string) =>
    createTableBuilder<Row, Insert, Update>(table, gateway, formatGatewayResult, queryTracer, config.experimental)
  const rpc: AthenaSdkClient['rpc'] = <Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ) => {
    const normalizedFn = fn.trim()
    if (!normalizedFn) {
      throw new Error('rpc requires a function name')
    }
    return createRpcBuilder<Row>(
      normalizedFn,
      args as AthenaJsonObject | undefined,
      options,
      gateway,
      formatGatewayResult,
      queryTracer,
      captureTraceCallsite(queryTracer),
    )
  }
  const query = createQueryBuilder(gateway, formatGatewayResult, queryTracer) as AthenaSdkClient['query']
  const db = createDbModule({ from, rpc, query })

  return {
    from,
    db,
    rpc,
    query,
    auth: auth.auth,
  }
}

export interface AthenaClientBuilder {
  /** Set the gateway base URL. */
  url(url: string): AthenaClientBuilder
  /** Set the API key used for all requests. */
  key(apiKey: string): AthenaClientBuilder
  /** Set the default backend routing strategy. */
  backend(backend: BackendConfig | BackendType): AthenaClientBuilder
  /** Set the default Athena client routing key. */
  client(clientName: string): AthenaClientBuilder
  /** Attach static headers to every request. */
  headers(headers: Record<string, string>): AthenaClientBuilder
  /** Configure Athena Auth client behavior for `client.auth.*` methods. */
  auth(config: AthenaAuthClientConfig): AthenaClientBuilder
  /** Configure experimental client options (for example query tracing or findMany AST transport). */
  experimental(options: AthenaClientExperimentalOptions): AthenaClientBuilder
  /** Apply the same options object accepted by `createClient(url, key, options)`. */
  options(options: AthenaCreateClientOptions): AthenaClientBuilder
  /** Enable or disable health tracking metadata. */
  healthTracking(enabled: boolean): AthenaClientBuilder
  /** Build the immutable Athena SDK client. */
  build(): AthenaSdkClientWithAuth
}

const DEFAULT_BACKEND: BackendConfig = { type: 'athena' }

function toBackendConfig(b: BackendConfig | BackendType | undefined): BackendConfig {
  if (!b) return DEFAULT_BACKEND
  return typeof b === 'string' ? { type: b } : b
}

function mergeAuthClientConfig(
  current: AthenaAuthClientConfig | undefined,
  next: AthenaAuthClientConfig,
): AthenaAuthClientConfig {
  const merged: AthenaAuthClientConfig = {
    ...(current ?? {}),
    ...next,
  }
  if (current?.headers || next.headers) {
    merged.headers = {
      ...(current?.headers ?? {}),
      ...(next.headers ?? {}),
    }
  }
  return merged
}

function mergeExperimentalOptions(
  current: AthenaClientExperimentalOptions | undefined,
  next: AthenaClientExperimentalOptions,
): AthenaClientExperimentalOptions {
  const merged: AthenaClientExperimentalOptions = {
    ...(current ?? {}),
    ...next,
  }
  if (
    current?.traceQueries &&
    typeof current.traceQueries === 'object' &&
    next.traceQueries &&
    typeof next.traceQueries === 'object'
  ) {
    merged.traceQueries = {
      ...current.traceQueries,
      ...next.traceQueries,
    }
  }
  return merged
}

class AthenaClientBuilderImpl implements AthenaClientBuilder {
  private baseUrl?: string
  private apiKey?: string
  private backendConfig: BackendConfig = DEFAULT_BACKEND
  private clientName?: string
  private defaultHeaders?: Record<string, string>
  private authConfig?: AthenaAuthClientConfig
  private experimentalOptions?: AthenaClientExperimentalOptions
  private isHealthTrackingEnabled = false

  url(url: string): AthenaClientBuilder {
    this.baseUrl = url
    return this
  }

  key(apiKey: string): AthenaClientBuilder {
    this.apiKey = apiKey
    return this
  }

  backend(backend: BackendConfig | BackendType): AthenaClientBuilder {
    this.backendConfig = toBackendConfig(backend)
    return this
  }

  client(clientName: string): AthenaClientBuilder {
    this.clientName = clientName
    return this
  }

  headers(headers: Record<string, string>): AthenaClientBuilder {
    this.defaultHeaders = headers
    return this
  }

  auth(config: AthenaAuthClientConfig): AthenaClientBuilder {
    this.authConfig = mergeAuthClientConfig(this.authConfig, config)
    return this
  }

  experimental(options: AthenaClientExperimentalOptions): AthenaClientBuilder {
    this.experimentalOptions = mergeExperimentalOptions(this.experimentalOptions, options)
    return this
  }

  options(options: AthenaCreateClientOptions): AthenaClientBuilder {
    if (options.client !== undefined) {
      this.clientName = options.client
    }
    if (options.backend !== undefined) {
      this.backendConfig = toBackendConfig(options.backend)
    }
    if (options.headers !== undefined) {
      this.defaultHeaders = {
        ...(this.defaultHeaders ?? {}),
        ...options.headers,
      }
    }
    if (options.auth !== undefined) {
      this.authConfig = mergeAuthClientConfig(this.authConfig, options.auth)
    }
    if (options.experimental !== undefined) {
      this.experimentalOptions = mergeExperimentalOptions(this.experimentalOptions, options.experimental)
    }
    return this
  }

  healthTracking(enabled: boolean): AthenaClientBuilder {
    this.isHealthTrackingEnabled = enabled
    return this
  }

  build(): AthenaSdkClientWithAuth {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('AthenaClient requires url and key; call .url() and .key() before .build()')
    }

    return createClientFromConfig({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      client: this.clientName,
      backend: this.backendConfig,
      headers: this.defaultHeaders,
      healthTracking: this.isHealthTrackingEnabled,
      auth: this.authConfig,
      experimental: this.experimentalOptions,
    })
  }
}

/** Canonical Athena client factory with builder-based configuration. */
export class AthenaClient {
  /** Create a fluent builder for a strongly-typed Athena SDK client. */
  static builder(): AthenaClientBuilder {
    return new AthenaClientBuilderImpl()
  }

  /** Build a client from process environment variables. */
  static fromEnvironment(): AthenaSdkClientWithAuth {
    const url =
      process.env.ATHENA_URL ??
      process.env.ATHENA_GATEWAY_URL
    const key =
      process.env.ATHENA_API_KEY ??
      process.env.ATHENA_GATEWAY_API_KEY

    if (!url || !key) {
      throw new Error(
        'ATHENA_URL and ATHENA_API_KEY (or ATHENA_GATEWAY_URL and ATHENA_GATEWAY_API_KEY) are required',
      )
    }

    return AthenaClient.builder()
      .url(url)
      .key(key)
      .build()
  }
}

export interface AthenaCreateClientOptions extends Pick<AthenaGatewayCallOptions, 'client' | 'headers' | 'backend'> {
  auth?: AthenaAuthClientConfig
  experimental?: AthenaClientExperimentalOptions
}

/** Create client (convenience wrapper; use AthenaClient.builder() for full control) */
export function createClient(
  url: string,
  apiKey: string,
  options?: AthenaCreateClientOptions,
): AthenaSdkClientWithAuth {
  return createClientFromConfig({
    baseUrl: url,
    apiKey,
    client: options?.client,
    backend: toBackendConfig(options?.backend),
    headers: options?.headers,
    auth: options?.auth,
    experimental: options?.experimental,
  })
}
