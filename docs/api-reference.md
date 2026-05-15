# API Reference

This is the contract-level reference for the Athena JS SDK exports.
The docs are split by API surface area to avoid overlap.

## Exports at a glance

Package entrypoint `@xylex-group/athena` exports:

- Client/runtime constructors
- Query-builder types and operations
- Error helpers
- Typed schema helpers (`defineModel` etc.)
- Generator configuration and rendering helpers
- Gateway-related hooks/types via `@xylex-group/athena/react` and direct re-exports

For a high-level workflow, see:

- [`getting-started.md`](getting-started.md)
- [`typed-schema-registry.md`](typed-schema-registry.md)
- [`generator-config.md`](generator-config.md)

## Core result type

Most runtime operations resolve to:

```ts
interface AthenaResult<T> {
  data: T | null
  error: string | null
  errorDetails?: AthenaGatewayErrorDetails | null
  status: number
  count?: number | null
  raw: unknown
}
```

`data` is `null` on failure; `error` is `null` on success.

## Client construction

### `createClient`

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(
  url: string,
  apiKey: string,
  options?: {
    client?: string
    headers?: Record<string, string>
    backend?: BackendConfig | BackendType
  },
): AthenaSdkClient
```

### `AthenaClient`

```ts
import { AthenaClient } from "@xylex-group/athena";

const athena = AthenaClient.fromEnvironment();
```

- `fromEnvironment()` reads:
  - `ATHENA_URL` or `ATHENA_GATEWAY_URL`
  - `ATHENA_API_KEY` or `ATHENA_GATEWAY_API_KEY`
- throws if url/key are missing.

### Builder API (`AthenaClient.builder()`)

```ts
interface AthenaClientBuilder {
  url(url: string): AthenaClientBuilder
  key(apiKey: string): AthenaClientBuilder
  backend(backend: BackendConfig | BackendType): AthenaClientBuilder
  client(clientName: string): AthenaClientBuilder
  headers(headers: Record<string, string>): AthenaClientBuilder
  healthTracking(enabled: boolean): AthenaClientBuilder
  build(): AthenaSdkClient
}
```

`build()` requires both `url` and `key`; backend defaults to `athena`.

`healthTracking(enabled)` exists on the builder for forward-compatible API compatibility.

### Backend constants and type

`Backend` export:

```ts
const Backend = {
  Athena: { type: "athena" },
  Postgrest: { type: "postgrest" },
  PostgreSQL: { type: "postgresql" },
  ScyllaDB: { type: "scylladb" },
} as const
```

`BackendType` is `"athena" | "postgrest" | "postgresql" | "scylladb"`.

## Query runtime API

### `AthenaSdkClient`

```ts
interface AthenaSdkClient {
  from<Row = unknown>(table: string): TableQueryBuilder<Row>
  rpc<Row = unknown, Args extends Record<string, unknown> = Record<string, unknown>>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>
  query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions): Promise<AthenaResult<Row[]>>
}
```

### Filter and modifier chain methods

`FilterChain<T>` is implemented by `TableQueryBuilder`, `SelectChain`, `UpdateChain`:

```ts
interface FilterChain<Self> {
  eq(column: string, value: AthenaConditionValue): Self
  eqCast(column: string, value: AthenaConditionValue, cast: string): Self
  eqUuid(column: string, value: string): Self
  match(filters: Record<string, AthenaConditionValue>): Self
  range(from: number, to: number): Self
  limit(count: number): Self
  offset(count: number): Self
  currentPage(value: number): Self
  pageSize(value: number): Self
  totalPages(value: number): Self
  order(column: string, options?: { ascending?: boolean }): Self
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
  not(columnOrExpression: string, operator?: AthenaConditionOperator, value?: AthenaConditionValue): Self
  or(expression: string): Self
}
```

`eq()` auto-switches to text-aware typed comparison when values look like UUIDs and
column name matches identifier patterns (`id`, `*_id`, `*uuid*`).

### `TableQueryBuilder`

```ts
interface TableQueryBuilder<Row> extends FilterChain<TableQueryBuilder<Row>> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<T>
  insert(values: Row, options?: AthenaGatewayCallOptions): MutationQuery<Row>
  insert(values: Row[], options?: AthenaGatewayCallOptions): MutationQuery<Row[]>
  upsert(
    values: Row,
    options?: AthenaGatewayCallOptions & { updateBody?: Partial<Row>; onConflict?: string | string[] },
  ): MutationQuery<Row>
  upsert(
    values: Row[],
    options?: AthenaGatewayCallOptions & { updateBody?: Partial<Row>; onConflict?: string | string[] },
  ): MutationQuery<Row[]>
  update(values: Partial<Row>, options?: AthenaGatewayCallOptions): UpdateChain<Row>
  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  reset(): TableQueryBuilder<Row>
}
```

Notes:

- `.select()` returns a `SelectChain`, not a promise.
- `.single()` / `.maybeSingle()` are convenience read terminators.
- `.delete()` throws if no `id`/`resource_id` filter and no `resourceId` option are present.
- `.reset()` clears accumulated filters/modifiers only.

### `SelectChain`

```ts
interface SelectChain<Row> extends FilterChain<SelectChain<Row>>, PromiseLike<AthenaResult<Row[]>> {
  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
}
```

`then/await` executes the read immediately.

### `MutationQuery`

```ts
interface MutationQuery<Result> extends PromiseLike<AthenaResult<Result>> {
  select(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>
  returning(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>
  single<T = Result>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<MutationSingleResult<Result>>>
  maybeSingle<T = Result>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<MutationSingleResult<Result>>>
}
```

`MutationSingleResult<Result>` resolves to `Result | null` for non-array and array payloads.

### `UpdateChain`

```ts
interface UpdateChain<Row> extends FilterChain<UpdateChain<Row>>, MutationQuery<Row[]> {}
```

### `RpcQueryBuilder`

```ts
interface RpcQueryBuilder<Row> extends PromiseLike<AthenaResult<Row[]>> {
  eq(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  neq(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  gt(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  gte(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  lt(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  lte(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  like(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  ilike(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  is(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  in(column: string, values: AthenaConditionArrayValue): RpcQueryBuilder<Row>
  order(column: string, options?: { ascending?: boolean }): RpcQueryBuilder<Row>
  limit(count: number): RpcQueryBuilder<Row>
  offset(count: number): RpcQueryBuilder<Row>
  range(from: number, to: number): RpcQueryBuilder<Row>
  select(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<Row[]>>
  single<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<T | null>>
}
```

`athena.rpc(fn, args, options)` requires non-empty `fn`.

## Gateway-level options and payloads

### `AthenaGatewayCallOptions`

Used by builder `.select/.insert/.update/.delete` payloads and query methods.

```ts
interface AthenaGatewayCallOptions {
  baseUrl?: string
  apiKey?: string
  client?: string
  backend?: BackendConfig | BackendType
  publishEvent?: string
  headers?: Record<string, string>
  userId?: string | null
  organizationId?: string | null
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  stripNulls?: boolean
  defaultToNull?: boolean
  onConflict?: string | string[]
  updateBody?: Record<string, unknown>
}
```

### `AthenaRpcCallOptions`

```ts
interface AthenaRpcCallOptions extends AthenaGatewayCallOptions {
  schema?: string
  count?: "exact" | "planned" | "estimated"
  get?: boolean // call compatibility GET /rpc/{function}
}
```

### Condition and sort shapes

```ts
type AthenaConditionValue = string | number | boolean | null
type AthenaConditionArrayValue = Array<AthenaConditionValue>
type AthenaConditionOperator =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is"
  | "in" | "contains" | "containedBy" | "not" | "or"
```

`AthenaGatewayCondition` stores query filter objects sent by builder methods.

### `AthenaFetchPayload`

```ts
interface AthenaFetchPayload {
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
  time_granularity?: "day" | "hour" | "minute"
  aggregation_column?: string
  aggregation_strategy?: "cumulative_sum"
  aggregation_dedup?: boolean
  sort_by?: { field: string; direction: "ascending" | "descending" }
}
```

### `AthenaInsertPayload`

```ts
interface AthenaInsertPayload {
  table_name: string
  insert_body: Record<string, unknown> | Record<string, unknown>[]
  update_body?: Record<string, unknown>
  columns?: string[] | string
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  default_to_null?: boolean
  on_conflict?: string | string[]
}
```

### `AthenaUpdatePayload`

```ts
interface AthenaUpdatePayload extends AthenaFetchPayload {
  set?: Record<string, unknown>
  data?: Record<string, unknown> // compatibility alias
}

```

### `AthenaDeletePayload`

```ts
interface AthenaDeletePayload {
  table_name: string
  resource_id?: string
  columns?: string[] | string
  conditions?: AthenaGatewayCondition[]
  sort_by?: { field: string; direction: "ascending" | "descending" }
  current_page?: number
  page_size?: number
  total_pages?: number
}
```

`resource_id` is required by `useAthenaGateway.deleteGateway` and by typed path constraints used in `from(...).delete(...)` when not resolved from filters.

### `AthenaRpcPayload`

```ts
interface AthenaRpcPayload {
  function: string
  function_name?: string
  schema?: string
  args?: Record<string, unknown>
  select?: string
  filters?: AthenaRpcFilter[]
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  limit?: number
  offset?: number
  order?: { column: string; ascending?: boolean }
}
```

### `AthenaQueryPayload`

```ts
interface AthenaQueryPayload {
  query: string
}
```

### Gateway response/error types

```ts
interface AthenaGatewayResponse<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  count?: number | null
  error?: string
  errorDetails?: AthenaGatewayErrorDetails | null
  raw: unknown
}
interface AthenaGatewayErrorDetails {
  code: "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_JSON" | "UNKNOWN_ERROR"
  message: string
  status: number
  endpoint?: "/gateway/fetch" | "/gateway/insert" | "/gateway/update" | "/gateway/delete" | "/gateway/rpc" | "/gateway/query" | `/rpc/${string}`
  method?: "GET" | "POST" | "PUT" | "DELETE"
  requestId?: string
  hint?: string
  cause?: string
}
```

`AthenaGatewayError` is exported and can be detected with `isAthenaGatewayError(...)`.

## Runtime error helpers

### `normalizeAthenaError` and classification

```ts
type AthenaErrorKind = "unique_violation" | "not_found" | "validation" | "auth" | "rate_limit" | "transient" | "unknown"
type AthenaErrorCode = "UNIQUE_VIOLATION" | "NOT_FOUND" | "VALIDATION_FAILED" | "AUTH_UNAUTHORIZED" | "AUTH_FORBIDDEN" | "RATE_LIMITED" | "NETWORK_UNAVAILABLE" | "TRANSIENT_FAILURE" | "HTTP_FAILURE" | "UNKNOWN"
type AthenaErrorCategory = "transport" | "client" | "server" | "database" | "unknown"

interface AthenaOperationContext {
  table?: string
  operation?: string
  identity?: string | Record<string, unknown>
}

interface NormalizedAthenaError {
  kind: AthenaErrorKind
  code: AthenaErrorCode
  category: AthenaErrorCategory
  retryable: boolean
  status?: number
  constraint?: string
  table?: string
  operation?: string
  message: string
  raw: unknown
}
```

### Helpers

- `isOk(result): boolean`
- `unwrapRows(result, {context?, allowNull?})`
- `unwrap(result, {allowNull?})`
- `unwrapOne(result, { allowNull?, requireExactlyOne? })`
- `requireSuccess(result, context?)`
- `requireAffected(result, { min? }, context?)`
- `normalizeAthenaError(input, context?)`
- `coerceInt(value, options?)`
- `assertInt(value, label?, options?)`
- `withRetry({ retries, baseDelayMs?, maxDelayMs?, backoff?, jitter?, shouldRetry? }, fn)`
- `AthenaError` class with `kind`, `code`, `category`, `status`, etc.

## Typed system API

### Schema declaration exports

- `defineModel<Row, Insert = Partial<Row>, Update = Partial<Insert>, Meta>(input)`
- `defineSchema<Models>(models)`
- `defineDatabase<Schemas>(schemas)`
- `defineRegistry<Databases>(databases)`

### Typed client

```ts
type TenantContextValue = string | number | boolean | null | undefined
type TenantKeyMap = Record<string, string>
type TenantContext<TMap extends TenantKeyMap = TenantKeyMap> = Partial<Record<keyof TMap, TenantContextValue>>

interface TypedClientOptions {
  tenantKeyMap?: TenantKeyMap
  tenantContext?: TenantContext
  backend?: BackendConfig | BackendType
  client?: string
  headers?: Record<string, string>
}

interface TypedAthenaClient<...> extends AthenaSdkClient {
  readonly registry: RegistryDef
  readonly tenantKeyMap: Readonly<Record<string, string>>
  readonly tenantContext: TenantContext
  withTenantContext(context: TenantContext): TypedAthenaClient
  fromModel(database: string, schema: string, model: string): TableQueryBuilder
}

function createTypedClient(registry, url, apiKey, options?): TypedAthenaClient
```

### Provider helpers

- `createPostgresIntrospectionProvider(...)` for direct provider mode.

### Utility types

- `RegistryDef`, `DatabaseDef`, `SchemaDef`, `ModelDef`
- `RowOf`, `InsertOf`, `UpdateOf`, `ModelAt`
- `IntrospectionSnapshot`, `SchemaIntrospectionProvider`

## Generator API

Exports (core):

- `defineGeneratorConfig(config)`
- `findGeneratorConfigPath(cwd?)`
- `loadGeneratorConfig(options?)`
- `normalizeGeneratorConfig(config)`
- `resolveGeneratorProvider(providerConfig, experimentalFlags)`
- `generateArtifactsFromSnapshot(snapshot, config)`
- `runSchemaGenerator(options?)`
- `resolveGeneratorProvider`
- `resolvePostgresColumnType`

### Config helpers

```ts
interface AthenaGeneratorConfig {
  provider: GeneratorProviderConfig
  output: GeneratorOutputConfig
  naming?: Partial<GeneratorNamingConfig>
  features?: Partial<GeneratorFeatureFlags>
  experimental?: Partial<GeneratorExperimentalFlags>
}
```

`runSchemaGenerator` return:

- `snapshot`
- `files`
- `writtenFiles` (empty when dry run)
- `configPath`

## React integration (`@xylex-group/athena/react`)

### `useAthenaGateway`

```ts
import { useAthenaGateway } from "@xylex-group/athena/react";
```

```ts
interface AthenaGatewayHookConfig {
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  backend?: BackendConfig | BackendType
  client?: string
  userId?: string | null
  organizationId?: string | null
  publishEvent?: string
}

interface AthenaGatewayHookResult {
  fetchGateway<T>(payload: AthenaFetchPayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  insertGateway<T>(payload: AthenaInsertPayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  updateGateway<T>(payload: AthenaUpdatePayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  deleteGateway<T>(payload: AthenaDeletePayload, options?: AthenaGatewayCallOptions): Promise<AthenaGatewayResponse<T>>
  rpcGateway<T>(payload: AthenaRpcPayload, options?: AthenaRpcCallOptions): Promise<AthenaGatewayResponse<T>>
  isLoading: boolean
  error: string | null
  lastRequest: AthenaGatewayCallLog | null
  lastResponse: AthenaGatewayResponseLog | null
  baseUrl: string
}
```

`deleteGateway` throws if `resource_id` is missing in payload.

### Query runtime

- `createAthenaQueryClient(config?)`
- `AthenaQueryClientProvider`
- `useAthenaQueryClient`
- `useQuery(options)`
- `useMutation(options)`
- `attachStateAdapter(client, adapter)`

Runtime defaults:

- `cache.mode = "none"` by default.
- `defaultQueryOptions.retry = 0`, default refetch:
  - on mount: `true`
  - on window focus: `false`
  - on reconnect: `false`
- `defaultMutationOptions.retry = 0`.

Default query behavior performs inflight dedupe for identical keys.

### `UseQueryOptions` shape (minimum)

```ts
interface UseQueryOptions<TQueryFnData, TData = TQueryFnData> {
  queryKey: readonly unknown[] | string
  queryFn: () => Promise<TQueryFnData>
  enabled?: boolean
  initialData?: TData
  retry?: number | false
  retryDelay?: number | ((attempt: number) => number)
}
```

Result includes:

- `data`, `error`, `isLoading`, `isFetching`, `isSuccess`, `isError`, `status`
- `refetch()`, `reset()`
- `lastRequest`, `lastResponse`

### `UseMutationOptions` shape (minimum)

```ts
interface UseMutationOptions<TVariables, TMutationFnData, TData = TMutationFnData> {
  mutationFn: (variables: TVariables) => Promise<TMutationFnData>
  mutationKey?: readonly unknown[] | string
  onMutate?: (variables: TVariables) => void | Promise<void>
  onSuccess?: (data: TData, variables: TVariables) => void
  onError?: (error: AthenaQueryError, variables: TVariables) => void
  onSettled?: (data: TData | undefined, error: AthenaQueryError | null, variables: TVariables) => void
  select?: (data: TMutationFnData) => TData
  retry?: number | false
  retryDelay?: number | ((attempt: number) => number)
}
```

Result includes:

- `mutate`, `mutateAsync`
- `data`, `error`, `isLoading`, `isSuccess`, `isError`, `status`
- `reset()`, `lastResponse`, `lastVariables`, `lastRequest`

## Error and result patterns

### Request envelope

Use `if (result.error)` before reading `data` in service code, or helpers like:

- `requireSuccess`
- `requireAffected`
- `unwrap/unwrapRows/unwrapOne`
- React hooks which expose normalized errors.

### Header behavior to remember

- SDK adds `X-Athena-Sdk` automatically (`xylex-group/athena <version>`).
- Standard header keys are forwarded:
  - `apikey`, `x-api-key`
  - `X-User-Id`
  - `X-Organization-Id`
  - `X-Backend-Type` from `backend`
  - `X-Strip-Nulls`
  - `X-Athena-Client`, `X-Publish-Event`

## Validation commands

```bash
pnpm typecheck
pnpm check:all
```

Use these after large API-level updates or generated contract changes.
