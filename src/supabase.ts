import type {
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaGatewayResponse,
} from './gateway/types.js'
import { createAthenaGatewayClient } from './gateway/client.js'

type AthenaConditionValue = string | number | boolean | null

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

function formatResult<T>(response: AthenaGatewayResponse<T>): SupabaseResult<T> {
  return {
    data: response.data ?? null,
    error: response.error ?? null,
    status: response.status,
    raw: response.raw,
  }
}

function ensureConditionValue(value: AthenaConditionValue): AthenaConditionValue {
  return value
}

function buildCondition(column: string, value: AthenaConditionValue): AthenaGatewayCondition {
  return {
    eq_column: column,
    eq_value: ensureConditionValue(value),
  }
}

export interface TableQueryBuilder<Row> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T>>
  insert(values: Row | Row[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<Row | Row[]>>
  update(values: Partial<Row>, options?: AthenaGatewayCallOptions): Promise<SupabaseResult<Row[]>>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): Promise<SupabaseResult<null>>
  eq(column: string, value: AthenaConditionValue): TableQueryBuilder<Row>
  match(filters: Record<string, AthenaConditionValue>): TableQueryBuilder<Row>
  limit(count: number): TableQueryBuilder<Row>
  offset(count: number): TableQueryBuilder<Row>
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
  reset(): TableQueryBuilder<Row>
}

function getResourceId(state: TableBuilderState): string | undefined {
  const candidate = state.conditions.find(
    condition => condition.eq_column === 'resource_id' || condition.eq_column === 'id',
  )
  return candidate?.eq_value?.toString()
}

function createTableBuilder<Row>(
  tableName: string,
  client: ReturnType<typeof createAthenaGatewayClient>,
): TableQueryBuilder<Row> {
  const state: TableBuilderState = {
    conditions: [],
  }

  const builder: TableQueryBuilder<Row> = {
    reset() {
      state.conditions = []
      state.limit = undefined
      state.offset = undefined
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
    match(filters: Record<string, AthenaConditionValue>) {
      Object.entries(filters).forEach(([column, value]) => {
        state.conditions.push(buildCondition(column, value))
      })
      return builder
    },
    eq(column: string, value: AthenaConditionValue) {
      state.conditions.push(buildCondition(column, value))
      return builder
    },
    async select<T = Row>(columns: string | string[] = '*', options?: AthenaGatewayCallOptions) {
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
    async insert(values: Row | Row[], options?: AthenaGatewayCallOptions) {
      const response = await client.insertGateway<Row | Row[]>(
        {
          table_name: tableName,
          insert_body: values as Record<string, unknown>,
        },
        options,
      )
      return formatResult(response)
    },
    async update(values: Partial<Row>, options?: AthenaGatewayCallOptions) {
      const payload = {
        table_name: tableName,
        update_body: values,
        conditions: state.conditions.length ? [...state.conditions] : undefined,
        strip_nulls: options?.stripNulls ?? true,
      }
      const response = await client.updateGateway<Row[]>(payload, options)
      return formatResult(response)
    },
    async delete(options?: AthenaGatewayCallOptions & { resourceId?: string }) {
      const resourceId = options?.resourceId ?? getResourceId(state)
      if (!resourceId) {
        throw new Error('delete requires a resource_id either via eq("resource_id", ...) or options.resourceId')
      }
      const response = await client.deleteGateway<null>(
        {
          table_name: tableName,
          resource_id: resourceId,
        },
        options,
      )
      return formatResult(response)
    },
    async single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      const response = await builder.select<T[]>(columns, options)
      const rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : []
      return {
        ...response,
        data: (rows[0] ?? null) as unknown as T | null,
      }
    },
    async maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions) {
      return builder.single<T | null>(columns ?? '*', options)
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
