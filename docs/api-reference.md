# API Reference

This page documents the exported contract surfaces of `@xylex-group/athena` and `@xylex-group/athena/react`.

For workflow-first onboarding, start with [`getting-started.md`](getting-started.md).
For the full `findMany(...)` AST explanation, live route payloads, and Athena server implications, use [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md).
For model architecture strategy, use [`type-safety-playbook.md`](type-safety-playbook.md).
For Athena Auth endpoint parity and per-endpoint examples, use [`auth/index.mdx`](auth/index.mdx) and [`auth-client-bindings.md`](auth-client-bindings.md).
For exhaustive method-by-method coverage (including auth, runtime chains, react, cookies, and utils), use [`complete-method-reference.md`](complete-method-reference.md).

## Export surfaces

Main package exports include:

- runtime client constructors (`createClient`, `AthenaClient`)
- query builder contracts (`AthenaSdkClient`, `TableQueryBuilder`, `RpcQueryBuilder`)
- typed registry builders (`defineModel`, `defineSchema`, `defineDatabase`, `defineRegistry`, `createTypedClient`)
- generator config/pipeline helpers
- result and error helpers

React package exports include:

- low-level gateway hook (`useAthenaGateway`)
- query runtime (`createAthenaQueryClient`, provider, `useQuery`, `useMutation`)
- auth session parity hook (`useSession`)

Main package auth exports include:

- `createClient(...).auth` (preferred) and `createAuthClient` (deprecated)
- `AthenaAuthSdkClient` with both legacy flat methods and grouped `auth.*` bindings
- organization plugin binding surface (`AthenaAuthOrganizationBindings`)
- auth binding contract (`AthenaAuthBindings`)

## Core result contract

Most SDK operations return:

```ts
interface AthenaResultError {
  message: string
  code: string | null
  athenaCode: AthenaErrorCode
  gatewayCode?: AthenaGatewayErrorCode | null
  kind: AthenaErrorKind
  category: AthenaErrorCategory
  retryable: boolean
  details: unknown | null
  hint: string | null
  status: number
  statusText: string | null
  constraint?: string
  table?: string
  operation?: string
  endpoint?: AthenaGatewayEndpointPath
  method?: AthenaGatewayMethod
  requestId?: string
  cause?: string
  raw: unknown
}

interface AthenaResult<T> {
  data: T | null
  error: AthenaResultError | null
  statusText?: string | null
  errorDetails?: AthenaGatewayErrorDetails | null
  status: number
  count?: number | null
  raw: unknown
}
```

## Runtime client construction

### `createClient(url, apiKey, options?)`

```ts
function createClient(
  url: string,
  apiKey: string,
  options?: Pick<AthenaGatewayCallOptions, "client" | "headers" | "backend"> & {
    auth?: AthenaAuthClientConfig
    experimental?: {
      enableErrorNormalization?: boolean
      findManyAst?: boolean
      traceQueries?: boolean | AthenaQueryTraceOptions
    }
  },
): AthenaSdkClientWithAuth
```

`experimental.enableErrorNormalization` is deprecated and retained as a no-op compatibility flag because failed `AthenaResult` values now expose structured normalized `error` objects by default.
`experimental.findManyAst` opt-ins clean `findMany(...)` calls to send the original object AST through `/gateway/fetch` for gateways that support direct AST bodies.
`experimental.traceQueries` emits detailed query execution diagnostics for every runtime call.
For deferred builders, trace callsites are captured from the public SDK seam that declared or finalized the operation and are memoized through the eventual execution, so traces stay anchored to user code across local and CI stack differences.

### `AthenaQueryTraceOptions`

```ts
interface AthenaQueryTraceOptions {
  logger?: (event: AthenaQueryTraceEvent) => void
}
```

### `AthenaQueryTraceEvent`

```ts
interface AthenaQueryTraceEvent {
  timestamp: string
  durationMs: number
  operation: "select" | "insert" | "upsert" | "update" | "delete" | "rpc" | "query"
  endpoint:
    | "/gateway/fetch"
    | "/gateway/insert"
    | "/gateway/update"
    | "/gateway/delete"
    | "/gateway/rpc"
    | "/gateway/query"
    | `/rpc/${string}`
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

interface AthenaQueryTraceCallsite {
  filePath: string
  fileName: string
  line: number
  column: number
  frame?: string
  functionName?: string
}
```

### `@xylex-group/athena/utils` subpath

```ts
import { slugify, trimTrailingSlashes, parseBooleanFlag, isLocalHostname, clearAuthCookies, proxyRequestHeaders } from "@xylex-group/athena/utils"
```

```ts
function slugify(input: string): string
```

- lowercases
- replaces non `[a-z0-9]` groups with `-`
- trims leading/trailing `-`
- caps output length at `64`

```ts
function trimTrailingSlashes(value: string): string
```

Removes one or more trailing `/` characters from a string.

```ts
function parseBooleanFlag(rawValue: string | undefined, fallback: boolean): boolean
```

Parses common boolean flag tokens (`1/0`, `true/false`, `yes/no`, `on/off`) and returns `fallback` for empty or unrecognized input.

```ts
function isLocalHostname(hostname: string): boolean
```

Returns `true` for local/loopback hosts such as:

- `localhost` and `*.localhost`
- `127.0.0.1` and `127.*.*.*`
- `::1`, `[::1]`, `0:0:0:0:0:0:0:1`

```ts
interface ClearAuthCookiesOptions {
  prefixes?: string[]
  hostname?: string
  path?: string
  cookieHeader?: string
}

function clearAuthCookies(options?: ClearAuthCookiesOptions): string[]
```

`clearAuthCookies(...)` is browser-oriented and safely returns `[]` when no browser cookie store is available.

```ts
function proxyRequestHeaders(request: Request): Headers
```

Creates a cloned `Headers` set suitable for upstream proxy calls and normalizes forwarding headers:

- removes `host`
- sets `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-origin`, `x-forwarded-uri`
- sets `x-forwarded-port` only when the request URL includes an explicit port

### `AthenaClient.fromEnvironment()`

Reads:

- `ATHENA_URL` or `ATHENA_GATEWAY_URL`
- `ATHENA_API_KEY` or `ATHENA_GATEWAY_API_KEY`

Throws when URL or key is missing.

### `AthenaClient.builder()`

```ts
interface AthenaClientBuilder {
  url(url: string): AthenaClientBuilder
  key(apiKey: string): AthenaClientBuilder
  backend(backend: BackendConfig | BackendType): AthenaClientBuilder
  client(clientName: string): AthenaClientBuilder
  headers(headers: Record<string, string>): AthenaClientBuilder
  auth(config: AthenaAuthClientConfig): AthenaClientBuilder
  experimental(options: AthenaClientExperimentalOptions): AthenaClientBuilder
  options(options: AthenaCreateClientOptions): AthenaClientBuilder
  healthTracking(enabled: boolean): AthenaClientBuilder
  build(): AthenaSdkClientWithAuth
}
```

`build()` requires both URL and key.

Behavior notes:

- `build()` returns `AthenaSdkClientWithAuth` (same contract as `createClient(...)`)
- `auth(...)`, `experimental(...)`, and `options(...)` are additive
- repeated `auth(...)`/`options({ auth })` calls merge auth headers and fields
- repeated `experimental(...)`/`options({ experimental })` calls merge flags (including `traceQueries` object config)

### Backend constants

```ts
const Backend = {
  Athena: { type: "athena" },
  Postgrest: { type: "postgrest" },
  PostgreSQL: { type: "postgresql" },
  ScyllaDB: { type: "scylladb" },
} as const;
```

`BackendType`:

```ts
type BackendType = "athena" | "postgrest" | "postgresql" | "scylladb"
```

## Query runtime API

### `AthenaSdkClient`

```ts
interface AthenaSdkClient {
  from<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update>
  db: AthenaDbModule

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>

  query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>>
}

interface AthenaSdkClientWithAuth extends AthenaSdkClient {
  auth: AthenaAuthBindings
}

interface AthenaFromOptions {
  schema?: string
}

interface AthenaDbModule {
  from<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update>

  select<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>, SelectedRow = Row>(
    table: string,
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row, SelectedRow>

  insert<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    values: Insert | Insert[],
    options?: AthenaGatewayCallOptions,
  ): MutationQuery<Row> | MutationQuery<Row[]>

  upsert<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    values: Insert | Insert[],
    options?: AthenaGatewayCallOptions & { updateBody?: Update; onConflict?: string | string[] },
  ): MutationQuery<Row> | MutationQuery<Row[]>

  update<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    values: Update,
    options?: AthenaGatewayCallOptions,
  ): UpdateChain<Row>

  delete<Row = Record<string, AthenaJsonValue | undefined>>(
    table: string,
    options?: AthenaGatewayCallOptions & { resourceId?: string },
  ): MutationQuery<Row | null>

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>

  query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions): Promise<AthenaResult<Row[]>>
}
```

## Builder contracts

### Shared filter chain (typed-column behavior)

`TableQueryBuilder`, `SelectChain`, and `UpdateChain` implement a shared filter contract.

On typed paths, column params are keyed to row fields when keys are known.
On untyped paths, column params fall back to `string`.

Methods include:

- `eq`, `eqCast`, `eqUuid`, `match`
- `range`, `limit`, `offset`, `currentPage`, `pageSize`, `totalPages`
- `order`
- `gt`, `gte`, `lt`, `lte`, `neq`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`
- `not`, `or`

`eq()` applies UUID-aware behavior for identifier-like columns.

### `TableQueryBuilder<Row, Insert, Update, Context = unknown>`

```ts
interface TableQueryBuilder<Row, Insert = Partial<Row>, Update = Partial<Insert>, Context = unknown> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<Row, T>
  findMany<const TSelect extends AthenaSelectShape>(
    options: AthenaFindManyOptions<Row, TSelect>,
  ): Promise<AthenaResult<Array<AthenaFindManyResult<Row, TSelect, Context>>>>

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

  reset(): TableQueryBuilder<Row, Insert, Update, Context>
}
```

Notes:

- `.findMany(...)` is an eager object-AST read surface that compiles into the existing gateway payload.
- `.select(...)` returns a chain, not an eager promise.
- The `columns` string is comma-separated, and response aliases can be requested with `customName:columnName`.
- `.delete(...)` throws if neither `id` nor `resource_id` condition is present and no `resourceId` option is supplied.
- `.reset()` clears builder state (filters/modifiers) and reuses same table target.

Example:

```ts
await athena.from("users").findMany({
  select: {
    id: true,
    profile: {
      select: {
        display_name: true,
      },
    },
  },
  where: {
    id: "u-1",
  },
})
```

### `findMany(...)` AST types

```ts
interface AthenaRelationSelectNode<TSelect extends AthenaSelectShape = AthenaSelectShape> {
  select: TSelect
  as?: string
  via?: string
  schema?: string
}

type AthenaSelectShape = Record<string, true | AthenaRelationSelectNode<any>>

type AthenaWhereOperatorInput = {
  eq?: AthenaConditionValue
  neq?: AthenaConditionValue
  gt?: AthenaConditionValue
  gte?: AthenaConditionValue
  lt?: AthenaConditionValue
  lte?: AthenaConditionValue
  like?: AthenaConditionValue
  ilike?: AthenaConditionValue
  is?: AthenaConditionValue
  in?: AthenaConditionArrayValue
  contains?: AthenaConditionArrayValue
  containedBy?: AthenaConditionArrayValue
}

type AthenaWhere<Row = Record<string, AthenaJsonValue | undefined>> =
  Partial<Record<keyof Row & string, AthenaConditionValue | AthenaWhereOperatorInput>> & {
    or?: Array<Partial<Record<keyof Row & string, AthenaConditionValue | AthenaWhereOperatorInput>>>
    not?: Partial<Record<keyof Row & string, AthenaConditionValue | AthenaWhereOperatorInput>>
  }

type AthenaOrderBy<Row = Record<string, AthenaJsonValue | undefined>> =
  | {
      column: keyof Row & string
      ascending?: boolean
    }
  | Partial<
      Record<
        keyof Row & string,
        "asc" | "desc" | "ascending" | "descending" | boolean | { ascending?: boolean }
      >
    >

interface AthenaFindManyOptions<Row, TSelect extends AthenaSelectShape> {
  select: TSelect
  where?: AthenaWhere<Row>
  orderBy?: AthenaOrderBy<Row>
  limit?: number
}
```

Schema-qualified base table + relation example:

```ts
await athena.from("chat_subscriptions", { schema: "private" }).findMany({
  select: {
    user_id: true,
    user: {
      schema: "athena",
      select: {
        id: true,
      },
    },
  },
})
```

Notes:

- `select` is required.
- `where` scalar values compile to `eq`.
- `where.or` and `where.not` only support shapes that map losslessly into the current gateway condition transport.
- `orderBy` supports one column in v1.
- `as` and `via` are the escape hatches for aliased or ambiguous relation joins.

### `SelectChain<Row, SelectedRow = Row>`

```ts
interface SelectChain<Row, SelectedRow = Row>
  extends PromiseLike<AthenaResult<SelectedRow[]>> {
  single<T = SelectedRow>(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>

  maybeSingle<T = SelectedRow>(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
}
```

`await`/`.then(...)` executes the read.

### `MutationQuery<Result>`

```ts
interface MutationQuery<Result> extends PromiseLike<AthenaResult<Result>> {
  select(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>
  returning(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>

  single(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Result extends Array<infer Item> ? Item | null : Result | null>>

  maybeSingle(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Result extends Array<infer Item> ? Item | null : Result | null>>
}
```

### `UpdateChain<Row>`

```ts
interface UpdateChain<Row> extends MutationQuery<Row[]> {}
```

### `RpcQueryBuilder<Row>`

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

`rpc(fn, ...)` requires a non-empty function name.

## Gateway types and payloads

### JSON-safe primitives

```ts
type AthenaJsonPrimitive = string | number | boolean | null

type AthenaJsonValue = AthenaJsonPrimitive | AthenaJsonObject | AthenaJsonArray

interface AthenaJsonObject {
  [key: string]: AthenaJsonValue
}

type AthenaJsonArray = AthenaJsonValue[]
```

### Condition primitives

```ts
type AthenaConditionValue = AthenaJsonPrimitive
type AthenaConditionArrayValue = Array<AthenaConditionValue>
type AthenaConditionCastType = string
```

### `AthenaGatewayCallOptions`

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

  schema?: string
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  defaultToNull?: boolean
  stripNulls?: boolean
  onConflict?: string | string[]
  updateBody?: AthenaJsonObject
}
```

### `AthenaRpcCallOptions`

```ts
interface AthenaRpcCallOptions extends AthenaGatewayCallOptions {
  count?: "exact" | "planned" | "estimated"
  get?: boolean
}
```

### Fetch payload

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
  sort_by?: AthenaSortBy
}
```

### Insert payload

```ts
interface AthenaInsertPayload<TInsertBody = AthenaJsonObject, TUpdateBody = AthenaJsonObject> {
  table_name: string
  insert_body: TInsertBody | TInsertBody[]
  update_body?: TUpdateBody
  columns?: string[] | string
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  default_to_null?: boolean
  on_conflict?: string | string[]
}
```

### Update payload

```ts
interface AthenaUpdatePayload<TUpdateBody = AthenaJsonObject> extends AthenaFetchPayload {
  set?: TUpdateBody
  data?: TUpdateBody
}
```

### Delete payload

```ts
interface AthenaDeletePayload {
  table_name: string
  resource_id?: string
  columns?: string[] | string
  conditions?: AthenaGatewayCondition[]
  sort_by?: AthenaSortBy
  current_page?: number
  page_size?: number
  total_pages?: number
}
```

### RPC payload

```ts
interface AthenaRpcPayload<TArgs = AthenaJsonObject> {
  function: string
  function_name?: string
  schema?: string
  args?: TArgs
  select?: string
  filters?: AthenaRpcFilter[]
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  limit?: number
  offset?: number
  order?: AthenaRpcOrder
}
```

### Query payload

```ts
interface AthenaQueryPayload {
  query: string
}
```

## Gateway response/error contracts

```ts
interface AthenaGatewayResponse<T = unknown> {
  ok: boolean
  status: number
  statusText?: string | null
  data: T | null
  count?: number | null
  error?: string
  errorDetails?: AthenaGatewayErrorDetails | null
  raw: unknown
}

type AthenaGatewayErrorCode =
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "UNKNOWN_ERROR"

interface AthenaGatewayErrorDetails {
  code: AthenaGatewayErrorCode
  message: string
  status: number
  endpoint?: "/gateway/fetch" | "/gateway/insert" | "/gateway/update" | "/gateway/delete" | "/gateway/rpc" | "/gateway/query" | `/rpc/${string}`
  method?: "GET" | "POST" | "PUT" | "DELETE"
  requestId?: string
  hint?: string
  cause?: string
}
```

Gateway error utilities:

- `AthenaGatewayError`
- `isAthenaGatewayError(error)`

## Error and result helpers (`auxiliaries`)

### Error classification primitives

```ts
type AthenaErrorKind = "unique_violation" | "not_found" | "validation" | "auth" | "rate_limit" | "transient" | "unknown"

type AthenaErrorCode =
  | "UNIQUE_VIOLATION"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "AUTH_UNAUTHORIZED"
  | "AUTH_FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK_UNAVAILABLE"
  | "TRANSIENT_FAILURE"
  | "HTTP_FAILURE"
  | "UNKNOWN"

type AthenaErrorCategory = "transport" | "client" | "server" | "database" | "unknown"
```

### Main helpers

- `isOk(result)`
- `normalizeAthenaError(input, context?)`
- `unwrapRows(result, options?)`
- `unwrap(result, options?)`
- `unwrapOne(result, options?)`
- `requireSuccess(result, context?)`
- `requireAffected(result, { min? }, context?)`
- `coerceInt(value, options?)`
- `assertInt(value, label?, options?)`
- `withRetry(config, fn)`
- `AthenaError` class

## Typed schema and registry API

### Model declarations

```ts
function defineModel<Row, Insert = Partial<Row>, Update = Partial<Insert>, Meta extends ModelMetadata<Row> = ModelMetadata<Row>>(
  input: { meta: Meta },
): ModelDef<Row, Insert, Update, Meta>

function defineSchema<Models extends Record<string, AnyModelDef>>(models: Models): SchemaDef<Models>
function defineDatabase<Schemas extends Record<string, SchemaDef<Record<string, AnyModelDef>>>>(schemas: Schemas): DatabaseDef<Schemas>
function defineRegistry<Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>>(databases: Databases): RegistryDef<Databases>
```

### Typed client

```ts
interface TypedClientOptions<TMap extends TenantKeyMap = TenantKeyMap>
  extends Pick<AthenaGatewayCallOptions, "backend" | "client" | "headers"> {
  tenantKeyMap?: TMap
  tenantContext?: TenantContext<TMap>
}

interface TypedAthenaClient<TRegistry, TTenantMap> extends AthenaSdkClient {
  readonly registry: TRegistry
  readonly tenantKeyMap: Readonly<TTenantMap>
  readonly tenantContext: TenantContext<TTenantMap>

  withTenantContext(context: TenantContext<TTenantMap>): TypedAthenaClient<TRegistry, TTenantMap>

  fromModel<
    TDatabase extends keyof TRegistry & string,
    TSchema extends keyof TRegistry[TDatabase]["schemas"] & string,
    TModel extends keyof TRegistry[TDatabase]["schemas"][TSchema]["models"] & string,
  >(
    database: TDatabase,
    schema: TSchema,
    model: TModel,
  ): TableQueryBuilder<
    RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    InsertOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    UpdateOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>
  >
}

function createTypedClient(registry, url, apiKey, options?): TypedAthenaClient
```

### Utility types

- `ModelDef`, `SchemaDef`, `DatabaseDef`, `RegistryDef`
- `RowOf<TModel>`
- `InsertOf<TModel>`
- `UpdateOf<TModel>`
- `ModelAt<TRegistry, TDatabase, TSchema, TModel>`
- `TenantKeyMap`, `TenantContext`, `TenantContextValue`
- introspection types (`IntrospectionSnapshot`, `IntrospectionTable`, etc.)

## Generator API

Runtime exports:

- `defineGeneratorConfig`
- `findGeneratorConfigPath`
- `loadGeneratorConfig`
- `normalizeGeneratorConfig`
- `resolveGeneratorProvider`
- `generateArtifactsFromSnapshot`
- `runSchemaGenerator`
- `resolvePostgresColumnType`
- `normalizeSchemaSelection`
- `resolveProviderSchemas`
- `DEFAULT_POSTGRES_SCHEMAS`

Config root type:

```ts
interface AthenaGeneratorConfig {
  provider: GeneratorProviderConfig
  output: GeneratorOutputConfig
  naming?: Partial<GeneratorNamingConfig>
  features?: Partial<GeneratorFeatureFlags>
  experimental?: Partial<GeneratorExperimentalFlags>
}
```

`runSchemaGenerator(...)` returns snapshot + generated files + written files (unless dry-run).

## React integration (`@xylex-group/athena/react`)

### Gateway hook

```ts
useAthenaGateway(config?: AthenaGatewayHookConfig): AthenaGatewayHookResult
```

Hook result methods:

- `fetchGateway`
- `insertGateway`
- `updateGateway`
- `deleteGateway`
- `rpcGateway`

State fields:

- `isLoading`
- `error`
- `lastRequest`
- `lastResponse`
- `baseUrl`

### Query runtime exports

- `AthenaQueryClient`
- `createAthenaQueryClient`
- `attachStateAdapter`
- `AthenaQueryClientProvider`
- `useAthenaQueryClient`
- `useQuery`
- `useMutation`

Default runtime stance is intentionally conservative:

- cache mode defaults to `none`
- retries default to `0`
- focus/refetch behavior is restrained by default

## Validation commands

Use these after API surface or typed-contract updates:

```bash
pnpm typecheck
pnpm check:all
```

For generator-related changes also run:
Use these after large API-level updates or generated contract changes.
## Generator configuration quick reference (from docs/generator-config.md)

### Defaults recap

- `provider` has no runtime default and must be configured.
- output targets:
  - `model`: `athena/models/{schema_kebab}/{model_kebab}.ts`
  - `schema`: `athena/schemas/{schema_kebab}.ts`
  - `database`: `athena/relations.ts`
  - `registry`: `athena/config.ts`
- naming:
  - `modelType: "pascal"`
  - `modelConst: "camel"`
  - `schemaConst: "camel"`
  - `databaseConst: "camel"`
  - `registryConst: "camel"`
- feature flags:
  - `emitRelations: true`
  - `emitRegistry: true`
- experimental:
  - `postgresGatewayIntrospection: false`
  - `scyllaProviderContracts: true`

### Config discovery

Generator config discovery checks in order:

1. `athena.config.ts`
2. `athena.config.js`
3. `athena-js.config.ts`
4. `athena-js.config.js`
5. `.athena.config.ts`
6. `.athena.config.js`

### Command line usage

- `athena-js generate`
- `athena-js generate --dry-run`
- `athena-js generate --config ./path/to/config`

If you need concrete examples and troubleshooting scenarios, use the full
[`generator-config.md`](generator-config.md) page.

```bash
athena-js generate --dry-run
```
