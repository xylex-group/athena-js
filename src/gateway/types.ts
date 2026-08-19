/**
 * athena gateway types
 *
 * type definitions for the athena gateway api client and react hook
 */

export type AthenaGatewayMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AthenaGatewayEndpointPath =
  | "/gateway/fetch"
  | "/gateway/insert"
  | "/gateway/update"
  | "/gateway/delete"
  | "/gateway/rpc"
  | "/gateway/query"
  | "/gateway/transaction"
  | `/rpc/${string}`
  | `/storage/${string}`
  | `/admin/backups${string}`;

export type AthenaCountOption = "exact" | "planned" | "estimated";

export type AthenaJsonPrimitive = string | number | boolean | null;
export type AthenaJsonValue =
  | AthenaJsonPrimitive
  | AthenaJsonObject
  | AthenaJsonArray;
export interface AthenaJsonObject {
  [key: string]: AthenaJsonValue;
}
export type AthenaJsonArray = AthenaJsonValue[];

export type AthenaConditionValue = AthenaJsonPrimitive;
export type AthenaConditionArrayValue = AthenaConditionValue[];
export type AthenaConditionCastType = string;

export type AthenaConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in"
  | "contains"
  | "containedBy"
  | "not"
  | "or";

export interface AthenaGatewayCondition {
  column?: string;
  /**
   * Optional explicit cast for `column` (for example `"text"`).
   * Used by SDK SQL fallback for typed comparisons.
   */
  column_cast?: AthenaConditionCastType;
  /** Back-compat shape expected by older gateway implementations */
  eq_column?: string;
  /** Optional cast hint aligned with legacy eq_* fields */
  eq_column_cast?: AthenaConditionCastType;
  eq_value?: AthenaConditionValue | AthenaConditionArrayValue | string;
  /** Optional cast hint aligned with legacy eq_* fields */
  eq_value_cast?: AthenaConditionCastType;
  operator: AthenaConditionOperator;
  value?: AthenaConditionValue | AthenaConditionArrayValue | string;
  /**
   * Optional explicit cast for `value` (for example `"uuid"`).
   * Older gateways ignore unknown fields; newer gateways may use this hint.
   */
  value_cast?: AthenaConditionCastType;
}

export type AthenaSortDirection = "ascending" | "descending";

export interface AthenaSortBy {
  direction: AthenaSortDirection;
  field: string;
}

export interface AthenaFetchPayload {
  aggregation_column?: string;
  aggregation_dedup?: boolean;
  aggregation_strategy?: "cumulative_sum";
  columns?: string[] | string;
  conditions?: AthenaGatewayCondition[];
  count?: AthenaCountOption;
  current_page?: number;
  group_by?: string;
  head?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: AthenaJsonObject | AthenaJsonArray;
  page_size?: number;
  select?: string | AthenaJsonObject;
  sort_by?: AthenaSortBy;
  strip_nulls?: boolean;
  table_name?: string;
  time_granularity?: "day" | "hour" | "minute";
  total_pages?: number;
  view_name?: string;
  where?: AthenaJsonObject;
}

export interface AthenaInsertPayload<
  TInsertBody = AthenaJsonObject,
  TUpdateBody = AthenaJsonObject,
> {
  columns?: string[] | string;
  count?: AthenaCountOption;
  default_to_null?: boolean;
  head?: boolean;
  insert_body: TInsertBody | TInsertBody[];
  on_conflict?: string | string[];
  table_name: string;
  update_body?: TUpdateBody;
}

export interface AthenaDeletePayload {
  columns?: string[] | string;
  conditions?: AthenaGatewayCondition[];
  current_page?: number;
  /** Fluent `.limit()` / `.range()` bounds (preferred over page_* when both are set). */
  limit?: number;
  offset?: number;
  page_size?: number;
  resource_id?: string;
  sort_by?: AthenaSortBy;
  table_name: string;
  total_pages?: number;
}

export interface AthenaUpdatePayload<TUpdateBody = AthenaJsonObject>
  extends AthenaFetchPayload {
  update_body: TUpdateBody;
}

export type AthenaRpcFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in";

export interface AthenaRpcFilter {
  column: string;
  operator: AthenaRpcFilterOperator;
  value?: AthenaConditionValue | AthenaConditionArrayValue | string;
}

export interface AthenaRpcOrder {
  ascending?: boolean;
  column: string;
}

export interface AthenaRpcPayload<TArgs = AthenaJsonObject> {
  args?: TArgs;
  count?: AthenaCountOption;
  filters?: AthenaRpcFilter[];
  function: string;
  function_name?: string;
  head?: boolean;
  limit?: number;
  offset?: number;
  order?: AthenaRpcOrder;
  schema?: string;
  select?: string;
}

export interface AthenaQueryPayload {
  /**
   * Expected result shape for shape-aware executors (D1 all vs run).
   * Athena 4 gateways ignore unknown fields.
   */
  expectedShape?: "rows" | "single" | "maybe-single" | "affected-only" | "none";
  /**
   * Explicit raw-SQL operation metadata (Athena 5 / admin.query).
   * Athena 4 gateways ignore unknown fields.
   */
  operation?:
    | "select"
    | "insert"
    | "update"
    | "delete"
    | "ddl"
    | "transaction"
    | "unknown";
  /** Optional bind parameters (D1 / SQLite-safe query path; HTTP gateways may ignore). */
  params?: unknown[];
  query: string;
}

/** Backend type for Athena client (aligns with athena-rs) */
export type BackendType = "athena" | "postgrest" | "postgresql" | "scylladb";

/** Backend config: type from SDK + backend-scoped options */
export interface BackendConfig {
  options?: AthenaJsonObject;
  type: BackendType;
}

/** Pre-defined backends for lean usage: backend: Backend.Athena */
export const Backend = {
  Athena: { type: "athena" } as const,
  PostgreSQL: { type: "postgresql" } as const,
  Postgrest: { type: "postgrest" } as const,
  ScyllaDB: { type: "scylladb" } as const,
} as const satisfies Record<string, BackendConfig>;

export type BackendOption = BackendConfig | BackendType;

export interface AthenaGatewayBaseOptions {
  apiKey?: string;
  backend?: BackendOption;
  baseUrl?: string;
  bearerToken?: string | null;
  client?: string;
  cookie?: string | null;
  forceNoCache?: boolean;
  headers?: Record<string, string>;
  /** JDBC/PostgreSQL URI mirrored to `x-athena-jdbc-url` and `x-jdbc-url` compatibility headers. */
  jdbcUrl?: string | null;
  organizationId?: string | null;
  /** Direct PostgreSQL URI forwarded as `x-pg-uri` (OpenAPI preferred routing header). */
  pgUri?: string | null;
  publishEvent?: string;
  sessionToken?: string | null;
  userId?: string | null;
}

export type AthenaGatewayHookConfig = AthenaGatewayBaseOptions;
export interface AthenaGatewayCallOptions extends AthenaGatewayBaseOptions {
  count?: AthenaCountOption;
  defaultToNull?: boolean;
  head?: boolean;
  onConflict?: string | string[];
  /** Bind parameters for `queryGateway` / `client.query` (edge D1 and SQL-aware gateways). */
  params?: unknown[];
  schema?: string;
  signal?: AbortSignal;
  stripNulls?: boolean;
  updateBody?: AthenaJsonObject;
}

export interface AthenaRpcCallOptions extends AthenaGatewayCallOptions {
  count?: AthenaCountOption;
  get?: boolean;
}

export interface AthenaGatewayResponse<T = unknown> {
  /** Mutation affected-row count. Omitted on reads. */
  affectedRows?: number | null;
  count?: number | null;
  data: T | null;
  error?: string;
  errorDetails?: AthenaGatewayErrorDetails | null;
  ok: boolean;
  raw: unknown;
  status: number;
  statusText?: string | null;
}

export type AthenaDiscoveryErrorCode =
  | "ATHENA_DISCOVERY_UNAVAILABLE"
  | "ATHENA_DISCOVERY_INCOMPATIBLE"
  | "ATHENA_PROTOCOL_INCOMPATIBLE"
  | "ATHENA_DISCOVERY_CAPABILITY_MISSING"
  | "ATHENA_RUNTIME_UNAVAILABLE";

/** Data probe succeeded; Auth is disabled or not advertised. Not a discovery failure. */
export type AthenaAuthAvailabilityErrorCode = "ATHENA_AUTH_NOT_AVAILABLE";

export type AthenaGatewayTransportErrorCode =
  | "NETWORK_ERROR"
  | "INVALID_URL"
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "UNKNOWN_ERROR";

export type AthenaGatewayErrorCode =
  | AthenaGatewayTransportErrorCode
  | AthenaDiscoveryErrorCode;

export interface AthenaGatewayErrorDetails {
  cause?: string;
  code: AthenaGatewayErrorCode;
  endpoint?: AthenaGatewayEndpointPath;
  hint?: string;
  message: string;
  method?: AthenaGatewayMethod;
  requestId?: string;
  status: number;
}

export interface AthenaGatewayConnectionOptions {
  headers?: Record<string, string>;
  path?: `/${string}`;
  signal?: AbortSignal;
}

export interface AthenaGatewayConnectionResult {
  baseUrl: string;
  error?: string;
  errorDetails?: AthenaGatewayErrorDetails | null;
  ok: boolean;
  raw: unknown;
  reachable: boolean;
  status: number;
  statusText?: string | null;
  url: string;
}

export interface AthenaGatewayResponseLog extends AthenaGatewayResponse {
  timestamp: string;
}

export interface AthenaGatewayCallLog {
  endpoint: AthenaGatewayEndpointPath;
  headers: Record<string, string>;
  method: AthenaGatewayMethod;
  payload: unknown;
  timestamp: string;
}

export interface AthenaGatewayHookResult {
  baseUrl: string;
  deleteGateway: <T = unknown>(
    payload: AthenaDeletePayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  error: string | null;
  fetchGateway: <T = unknown>(
    payload: AthenaFetchPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  insertGateway: <T = unknown>(
    payload: AthenaInsertPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  isLoading: boolean;
  lastRequest: AthenaGatewayCallLog | null;
  lastResponse: AthenaGatewayResponseLog | null;
  rpcGateway: <T = unknown>(
    payload: AthenaRpcPayload,
    options?: AthenaRpcCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  updateGateway: <T = unknown>(
    payload: AthenaUpdatePayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
}
