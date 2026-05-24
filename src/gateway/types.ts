/**
 * athena gateway types
 *
 * type definitions for the athena gateway api client and react hook
 */

export type AthenaGatewayMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type AthenaGatewayEndpointPath =
  | '/gateway/fetch'
  | '/gateway/insert'
  | '/gateway/update'
  | '/gateway/delete'
  | '/gateway/rpc'
  | '/gateway/query'
  | `/rpc/${string}`

export type AthenaCountOption = 'exact' | 'planned' | 'estimated'

export type AthenaConditionValue = string | number | boolean | null
export type AthenaConditionArrayValue = Array<AthenaConditionValue>
export type AthenaConditionCastType = string

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
  /**
   * Optional explicit cast for `value` (for example `"uuid"`).
   * Older gateways ignore unknown fields; newer gateways may use this hint.
   */
  value_cast?: AthenaConditionCastType
  /**
   * Optional explicit cast for `column` (for example `"text"`).
   * Used by SDK SQL fallback for typed comparisons.
   */
  column_cast?: AthenaConditionCastType
  /** Back-compat shape expected by older gateway implementations */
  eq_column?: string
  eq_value?: AthenaConditionValue | AthenaConditionArrayValue | string
  /** Optional cast hint aligned with legacy eq_* fields */
  eq_value_cast?: AthenaConditionCastType
  /** Optional cast hint aligned with legacy eq_* fields */
  eq_column_cast?: AthenaConditionCastType
}

export type AthenaSortDirection = 'ascending' | 'descending'

export interface AthenaSortBy {
  field: string
  direction: AthenaSortDirection
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
  sort_by?: AthenaSortBy
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
  sort_by?: AthenaSortBy
  current_page?: number
  page_size?: number
  total_pages?: number
}

export interface AthenaUpdatePayload extends AthenaFetchPayload {
  set?: Record<string, unknown>
  data?: Record<string, unknown>
}

export type AthenaRpcFilterOperator =
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

export interface AthenaRpcFilter {
  column: string
  operator: AthenaRpcFilterOperator
  value?: AthenaConditionValue | AthenaConditionArrayValue | string
}

export interface AthenaRpcOrder {
  column: string
  ascending?: boolean
}

export interface AthenaRpcPayload {
  function: string
  function_name?: string
  schema?: string
  args?: Record<string, unknown>
  select?: string
  filters?: AthenaRpcFilter[]
  count?: AthenaCountOption
  head?: boolean
  limit?: number
  offset?: number
  order?: AthenaRpcOrder
}

export interface AthenaQueryPayload {
  query: string
}

/** Backend type for Athena client (aligns with athena-rs) */
export type BackendType = 'athena' | 'postgrest' | 'postgresql' | 'scylladb'

/** Backend config: type from SDK + backend-scoped options */
export interface BackendConfig {
  type: BackendType
  options?: Record<string, unknown>
}

/** Pre-defined backends for lean usage: backend: Backend.Athena */
export const Backend = {
  Athena: { type: 'athena' } as const,
  Postgrest: { type: 'postgrest' } as const,
  PostgreSQL: { type: 'postgresql' } as const,
  ScyllaDB: { type: 'scylladb' } as const,
} as const satisfies Record<string, BackendConfig>

export type BackendOption = BackendConfig | BackendType

export interface AthenaGatewayBaseOptions {
  baseUrl?: string
  apiKey?: string
  client?: string
  backend?: BackendOption
  publishEvent?: string
  headers?: Record<string, string>
  userId?: string | null
  organizationId?: string | null
}

export type AthenaGatewayHookConfig = AthenaGatewayBaseOptions
export interface AthenaGatewayCallOptions extends AthenaGatewayBaseOptions {
  schema?: string
  count?: AthenaCountOption
  head?: boolean
  defaultToNull?: boolean
  stripNulls?: boolean
  onConflict?: string | string[]
  updateBody?: Record<string, unknown>
}

export interface AthenaRpcCallOptions extends AthenaGatewayCallOptions {
  count?: AthenaCountOption
  get?: boolean
}

export interface AthenaGatewayResponse<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  count?: number | null
  error?: string
  errorDetails?: AthenaGatewayErrorDetails | null
  raw: unknown
}

export type AthenaGatewayErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'UNKNOWN_ERROR'

export interface AthenaGatewayErrorDetails {
  code: AthenaGatewayErrorCode
  message: string
  status: number
  endpoint?: AthenaGatewayEndpointPath
  method?: AthenaGatewayMethod
  requestId?: string
  hint?: string
  cause?: string
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
  rpcGateway: <T = unknown>(
    payload: AthenaRpcPayload,
    options?: AthenaRpcCallOptions,
  ) => Promise<AthenaGatewayResponse<T>>
  isLoading: boolean
  error: string | null
  lastRequest: AthenaGatewayCallLog | null
  lastResponse: AthenaGatewayResponseLog | null
  baseUrl: string
}
