import type {
  AthenaConditionArrayValue,
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from './gateway/types.ts'
import { createAthenaGatewayClient } from './gateway/client.ts'

export interface SupabaseResult<T> {
  data: T | null
  error: string | null
  status: number
  raw: unknown
}

type TableBuilderState = {
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
}

type MutationSingleResult<Result> = Result extends Array<infer Item> ? Item | null : Result | null
const DEFAULT_COLUMNS = '*'

export interface MutationQuery<Result> extends PromiseLike<SupabaseResult<Result>> {
  select(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<Result>>
  returning(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<Result>>
  single(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<SupabaseResult<MutationSingleResult<Result>>>
  maybeSingle(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<SupabaseResult<MutationSingleResult<Result>>>
  then<TResult1 = SupabaseResult<Result>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResult<Result>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2>
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<SupabaseResult<Result> | TResult>
  finally(onfinally?: (() => void) | undefined | null): Promise<SupabaseResult<Result>>
}

function formatResult<T>(response: AthenaGatewayResponse<T>): SupabaseResult<T> {
  return {
    data: response.data ?? null,
    error: response.error ?? null,
    status: response.status,
    raw: response.raw,
  }
}

function toSingleResult<Result>(response: SupabaseResult<Result>): SupabaseResult<MutationSingleResult<Result>> {
  const payload = response.data
  const singleData =
    Array.isArray(payload) ? (payload.length ? payload[0] : null) : payload ?? null
  return {
    ...response,
    data: singleData as MutationSingleResult<Result>,
  }
}

function mergeOptions(...options: Array<AthenaGatewayCallOptions | undefined>): AthenaGatewayCallOptions | undefined {
  return options.reduce<AthenaGatewayCallOptions | undefined>((acc, next) => {
    if (!next) return acc
    return { ...acc, ...next }
  }, undefined)
}

function createMutationQuery<Result>(
  executor: (
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ) => Promise<SupabaseResult<Result>>,
  defaultColumns: string | string[] = DEFAULT_COLUMNS,
): MutationQuery<Result> {
  let selectedColumns: string | string[] = defaultColumns
  let selectedOptions: AthenaGatewayCallOptions | undefined
  let promise: Promise<SupabaseResult<Result>> | null = null

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

export interface TableQueryBuilder<Row> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T>>
  insert(values: Row | Row[], options?: AthenaGatewayCallOptions): MutationQuery<Row | Row[]>
  upsert(
    values: Row | Row[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Partial<Row>
      onConflict?: string | string[]
    },
  ): MutationQuery<Row | Row[]>
  update(values: Partial<Row>, options?: AthenaGatewayCallOptions): MutationQuery<Row[]>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>
  eq(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  match(filters: Record<string, AthenaConditionValue>): TableQueryBuilder<Row>
  range(from: number, to: number): TableQueryBuilder<Row>
  limit(count: number): TableQueryBuilder<Row>
  offset(count: number): TableQueryBuilder<Row>
  gt(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  gte(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  lt(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  lte(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  neq(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  like(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  ilike(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  is(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  in(column: string, values: AthenaConditionArrayValue): TableQueryBuilder<Row>
  contains(column: string, values: AthenaConditionArrayValue): TableQueryBuilder<Row>
  containedBy(column: string, values: AthenaConditionArrayValue): TableQueryBuilder<Row>
  not(columnOrExpression: string, operator?: AthenaConditionOperator, value?: AthenaConditionValue): TableQueryBuilder<Row>
  or(expression: string): TableQueryBuilder<Row>
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
  reset(): TableQueryBuilder<Row>
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

function createTableBuilder<Row>(
  tableName: string,
  client: ReturnType<typeof createAthenaGatewayClient>,
): TableQueryBuilder<Row> {
  const state: TableBuilderState = {
    conditions: [],
  }

  const addCondition = (
    operator: AthenaConditionOperator,
    column?: string,
    value?: AthenaConditionValue | AthenaConditionArrayValue | string,
  ) => {
    const condition: AthenaGatewayCondition = { operator }
    if (column) condition.column = column
    if (value !== undefined) condition.value = value
    state.conditions.push(condition)
  }

  const builder: TableQueryBuilder<Row> = {
    reset() {
      state.conditions = []
      state.limit = undefined
      state.offset = undefined
      return builder
    },
    range(from, to) {
      state.offset = from
      state.limit = to - from + 1
      return builder
    },
    limit(count) {
      state.limit = count
      return builder
    },
    offset(count) {
      state.offset = count
      return builder
    },
    match(filters) {
      Object.entries(filters).forEach(([column, value]) => {
        addCondition('eq', column, value)
      })
      return builder
    },
    eq(column, value) {
      addCondition('eq', column, value)
      return builder
    },
    gt(column, value) {
      addCondition('gt', column, value)
      return builder
    },
    gte(column, value) {
      addCondition('gte', column, value)
      return builder
    },
    lt(column, value) {
      addCondition('lt', column, value)
      return builder
    },
    lte(column, value) {
      addCondition('lte', column, value)
      return builder
    },
    neq(column, value) {
      addCondition('neq', column, value)
      return builder
    },
    like(column, value) {
      addCondition('like', column, value)
      return builder
    },
    ilike(column, value) {
      addCondition('ilike', column, value)
      return builder
    },
    is(column, value) {
      addCondition('is', column, value)
      return builder
    },
    in(column, values) {
      addCondition('in', column, values)
      return builder
    },
    contains(column, values) {
      addCondition('contains', column, values)
      return builder
    },
    containedBy(column, values) {
      addCondition('containedBy', column, values)
      return builder
    },
    not(columnOrExpression, operator, value) {
      if (operator && value !== undefined) {
        addCondition('not', undefined, `${columnOrExpression}.${operator}.${stringifyFilterValue(value)}`)
      } else {
        addCondition('not', undefined, columnOrExpression)
      }
      return builder
    },
    or(expression) {
      addCondition('or', undefined, expression)
      return builder
    },
    async select<T = Row>(columns: string | string[] = DEFAULT_COLUMNS, options?: AthenaGatewayCallOptions) {
      const payload = {
        table_name: tableName,
        columns,
        conditions: state.conditions.length ? [...state.conditions] : undefined,
        limit: state.limit,
        offset: state.offset,
        strip_nulls: options?.stripNulls ?? true,
      }
      const response = await client.fetchGateway<T>(payload, options)
      return formatResult(response)
    },
    insert(values, options) {
      const executeInsert = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const payload: AthenaInsertPayload = {
          table_name: tableName,
          insert_body: values as Record<string, unknown> | Record<string, unknown>[],
        }
        if (columns) payload.columns = columns
        if (mergedOptions?.count) payload.count = mergedOptions.count
        if (mergedOptions?.head) payload.head = mergedOptions.head
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull
        }
        const response = await client.insertGateway<Row | Row[]>(payload, mergedOptions)
        return formatResult(response)
      }
      return createMutationQuery<Row | Row[]>(executeInsert)
    },
    upsert(values, options) {
      const executeUpsert = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const payload: AthenaInsertPayload = {
          table_name: tableName,
          insert_body: values as Record<string, unknown> | Record<string, unknown>[],
          update_body: options?.updateBody ? (options.updateBody as Record<string, unknown>) : undefined,
        }
        if (columns) payload.columns = columns
        if (options?.onConflict) payload.on_conflict = options.onConflict
        if (mergedOptions?.count) payload.count = mergedOptions.count
        if (mergedOptions?.head) payload.head = mergedOptions.head
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull
        }
        const response = await client.insertGateway<Row | Row[]>(payload, mergedOptions)
        return formatResult(response)
      }
      return createMutationQuery<Row | Row[]>(executeUpsert)
    },
    update(values, options) {
      const filters = state.conditions.length ? [...state.conditions] : undefined
      const executeUpdate = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const payload: AthenaUpdatePayload = {
          table_name: tableName,
          update_body: values,
          conditions: filters,
          columns,
          strip_nulls: mergedOptions?.stripNulls ?? true,
        }
        const response = await client.updateGateway<Row[]>(payload, mergedOptions)
        return formatResult(response)
      }
      return createMutationQuery<Row[]>(executeUpdate)
    },
    delete(options) {
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
        const payload: AthenaDeletePayload = {
          table_name: tableName,
          resource_id: resourceId,
          conditions: filters,
          columns,
        }
        const response = await client.deleteGateway<Row | null>(payload, mergedOptions)
        return formatResult(response)
      }
      return createMutationQuery<Row | null>(executeDelete)
    },
    async single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      const response = await builder.select<T[]>(columns, options)
      return toSingleResult(response)
    },
    async maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      return builder.single<T>(columns, options)
    },
  }

  return builder
}

export interface SupabaseClient {
  from<Row = unknown>(table: string): TableQueryBuilder<Row>
}

export function createClient(
  url: string,
  apiKey: string,
  options?: AthenaGatewayCallOptions,
): SupabaseClient {
  const { baseUrl: optBaseUrl, apiKey: optApiKey, ...restOptions } = options ?? {}
  const client = createAthenaGatewayClient({
    baseUrl: optBaseUrl ?? url,
    apiKey: optApiKey ?? apiKey,
    ...restOptions,
  })

  return {
    from<Row = unknown>(table: string) {
      return createTableBuilder<Row>(table, client)
    },
  }
}
