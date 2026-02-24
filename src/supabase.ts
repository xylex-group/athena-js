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
import type { BackendType } from './gateway/types.ts'
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
export interface SelectChain<Row> extends FilterChain<SelectChain<Row>>, PromiseLike<SupabaseResult<Row[]>> {
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
}

/** Chain returned by update() - supports filters before execution, plus select/returning */
export interface UpdateChain<Row> extends FilterChain<UpdateChain<Row>>, MutationQuery<Row[]> {}

export interface TableQueryBuilder<Row> extends FilterChain<TableQueryBuilder<Row>> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<T>
  insert(values: Row | Row[], options?: AthenaGatewayCallOptions): MutationQuery<Row | Row[]>
  upsert(
    values: Row | Row[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Partial<Row>
      onConflict?: string | string[]
    },
  ): MutationQuery<Row | Row[]>
  update(values: Partial<Row>, options?: AthenaGatewayCallOptions): UpdateChain<Row>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>
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

  const createSelectChain = (
    columns: string | string[],
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row> => {
    const chain = {} as SelectChain<Row>
    const filterMethods = createFilterMethods(state, addCondition, chain)
    Object.assign(chain, filterMethods, {
      async single<T = Row>(cols?: string | string[], opts?: AthenaGatewayCallOptions) {
        const r = await runSelect<T[]>(cols ?? columns, opts ?? options)
        return toSingleResult(r)
      },
      maybeSingle<T = Row>(cols?: string | string[], opts?: AthenaGatewayCallOptions) {
        return chain.single<T>(cols, opts)
      },
      then<T1 = SupabaseResult<Row[]>, T2 = never>(
        onfulfilled?: (v: SupabaseResult<Row[]>) => T1 | PromiseLike<T1>,
        onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
      ) {
        return runSelect<Row[]>(columns, options).then(onfulfilled, onrejected)
      },
      catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
        return runSelect<Row[]>(columns, options).catch(onrejected)
      },
      finally(onfinally?: () => void) {
        return runSelect<Row[]>(columns, options).finally(onfinally)
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
      return createSelectChain(columns, options) as unknown as SelectChain<T>
    },
    insert(values: Row | Row[], options?: AthenaGatewayCallOptions) {
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
    upsert(
      values: Row | Row[],
      options?: AthenaGatewayCallOptions & { updateBody?: Partial<Row>; onConflict?: string | string[] },
    ) {
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

export interface SupabaseClient {
  from<Row = unknown>(table: string): TableQueryBuilder<Row>
}

/** Client config for builder (minimal, no companyId/defaultToNull/stripNulls/supabase*) */
export interface AthenaClientConfig {
  baseUrl: string
  apiKey: string
  client?: string
  backend?: BackendType
  headers?: Record<string, string>
  healthTracking?: boolean
}

function createClientFromConfig(config: AthenaClientConfig): SupabaseClient {
  const gateway = createAthenaGatewayClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    client: config.client,
    headers: config.headers,
  })
  return {
    from<Row = unknown>(table: string) {
      return createTableBuilder<Row>(table, gateway)
    },
  }
}

export interface AthenaClientBuilder {
  url(url: string): AthenaClientBuilder
  key(apiKey: string): AthenaClientBuilder
  backend(backend: BackendType): AthenaClientBuilder
  client(clientName: string): AthenaClientBuilder
  headers(headers: Record<string, string>): AthenaClientBuilder
  healthTracking(enabled: boolean): AthenaClientBuilder
  build(): SupabaseClient
}

export const AthenaClient = {
  builder(): AthenaClientBuilder {
    let url: string | undefined
    let key: string | undefined
    let backend: BackendType = 'athena'
    let clientName: string | undefined
    let headers: Record<string, string> | undefined
    let healthTracking = false
    const builder = {
      url(u: string) {
        url = u
        return builder
      },
      key(k: string) {
        key = k
        return builder
      },
      backend(b: BackendType) {
        backend = b
        return builder
      },
      client(c: string) {
        clientName = c
        return builder
      },
      headers(h: Record<string, string>) {
        headers = h
        return builder
      },
      healthTracking(enabled: boolean) {
        healthTracking = enabled
        return builder
      },
      build(): SupabaseClient {
        if (!url || !key) {
          throw new Error('AthenaClient requires url and key; call .url() and .key() before .build()')
        }
        return createClientFromConfig({
          baseUrl: url,
          apiKey: key,
          client: clientName,
          backend,
          headers,
          healthTracking,
        })
      },
    }
    return builder
  },

  /** Build client from env: ATHENA_SUPABASE_URL, ATHENA_SUPABASE_KEY (or SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) */
  fromSupabaseEnv(): SupabaseClient {
    const url =
      process.env.ATHENA_SUPABASE_URL ??
      process.env.SUPABASE_URL
    const key =
      process.env.ATHENA_SUPABASE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'ATHENA_SUPABASE_URL and ATHENA_SUPABASE_KEY (or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are required',
      )
    }
    return AthenaClient.builder()
      .backend('supabase')
      .url(url)
      .key(key)
      .build()
  },
}

/** Create client (convenience wrapper; use AthenaClient.builder() for full control) */
export function createClient(
  url: string,
  apiKey: string,
  options?: Pick<AthenaGatewayCallOptions, 'client' | 'headers'> & { backend?: BackendType },
): SupabaseClient {
  const b = AthenaClient.builder().url(url).key(apiKey).backend(options?.backend ?? 'athena')
  if (options?.client) b.client(options.client)
  if (options?.headers && Object.keys(options.headers).length > 0) b.headers(options.headers)
  return b.build()
}
