/**
 * athena gateway types
 *
 * type definitions for the athena gateway api client and react hook
 */

export type AthenaGatewayMethod = 'POST' | 'PUT' | 'DELETE'
export type AthenaGatewayEndpointPath =
  | '/gateway/fetch'
  | '/gateway/insert'
  | '/gateway/update'
  | '/gateway/delete'

export type AthenaCountOption = 'exact' | 'planned' | 'estimated'

export type AthenaConditionValue = string | number | boolean | null
export type AthenaConditionArrayValue = Array<AthenaConditionValue>

export type AthenaConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains'
  | 'containedBy'
  | 'not'
  | 'or'

export interface AthenaGatewayCondition {
  column?: string
  operator: AthenaConditionOperator
  value?: AthenaConditionValue | AthenaConditionArrayValue | string
}

export interface AthenaFetchPayload {
  view_name?: string
  table_name?: string
  columns?: string[] | string
  conditions?: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  current_page?: number
  page_size?: number
  total_pages?: number
  strip_nulls?: boolean
  group_by?: string
  time_granularity?: 'day' | 'hour' | 'minute'
  aggregation_column?: string
  aggregation_strategy?: 'cumulative_sum'
  aggregation_dedup?: boolean
}

export interface AthenaInsertPayload {
  table_name: string
  insert_body: Record<string, unknown> | Record<string, unknown>[]
  update_body?: Record<string, unknown>
  columns?: string[] | string
  count?: AthenaCountOption
  head?: boolean
  default_to_null?: boolean
  on_conflict?: string | string[]
}

export interface AthenaDeletePayload {
  table_name: string
  resource_id?: string
  columns?: string[] | string
  conditions?: AthenaGatewayCondition[]
}

export interface AthenaUpdatePayload extends AthenaFetchPayload {
  update_body?: Record<string, unknown>
}

export interface AthenaGatewayBaseOptions {
  baseUrl?: string
  client?: string
  apiKey?: string
  stripNulls?: boolean
  supabaseUrl?: string
  supabaseKey?: string
  publishEvent?: string
  headers?: Record<string, string>
  /** optional user context injected as gateway request headers */
  userId?: string | null
  companyId?: string | null
  organizationId?: string | null
}

export interface AthenaGatewayHookConfig extends AthenaGatewayBaseOptions {}
export interface AthenaGatewayCallOptions extends AthenaGatewayBaseOptions {
  count?: AthenaCountOption
  head?: boolean
  defaultToNull?: boolean
  onConflict?: string | string[]
  updateBody?: Record<string, unknown>
}

export interface AthenaGatewayResponse<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  error?: string
  raw: unknown
}

export interface AthenaGatewayResponseLog extends AthenaGatewayResponse {
  timestamp: string
}

export interface AthenaGatewayCallLog {
  endpoint: AthenaGatewayEndpointPath
  method: AthenaGatewayMethod
  payload: unknown
  headers: Record<string, string>
  timestamp: string
}

export interface AthenaGatewayHookResult {
  fetchGateway: <T = unknown>(
    payload: AthenaFetchPayload,
    options?: AthenaGatewayCallOptions,
  ) => Promise<AthenaGatewayResponse<T>>
  insertGateway: <T = unknown>(
    payload: AthenaInsertPayload,
    options?: AthenaGatewayCallOptions,
  ) => Promise<AthenaGatewayResponse<T>>
  updateGateway: <T = unknown>(
    payload: AthenaUpdatePayload,
    options?: AthenaGatewayCallOptions,
  ) => Promise<AthenaGatewayResponse<T>>
  deleteGateway: <T = unknown>(
    payload: AthenaDeletePayload,
    options?: AthenaGatewayCallOptions,
  ) => Promise<AthenaGatewayResponse<T>>
  isLoading: boolean
  error: string | null
  lastRequest: AthenaGatewayCallLog | null
  lastResponse: AthenaGatewayResponseLog | null
  baseUrl: string
}
