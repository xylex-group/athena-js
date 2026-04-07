import type {
  AthenaConditionArrayValue,
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaGatewayErrorDetails,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from './gateway/types.ts'
import type { BackendConfig, BackendType } from './gateway/types.ts'
import { createAthenaGatewayClient } from './gateway/client.ts'

export interface AthenaResult<T> {
  data: T | null
  error: string | null
  errorDetails?: AthenaGatewayErrorDetails | null
  status: number
  count?: number | null
  raw: unknown
}

type TableBuilderState = {
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
}

type MutationSingleResult<Result> = Result extends Array<infer Item> ? Item | null : Result | null
const DEFAULT_COLUMNS = '*'

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

function createMutationQuery<Result>(
  executor: (
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ) => Promise<AthenaResult<Result>>,
  defaultColumns: string | string[] = DEFAULT_COLUMNS,
): MutationQuery<Result> {
  let selectedColumns: string | string[] = defaultColumns
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

/** Shared filter chain - supports eq, limit, etc. in any order relative to select/update */
interface FilterChain<Self> {
  eq(column: string, value: AthenaConditionValue): Self
  match(filters: Record<string, AthenaConditionValue>): Self
  range(from: number, to: number): Self
  limit(count: number): Self
  offset(count: number): Self
  gt(column: string, value: AthenaConditionValue): Self
  gte(column: string, value: AthenaConditionValue): Self
  lt(column: string, value: AthenaConditionValue): Self
  lte(column: string, value: AthenaConditionValue): Self
  neq(column: string, value: AthenaConditionValue): Self
  like(column: string, value: AthenaConditionValue): Self
  ilike(column: string, value: AthenaConditionValue): Self
  is(column: string, value: AthenaConditionValue): Self
  in(column: string, values: AthenaConditionArrayValue): Self
  contains(column: string, values: AthenaConditionArrayValue): Self
  containedBy(column: string, values: AthenaConditionArrayValue): Self
  not(
    columnOrExpression: string,
    operator?: AthenaConditionOperator,
    value?: AthenaConditionValue,
  ): Self
  or(expression: string): Self
}

/** Chain returned by select() - supports filters and single/maybeSingle before execution */
export interface SelectChain<Row> extends FilterChain<SelectChain<Row>>, PromiseLike<AthenaResult<Row[]>> {
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
}

/** Chain returned by update() - supports filters before execution, plus select/returning */
export interface UpdateChain<Row> extends FilterChain<UpdateChain<Row>>, MutationQuery<Row[]> {}

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

export interface TableQueryBuilder<Row> extends FilterChain<TableQueryBuilder<Row>> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<T>
  insert(values: Row, options?: AthenaGatewayCallOptions): MutationQuery<Row>
  insert(values: Row[], options?: AthenaGatewayCallOptions): MutationQuery<Row[]>
  upsert(
    values: Row,
    options?: AthenaGatewayCallOptions & {
      updateBody?: Partial<Row>
      onConflict?: string | string[]
    },
  ): MutationQuery<Row>
  upsert(
    values: Row[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Partial<Row>
      onConflict?: string | string[]
    },
  ): MutationQuery<Row[]>
  update(values: Partial<Row>, options?: AthenaGatewayCallOptions): UpdateChain<Row>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
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

function createFilterMethods<Self>(
  state: TableBuilderState,
  addCondition: (
    operator: AthenaConditionOperator,
    column?: string,
    value?: AthenaConditionValue | AthenaConditionArrayValue | string,
  ) => void,
  self: Self,
) {
  return {
    eq(column: string, value: AthenaConditionValue) {
      addCondition('eq', column, value)
      return self
    },
    match(filters: Record<string, AthenaConditionValue>) {
      Object.entries(filters).forEach(([column, value]) => addCondition('eq', column, value))
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
    gt(column: string, value: AthenaConditionValue) {
      addCondition('gt', column, value)
      return self
    },
    gte(column: string, value: AthenaConditionValue) {
      addCondition('gte', column, value)
      return self
    },
    lt(column: string, value: AthenaConditionValue) {
      addCondition('lt', column, value)
      return self
    },
    lte(column: string, value: AthenaConditionValue) {
      addCondition('lte', column, value)
      return self
    },
    neq(column: string, value: AthenaConditionValue) {
      addCondition('neq', column, value)
      return self
    },
    like(column: string, value: AthenaConditionValue) {
      addCondition('like', column, value)
      return self
    },
    ilike(column: string, value: AthenaConditionValue) {
      addCondition('ilike', column, value)
      return self
    },
    is(column: string, value: AthenaConditionValue) {
      addCondition('is', column, value)
      return self
    },
    in(column: string, values: AthenaConditionArrayValue) {
      addCondition('in', column, values)
      return self
    },
    contains(column: string, values: AthenaConditionArrayValue) {
      addCondition('contains', column, values)
      return self
    },
    containedBy(column: string, values: AthenaConditionArrayValue) {
      addCondition('containedBy', column, values)
      return self
    },
    not(columnOrExpression: string, operator?: AthenaConditionOperator, value?: AthenaConditionValue) {
      if (operator != null && value !== undefined) {
        addCondition('not', undefined, `${columnOrExpression}.${operator}.${stringifyFilterValue(value)}`)
      } else {
        addCondition('not', undefined, columnOrExpression)
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
  args: Record<string, unknown> | undefined,
  baseOptions: AthenaRpcCallOptions | undefined,
  client: ReturnType<typeof createAthenaGatewayClient>,
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
      limit: state.limit,
      offset: state.offset,
      order: state.order,
    }
    const response = await client.rpcGateway<SelectedRow[]>(payload, mergedOptions)
    return formatResult(response)
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
    state.conditions.push(condition)
  }

  const builder = {} as TableQueryBuilder<Row>

  const filterMethods = createFilterMethods(state, addCondition, builder)

  const runSelect = async <T = Row>(
    columns: string | string[] = DEFAULT_COLUMNS,
    options?: AthenaGatewayCallOptions,
  ) => {
    const payload = {
      table_name: tableName,
      columns,
      conditions: state.conditions.length ? [...state.conditions] : undefined,
      limit: state.limit,
      offset: state.offset,
      strip_nulls: options?.stripNulls ?? true,
      count: options?.count,
      head: options?.head,
    }
    const response = await client.fetchGateway<T>(payload, options)
    return formatResult(response)
  }

  const createSelectChain = <SelectedRow>(
    columns: string | string[],
    options?: AthenaGatewayCallOptions,
  ): SelectChain<SelectedRow> => {
    const chain = {} as SelectChain<SelectedRow>
    const filterMethods = createFilterMethods(state, addCondition, chain)
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
      return builder
    },
    select<T = Row>(columns: string | string[] = DEFAULT_COLUMNS, options?: AthenaGatewayCallOptions) {
      return createSelectChain<T>(columns, options)
    },
    insert(values: Row | Row[], options?: AthenaGatewayCallOptions) {
      if (Array.isArray(values)) {
        const executeInsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
        ) => {
          const mergedOptions = mergeOptions(options, selectOptions)
          const payload: AthenaInsertPayload = {
            table_name: tableName,
            insert_body: values as Record<string, unknown>[],
          }
          if (columns) payload.columns = columns
          if (mergedOptions?.count) payload.count = mergedOptions.count
          if (mergedOptions?.head) payload.head = mergedOptions.head
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull
          }
          const response = await client.insertGateway<Row[]>(payload, mergedOptions)
          return formatResult(response)
        }
        return createMutationQuery<Row[]>(executeInsertMany)
      }
      const executeInsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const payload: AthenaInsertPayload = {
          table_name: tableName,
          insert_body: values as Record<string, unknown>,
        }
        if (columns) payload.columns = columns
        if (mergedOptions?.count) payload.count = mergedOptions.count
        if (mergedOptions?.head) payload.head = mergedOptions.head
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull
        }
        const response = await client.insertGateway<Row>(payload, mergedOptions)
        return formatResult(response)
      }
      return createMutationQuery<Row>(executeInsertOne)
    },
    upsert(
      values: Row | Row[],
      options?: AthenaGatewayCallOptions & { updateBody?: Partial<Row>; onConflict?: string | string[] },
    ) {
      if (Array.isArray(values)) {
        const executeUpsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
        ) => {
          const mergedOptions = mergeOptions(options, selectOptions)
          const payload: AthenaInsertPayload = {
            table_name: tableName,
            insert_body: values as Record<string, unknown>[],
            update_body: options?.updateBody ? (options.updateBody as Record<string, unknown>) : undefined,
          }
          if (columns) payload.columns = columns
          if (options?.onConflict) payload.on_conflict = options.onConflict
          if (mergedOptions?.count) payload.count = mergedOptions.count
          if (mergedOptions?.head) payload.head = mergedOptions.head
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull
          }
          const response = await client.insertGateway<Row[]>(payload, mergedOptions)
          return formatResult(response)
        }
        return createMutationQuery<Row[]>(executeUpsertMany)
      }
      const executeUpsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions)
        const payload: AthenaInsertPayload = {
          table_name: tableName,
          insert_body: values as Record<string, unknown>,
          update_body: options?.updateBody ? (options.updateBody as Record<string, unknown>) : undefined,
        }
        if (columns) payload.columns = columns
        if (options?.onConflict) payload.on_conflict = options.onConflict
        if (mergedOptions?.count) payload.count = mergedOptions.count
        if (mergedOptions?.head) payload.head = mergedOptions.head
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull
        }
        const response = await client.insertGateway<Row>(payload, mergedOptions)
        return formatResult(response)
      }
      return createMutationQuery<Row>(executeUpsertOne)
    },
    update(values: Partial<Row>, options?: AthenaGatewayCallOptions) {
      const executeUpdate = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
      ) => {
        const filters = state.conditions.length ? [...state.conditions] : undefined
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
      const mutation = createMutationQuery<Row[]>(executeUpdate)
      const updateChain = {} as UpdateChain<Row>
      const filterMethods = createFilterMethods(state, addCondition, updateChain)
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
  })

  return builder
}

function createQueryBuilder(client: ReturnType<typeof createAthenaGatewayClient>) {
  return async function query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      throw new Error('query requires a non-empty string')
    }
    const response = await client.queryGateway<Row[]>({ query: normalizedQuery }, options)
    return formatResult(response)
  }
}

export interface AthenaSdkClient {
  from<Row = unknown>(table: string): TableQueryBuilder<Row>
  rpc<Row = unknown, Args extends Record<string, unknown> = Record<string, unknown>>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>
  query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions): Promise<AthenaResult<Row[]>>
}

/** Client config for builder */
export interface AthenaClientConfig {
  baseUrl: string
  apiKey: string
  client?: string
  backend?: BackendConfig
  headers?: Record<string, string>
  healthTracking?: boolean
}

function createClientFromConfig(config: AthenaClientConfig): AthenaSdkClient {
  const gateway = createAthenaGatewayClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    client: config.client,
    backend: config.backend,
    headers: config.headers,
  })
  return {
    from<Row = unknown>(table: string) {
      return createTableBuilder<Row>(table, gateway)
    },
    rpc<Row = unknown, Args extends Record<string, unknown> = Record<string, unknown>>(
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
        args as Record<string, unknown> | undefined,
        options,
        gateway,
      )
    },
    query: createQueryBuilder(gateway) as AthenaSdkClient['query'],
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
  build(): AthenaSdkClient
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

  build(): AthenaSdkClient {
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
  static fromEnvironment(): AthenaSdkClient {
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

/** Create client (convenience wrapper; use AthenaClient.builder() for full control) */
export function createClient(
  url: string,
  apiKey: string,
  options?: Pick<AthenaGatewayCallOptions, 'client' | 'headers' | 'backend'>,
): AthenaSdkClient {
  const b = AthenaClient.builder().url(url).key(apiKey).backend(toBackendConfig(options?.backend))
  if (options?.client) b.client(options.client)
  if (options?.headers && Object.keys(options.headers).length > 0) b.headers(options.headers)
  return b.build()
}
