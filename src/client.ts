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
import { quoteQualifiedIdentifier, quoteSelectColumnsExpression } from './sql-identifiers.ts'
import { createAuthClient } from './auth/client.ts'
import type { AthenaAuthBindings, AthenaAuthClientConfig } from './auth/types.ts'
import { normalizeAthenaError } from './auxiliaries.ts'
import type { AthenaOperationContext, NormalizedAthenaError } from './auxiliaries.ts'

export interface AthenaResult<T> {
  data: T | null
  error: string | null
  errorDetails?: AthenaGatewayErrorDetails | null
  status: number
  count?: number | null
  raw: unknown
}

export interface AthenaClientExperimentalOptions {
  /**
   * Pre-compute and attach normalized error metadata to failed AthenaResult values.
   * Keeps AthenaResult shape intact and enables context-aware normalizeAthenaError(result) usage.
   */
  enableErrorNormalization?: boolean
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
const DEFAULT_COLUMNS = '*'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_CAST_PATTERN = /^[a-z_][a-z0-9_]*(?:\[\])?$/i
const ATHENA_NORMALIZED_ERROR_KEY = '__athenaNormalizedError' as const

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
    error: response.error ?? null,
    errorDetails: response.errorDetails ?? null,
    status: response.status,
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
  if (!experimental?.enableErrorNormalization) {
    return formatResult
  }

  return <T>(response: AthenaGatewayResponse<T>, context?: AthenaOperationContext): AthenaResult<T> => {
    const result = formatResult(response)
    if (result.error == null) {
      return result
    }
    const normalizedError = normalizeAthenaError(result, context)
    attachNormalizedError(result, normalizedError)
    return result
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
  ) => Promise<AthenaResult<Result>>,
  defaultColumns: string | string[] | null = DEFAULT_COLUMNS,
): MutationQuery<Result> {
  let selectedColumns: string | string[] | undefined = defaultColumns === null ? undefined : defaultColumns
  let selectedOptions: AthenaGatewayCallOptions | undefined
  let promise: Promise<AthenaResult<Result>> | null = null

  const run = (columns?: string | string[], options?: AthenaGatewayCallOptions) => {
    const payloadColumns = columns ?? selectedColumns
    const payloadOptions = options ?? selectedOptions
    if (!promise) {
      promise = executor(payloadColumns, payloadOptions)
    }
    return promise
  }

  const mutationQuery: MutationQuery<Result> = {
    select(columns = selectedColumns, options) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options)
    },
    returning(columns = selectedColumns, options) {
      return mutationQuery.select(columns, options)
    },
    single(columns = selectedColumns, options) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options).then(toSingleResult)
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
> extends FilterChain<TableQueryBuilder<Row, Insert, Update>, Row> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<Row, T>
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
  reset(): TableQueryBuilder<Row, Insert, Update>
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

function isUuidString(value: string): boolean {
  return UUID_PATTERN.test(value.trim())
}

function isUuidIdentifierColumn(column: string): boolean {
  return column === 'id' || /(?:^|_)uuid(?:_|$)/i.test(column) || /_id$/i.test(column)
}

function shouldUseUuidTextComparison(column: string, value: AthenaConditionValue): boolean {
  return typeof value === 'string' && isUuidString(value) && isUuidIdentifierColumn(column)
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
    return columns.map(column => quoteQualifiedIdentifier(column)).join(', ')
  }
  return quoteSelectColumnsExpression(columns)
}

function resolveTableNameForCall(tableName: string, schema: string | undefined): string {
  if (!schema) return tableName
  const normalizedSchema = schema.trim()
  if (!normalizedSchema) {
    throw new Error('schema option must be a non-empty string')
  }
  if (tableName.includes('.')) {
    if (tableName.startsWith(`${normalizedSchema}.`)) {
      return tableName
    }
    throw new Error(
      `schema option "${normalizedSchema}" conflicts with schema-qualified table "${tableName}"`,
    )
  }
  return `${normalizedSchema}.${tableName}`
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

  const executeRpc = async <SelectedRow = Row>(
    columns?: string | string[],
    options?: AthenaRpcCallOptions,
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
    const response = await client.rpcGateway<SelectedRow[]>(payload, mergedOptions)
    return formatGatewayResult(response, { operation: 'rpc' })
  }

  const run = (columns?: string | string[], options?: AthenaRpcCallOptions) => {
    const payloadColumns = columns ?? selectedColumns
    const payloadOptions = options ?? selectedOptions
    if (!promise) {
      promise = executeRpc<Row>(payloadColumns, payloadOptions)
    }
    return promise
  }

  const builder = {} as RpcQueryBuilder<Row>
  const filterMethods = createRpcFilterMethods(state.filters, builder)

  Object.assign(builder, filterMethods, {
    select(columns = selectedColumns, options?: AthenaRpcCallOptions) {
      selectedColumns = columns
      selectedOptions = options ?? selectedOptions
      return run(columns, options)
    },
    async single<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions) {
      const result = await run(columns, options)
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
>(
  tableName: string,
  client: ReturnType<typeof createAthenaGatewayClient>,
  formatGatewayResult: AthenaResultFormatter,
): TableQueryBuilder<Row, Insert, Update> {
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

  const builder = {} as TableQueryBuilder<Row, Insert, Update>

  const filterMethods = createFilterMethods<TableQueryBuilder<Row, Insert, Update>, Row>(
    state,
    addCondition,
    builder,
  )

  const runSelect = async <T = Row>(
    columns: string | string[] = DEFAULT_COLUMNS,
    options?: AthenaGatewayCallOptions,
  ) => {
    const resolvedTableName = resolveTableNameForCall(tableName, options?.schema)
    const conditions = state.conditions.length
      ? state.conditions.map(condition => ({ ...condition }))
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
        limit: state.limit,
        offset: state.offset,
        currentPage: state.currentPage,
        pageSize: state.pageSize,
        order: state.order,
      })
      if (query) {
        const queryResponse = await client.queryGateway<T>({ query }, options)
        return formatGatewayResult(queryResponse, { table: resolvedTableName, operation: 'select' })
      }
    }

    const payload = {
      table_name: resolvedTableName,
      columns,
      conditions,
      limit: state.limit,
      offset: state.offset,
      current_page: state.currentPage,
      page_size: state.pageSize,
      total_pages: state.totalPages,
      sort_by: state.order,
      strip_nulls: options?.stripNulls ?? true,
      count: options?.count,
      head: options?.head,
    }
    const response = await client.fetchGateway<T>(payload, options)
    return formatGatewayResult(response, { table: resolvedTableName, operation: 'select' })
  }

  const createSelectChain = <SelectedRow>(
    columns: string | string[],
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row, SelectedRow> => {
    const chain = {} as SelectChain<Row, SelectedRow>
    const filterMethods = createFilterMethods<SelectChain<Row, SelectedRow>, Row>(state, addCondition, chain)
    Object.assign(chain, filterMethods, {
      async single<T = SelectedRow>(cols?: string | string[], opts?: AthenaGatewayCallOptions) {
        const r = await runSelect<T[]>(cols ?? columns, opts ?? options)
        return toSingleResult(r)
      },
      maybeSingle<T = SelectedRow>(cols?: string | string[], opts?: AthenaGatewayCallOptions) {
        return chain.single<T>(cols, opts)
      },
      then<T1 = AthenaResult<SelectedRow[]>, T2 = never>(
        onfulfilled?: (v: AthenaResult<SelectedRow[]>) => T1 | PromiseLike<T1>,
        onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
      ) {
        return runSelect<SelectedRow[]>(columns, options).then(onfulfilled, onrejected)
      },
      catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
        return runSelect<SelectedRow[]>(columns, options).catch(onrejected)
      },
      finally(onfinally?: () => void) {
        return runSelect<SelectedRow[]>(columns, options).finally(onfinally)
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
      return createSelectChain<T>(columns, options)
    },
    insert(values: Insert | Insert[], options?: AthenaGatewayCallOptions) {
      if (Array.isArray(values)) {
        const executeInsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
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
          const response = await client.insertGateway<Row[]>(payload, mergedOptions)
          return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
        }
        return createMutationQuery<Row[]>(executeInsertMany)
      }
      const executeInsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
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
        const response = await client.insertGateway<Row>(payload, mergedOptions)
        return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
      }
      return createMutationQuery<Row>(executeInsertOne)
    },
    upsert(
      values: Insert | Insert[],
      options?: AthenaGatewayCallOptions & { updateBody?: Update; onConflict?: string | string[] },
    ) {
      if (Array.isArray(values)) {
        const executeUpsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
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
          const response = await client.insertGateway<Row[]>(payload, mergedOptions)
          return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
        }
        return createMutationQuery<Row[]>(executeUpsertMany)
      }
      const executeUpsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
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
        const response = await client.insertGateway<Row>(payload, mergedOptions)
        return formatGatewayResult(response, { table: resolvedTableName, operation: 'insert' })
      }
      return createMutationQuery<Row>(executeUpsertOne)
    },
    update(values: Update, options?: AthenaGatewayCallOptions) {
      const executeUpdate = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
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
        const response = await client.updateGateway<Row[]>(payload, mergedOptions)
        return formatGatewayResult(response, { table: resolvedTableName, operation: 'update' })
      }
      const mutation = createMutationQuery<Row[]>(executeUpdate, null)
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
      const executeDelete = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
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
        const response = await client.deleteGateway<Row | null>(payload, mergedOptions)
        return formatGatewayResult(response, { table: resolvedTableName, operation: 'delete' })
      }
      return createMutationQuery<Row | null>(executeDelete, null)
    },
    async single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      const response = await builder.select<T[]>(columns, options)
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
) {
  return async function query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      throw new Error('query requires a non-empty string')
    }
    const response = await client.queryGateway<Row[]>({ query: normalizedQuery }, options)
    return formatGatewayResult(response, { operation: 'query' })
  }
}

export interface AthenaSdkClient {
  from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string): TableQueryBuilder<Row, Insert, Update>
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
  const auth = createAuthClient(config.auth)
  return {
    from<
      Row = AthenaRowShape,
      Insert = Partial<Row>,
      Update = Partial<Insert>,
    >(table: string) {
      return createTableBuilder<Row, Insert, Update>(table, gateway, formatGatewayResult)
    },
    rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
      fn: string,
      args?: Args,
      options?: AthenaRpcCallOptions,
    ) {
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
      )
    },
    query: createQueryBuilder(gateway, formatGatewayResult) as AthenaSdkClient['query'],
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

class AthenaClientBuilderImpl implements AthenaClientBuilder {
  private baseUrl?: string
  private apiKey?: string
  private backendConfig: BackendConfig = DEFAULT_BACKEND
  private clientName?: string
  private defaultHeaders?: Record<string, string>
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
