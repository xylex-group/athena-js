# API reference

Complete reference for every export in `@xylex-group/athena`.

## createClient

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(
  url: string,
  apiKey: string,
  options?: { client?: string; headers?: Record<string, string>; backend?: BackendConfig }
): AthenaSdkClient
```

Creates and returns an `AthenaSdkClient` bound to the given URL and API key. All requests use `url` as the base URL and send `apiKey` as the `apikey` and `x-api-key` headers.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Base URL of the Athena gateway server |
| `apiKey` | `string` | API key sent with every request |
| `options` | `{ client?, headers?, backend? }` | Optional: `client`, `headers`, `backend` (object with `type: BackendType` and `options?`) |

**Returns** `AthenaSdkClient`

---

## AthenaSdkClient

```ts
interface AthenaSdkClient {
  from<Row = unknown>(table: string): TableQueryBuilder<Row>
  rpc<Row = unknown, Args extends Record<string, unknown> = Record<string, unknown>>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>
}
```

### .from(table)

```ts
athena.from<Row = unknown>(table: string): TableQueryBuilder<Row>
```

Returns a `TableQueryBuilder` scoped to the named table. Pass a type argument to get typed results:

```ts
const builder = athena.from<User>("users");
```

### .rpc(functionName, args?, options?)

```ts
athena.rpc<Row = unknown, Args extends Record<string, unknown> = Record<string, unknown>>(
  fn: string,
  args?: Args,
  options?: AthenaRpcCallOptions,
): RpcQueryBuilder<Row>
```

Creates a chainable RPC query. By default it calls `POST /gateway/rpc`; when `options.get = true`, it calls `GET /rpc/{function_name}` compatibility route.

```ts
const { data, count } = await athena
  .rpc("list_users", { role: "admin" }, { schema: "public", count: "exact" })
  .eq("active", true)
  .order("created_at", { ascending: false })
  .range(0, 24)
  .select(["id", "email"]);

const { data: country } = await athena
  .rpc("list_stored_countries")
  .eq("id", 1)
  .single();
```

---

## TableQueryBuilder

All filter methods return `this` so they can be chained. The query does not execute until `.select()`, `.insert()`, `.update()`, `.upsert()`, `.delete()`, `.single()`, or `.maybeSingle()` is called.

### .select

```ts
.select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<T>
```

Returns a `SelectChain<T>` that supports additional filters and `single()/maybeSingle()` before execution. The request executes when the chain is awaited or when you call `.then()`, `.single()`, or `.maybeSingle()`. Defaults to `"*"` (all columns) when `columns` is omitted.

```ts
const { data } = await athena.from("users").select();
const { data } = await athena.from("users").select("id, name");
const { data } = await athena.from("users").select(["id", "name"]);
```

### .single

```ts
.single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
```

Executes `.select()` and returns `data` as a single object (the first element of the result array) instead of an array. Returns `null` when there are no results.

### .maybeSingle

Alias for `.single()`. Identical behavior.

### .insert

```ts
.insert(values: Row, options?: AthenaGatewayCallOptions): MutationQuery<Row>
.insert(values: Row[], options?: AthenaGatewayCallOptions): MutationQuery<Row[]>
```

Inserts one or more rows. Returns a `MutationQuery` — await it directly, or chain `.select()` / `.single()` to fetch the inserted rows.

**Options**

| Option | Type | Description |
|--------|------|-------------|
| `defaultToNull` | `boolean` | write explicit `null` for columns with no default |
| `count` | `AthenaCountOption` | request a row count alongside the response |
| `head` | `boolean` | return response headers only |

### .update

```ts
.update(values: Partial<Row>, options?: AthenaGatewayCallOptions): MutationQuery<Row[]>
```

Updates rows matching the conditions applied before this call. Chain filter methods (`.eq()`, `.match()`, etc.) before `.update()` to target specific rows.

### .upsert

```ts
.upsert(
  values: Row,
  options?: AthenaGatewayCallOptions & {
    updateBody?: Partial<Row>
    onConflict?: string | string[]
  },
): MutationQuery<Row>

.upsert(
  values: Row[],
  options?: AthenaGatewayCallOptions & {
    updateBody?: Partial<Row>
    onConflict?: string | string[]
  },
): MutationQuery<Row[]>
```

Inserts rows and updates them when a unique key conflict is detected.

**Options**

| Option | Type | Description |
|--------|------|-------------|
| `onConflict` | `string \| string[]` | column(s) that identify a conflict |
| `updateBody` | `Partial<Row>` | fields to apply when a conflict occurs |
| `defaultToNull` | `boolean` | write explicit `null` for missing fields |
| `count` | `AthenaCountOption` | request a row count |
| `head` | `boolean` | return headers only |

### .delete

```ts
.delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>
```

Deletes rows matching the conditions or `resourceId`. Requires one of:

- `.eq("resource_id", id)` chained before `.delete()`
- `.eq("id", id)` chained before `.delete()`
- `options.resourceId`

Throws synchronously when none of the above is provided.

### Filter methods

All filter methods return `TableQueryBuilder<Row>` for chaining.

| Method | Description |
|--------|-------------|
| `.eq(column, value)` | `column = value` |
| `.eqUuid(column, value)` | `column = value::uuid` (explicit UUID cast) |
| `.eqCast(column, value, cast)` | `column = value::cast` (explicit cast type) |
| `.neq(column, value)` | `column != value` |
| `.gt(column, value)` | `column > value` |
| `.gte(column, value)` | `column >= value` |
| `.lt(column, value)` | `column < value` |
| `.lte(column, value)` | `column <= value` |
| `.like(column, value)` | `column LIKE value` — case-sensitive pattern match |
| `.ilike(column, value)` | `column ILIKE value` — case-insensitive pattern match |
| `.is(column, value)` | `column IS value` — use for `null`, `true`, `false` |
| `.in(column, values)` | `column IN (values)` |
| `.contains(column, values)` | `column @> values` — array contains all given values |
| `.containedBy(column, values)` | `column <@ values` — array is a subset of values |
| `.match(filters)` | adds an `.eq()` condition for each key in `filters` |
| `.not(column, operator, value)` | `NOT column operator value` |
| `.or(expression)` | OR expression in `col.op.val,col.op.val` format |

`eq()` also auto-detects UUID-like values on identifier columns (`id`, `*_id`, `*uuid*`) and switches to a typed-safe comparison path to avoid Postgres UUID-vs-text operator errors.

### Modifier methods

All modifier methods live on the shared `FilterChain` and are available on `TableQueryBuilder`, `SelectChain`, and `UpdateChain` — i.e. before or after `.select()` / `.update()` / `.delete()`. Every setter returns `Self` for further chaining.

| Method | Payload field | Description |
|--------|---------------|-------------|
| `.limit(count)` | `limit` | maximum number of rows to return |
| `.offset(count)` | `offset` | number of rows to skip before returning |
| `.range(from, to)` | `offset` + `limit` | shorthand for `.offset(from).limit(to - from + 1)` |
| `.currentPage(n)` | `current_page` | 1-based page number for page-based pagination |
| `.pageSize(n)` | `page_size` | rows per page for page-based pagination |
| `.totalPages(n)` | `total_pages` | explicit total-page count hint (optional) |
| `.order(column, { ascending? })` | `sort_by` | `ORDER BY column ASC/DESC` — defaults to ascending |
| `.reset()` | — | clears all accumulated conditions, pagination, and order |

#### Ordering — `.order()`

```ts
.order(column: string, options?: { ascending?: boolean }): Self
```

Maps to the `sort_by` object on fetch, update, and delete payloads:

```ts
interface AthenaSortBy {
  field: string
  direction: "ascending" | "descending"
}
```

- `.order("created_at")` → `{ field: "created_at", direction: "ascending" }`
- `.order("created_at", { ascending: true })` → `ascending`
- `.order("created_at", { ascending: false })` → `descending`

Only the **last** `.order()` call wins — calling it twice overwrites the previous column. The SDK does not currently support multi-column ordering; use `.rpc()` or `.query()` for that.

```ts
// SELECT * FROM rsf_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 100
const { data } = await athena
  .from("rsf_messages")
  .eq("room_id", roomId)
  .select("*", { stripNulls: false })
  .order("created_at", { ascending: false })
  .limit(100);

// order also works before .select()
const { data: oldest } = await athena
  .from("events")
  .order("occurred_at")
  .limit(10)
  .select("id, occurred_at");

// order composes with .single() to get the most-recent / least-recent row
const { data: latest } = await athena
  .from("messages")
  .eq("room_id", roomId)
  .select("*")
  .order("created_at", { ascending: false })
  .single();
```

#### Pagination

The builder offers two interchangeable pagination styles that both map to body fields the gateway understands:

**1. Offset / limit (contiguous windows)**

```ts
// rows 51..75
await athena.from("orders").select("id").limit(25).offset(50);

// range: offset = from, limit = to - from + 1
await athena.from("orders").select("id").range(50, 74); // same as above
```

**2. Page based**

```ts
// rows for page 3 at 25-per-page
await athena
  .from("orders")
  .select("id, total")
  .currentPage(3)
  .pageSize(25);

// include a total-pages hint if the gateway needs one for its response envelope
await athena
  .from("orders")
  .select("id, total")
  .currentPage(1)
  .pageSize(25)
  .totalPages(10);
```

Offset/limit and page-based can be combined if a specific backend interprets them together — they're forwarded independently as separate body fields (`limit`, `offset`, `current_page`, `page_size`, `total_pages`). In typical usage you pick one style.

Pagination helpers work **before or after `.select()`** because they live on the shared `FilterChain`:

```ts
// before .select()
await athena.from("users").currentPage(2).pageSize(50).select();

// after .select()
await athena.from("users").select().currentPage(2).pageSize(50);
```

They also propagate on the update and delete chains (body-field-equivalent semantics):

```ts
await athena
  .from("queued_jobs")
  .update({ status: "claimed" })
  .eq("status", "ready")
  .order("priority", { ascending: false })
  .limit(10)
  .select("id");
```

#### `.reset()`

Clears accumulated conditions, `limit`, `offset`, `order`, `currentPage`, `pageSize`, and `totalPages` on the underlying builder state. Does not reset `columns` passed to `.select()` or any mutation body already queued — it only affects filter / pagination / order state.

```ts
const b = athena.from("users");
b.eq("active", true).limit(10);
// ...some condition you decide you need a fresh query
await b.reset().eq("role", "admin").select("id");
```

---

## MutationQuery

`insert`, `update`, `upsert`, and `delete` all return a `MutationQuery`. It is a thenable — you can `await` it, `.then()` it, or chain one of the methods below. The HTTP request fires exactly once.

```ts
interface MutationQuery<Result> extends PromiseLike<AthenaResult<Result>> {
  select(columns?, options?): Promise<AthenaResult<Result>>
  returning(columns?, options?): Promise<AthenaResult<Result>>
  single(columns?, options?): Promise<AthenaResult<MutationSingleResult<Result>>>
  maybeSingle(columns?, options?): Promise<AthenaResult<MutationSingleResult<Result>>>
  then(onfulfilled?, onrejected?): Promise<…>
  catch(onrejected?): Promise<…>
  finally(onfinally?): Promise<…>
}
```

| Method | Description |
|--------|-------------|
| `.select(columns?, options?)` | fire request and return the affected rows |
| `.returning(columns?, options?)` | alias for `.select()` |
| `.single(columns?, options?)` | fire request and return first row or `null` |
| `.maybeSingle(columns?, options?)` | alias for `.single()` |

---

## RpcQueryBuilder

Returned by `athena.rpc(...)`. It is awaitable and executes exactly once.

```ts
interface RpcQueryBuilder<Row> extends PromiseLike<AthenaResult<Row[]>> {
  eq(column, value): RpcQueryBuilder<Row>
  neq(column, value): RpcQueryBuilder<Row>
  gt(column, value): RpcQueryBuilder<Row>
  gte(column, value): RpcQueryBuilder<Row>
  lt(column, value): RpcQueryBuilder<Row>
  lte(column, value): RpcQueryBuilder<Row>
  like(column, value): RpcQueryBuilder<Row>
  ilike(column, value): RpcQueryBuilder<Row>
  is(column, value): RpcQueryBuilder<Row>
  in(column, values): RpcQueryBuilder<Row>
  order(column, options?: { ascending?: boolean }): RpcQueryBuilder<Row>
  limit(count): RpcQueryBuilder<Row>
  offset(count): RpcQueryBuilder<Row>
  range(from, to): RpcQueryBuilder<Row>
  select(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<Row[]>>
  single(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<Row | null>>
  maybeSingle(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<Row | null>>
}
```

`AthenaRpcCallOptions` extends gateway call options with:
- `schema?: string`
- `count?: "exact" | "planned" | "estimated"`
- `head?: boolean`
- `get?: boolean`

---

## Contributor validation scripts

```bash
pnpm typecheck  # compile-time type compatibility assertions
pnpm check:all  # lint + typecheck + test + build
```

---

## AthenaResult

Every query and mutation resolves to:

```ts
interface AthenaResult<T> {
  data: T | null      // response payload, null on error
  error: string | null // error message, null on success
  errorDetails?: AthenaGatewayErrorDetails | null // structured gateway failure metadata
  status: number       // HTTP status code
  count?: number | null // optional exact count (RPC / count-enabled calls)
  raw: unknown         // unprocessed response body
}
```

---

## Reliability helpers

The package exports composable utility helpers for result handling, coercion, retry, and normalized errors.

### isOk

```ts
isOk<T>(result: AthenaResult<T>): boolean
```

Returns `true` when `result.error === null` and the status is `2xx`.

### unwrapRows

```ts
unwrapRows<T>(
  result: AthenaResult<T[] | T | null>,
  options?: { context?: AthenaOperationContext; allowNull?: boolean },
): T[]
```

Throws on failed result. Normalizes `null` to `[]` and scalar payloads to `[payload]`.

### unwrap

```ts
unwrap<T>(result: AthenaResult<T | null>): T
unwrap<T>(result: AthenaResult<T | null>, options: { allowNull: true }): T | null
```

Throws on failed result. Throws on `null` unless `allowNull: true` is set.

### unwrapOne

```ts
unwrapOne<T>(result: AthenaResult<T[] | T | null>): T
unwrapOne<T>(
  result: AthenaResult<T[] | T | null>,
  options: { allowNull: true; requireExactlyOne?: boolean },
): T | null
```

Returns first row from a successful result. Can enforce exact cardinality with `requireExactlyOne`.

### requireSuccess

```ts
requireSuccess<T>(
  result: AthenaResult<T>,
  context?: AthenaOperationContext,
): AthenaResult<T>
```

Asserts success and returns the original result for chaining; throws `AthenaGatewayError` when not successful.

### requireAffected

```ts
requireAffected<T>(
  result: AthenaResult<T>,
  options?: { min?: number },
  context?: AthenaOperationContext,
): number
```

Enforces affected-row guarantees for write paths. Requires `result.count` and validates against `min` (default `1`).

### normalizeAthenaError

```ts
type AthenaErrorKind =
  | "unique_violation"
  | "not_found"
  | "validation"
  | "auth"
  | "rate_limit"
  | "transient"
  | "unknown"

type NormalizedAthenaError = {
  kind: AthenaErrorKind
  status?: number
  constraint?: string
  table?: string
  operation?: string
  message: string
  raw: unknown
}

normalizeAthenaError(
  resultOrError: unknown,
  context?: AthenaOperationContext,
): NormalizedAthenaError
```

Converts heterogeneous Athena errors/results into a stable, typed classification shape.

### coerceInt and assertInt

```ts
coerceInt(
  value: unknown,
  options?: { strictBigInt?: boolean; min?: number; max?: number },
): number | null

assertInt(
  value: unknown,
  label?: string,
  options?: { strictBigInt?: boolean; min?: number; max?: number },
): number
```

`coerceInt` returns `null` for invalid values; `assertInt` throws when coercion fails.

### withRetry

```ts
withRetry<T>(
  config: {
    retries: number
    baseDelayMs?: number
    maxDelayMs?: number
    backoff?: "linear" | "exponential" | ((attempt: number, error: unknown) => number)
    jitter?: boolean | number
    shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
  },
  fn: () => Promise<T>,
): Promise<T>
```

Retries transient/rate-limit failures by default. Use `shouldRetry` for explicit custom retry policy.

### AthenaOperationContext

```ts
type AthenaOperationContext = {
  table?: string
  operation?: string
  identity?: string | Record<string, unknown>
}
```

Attach context to helper-thrown errors for clearer logs and diagnostics.

---

## useAthenaGateway

```ts
import { useAthenaGateway } from "@xylex-group/athena/react";

const result = useAthenaGateway(config?: AthenaGatewayHookConfig): AthenaGatewayHookResult
```

React hook that wraps the Athena gateway client with React state for loading, error, and request/response logging. Requires React >=17.

**Config** (`AthenaGatewayHookConfig`)

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | Gateway server URL |
| `apiKey` | `string` | API key for Athena gateway authentication |
| `headers` | `Record<string, string>` | Extra headers added to every request |
| `userId` | `string \| null` | Sent as `X-User-Id` |
| `organizationId` | `string \| null` | Sent as `X-Organization-Id` |
| `publishEvent` | `string` | Sent as `X-Publish-Event` |
| `client` | `string` | Sent as `x-athena-client` (default `"railway_direct"`) |

**Returns** (`AthenaGatewayHookResult`)

| Property | Type | Description |
|----------|------|-------------|
| `fetchGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | execute a fetch query |
| `insertGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | insert rows |
| `updateGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | update rows |
| `deleteGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | delete a row |
| `rpcGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | execute RPC |
| `isLoading` | `boolean` | `true` while a request is in flight |
| `error` | `string \| null` | error message from the most recent request, or `null` |
| `lastRequest` | `AthenaGatewayCallLog \| null` | metadata about the most recent request |
| `lastResponse` | `AthenaGatewayResponseLog \| null` | response from the most recent request |
| `baseUrl` | `string` | resolved base URL of the client |

`insertGateway`, `updateGateway`, `deleteGateway`, and `rpcGateway` throw on non-OK responses. Wrap them in `try/catch` or handle rejection in `.catch()`.

---

## AthenaGatewayCallOptions

Options for builder methods (`.select()`, `.insert()`, etc.) and the React hook. `createClient` only accepts `client`, `headers`, and `backend`.

The SDK automatically includes a standard identification header on every request:

- `X-Athena-Sdk: xylex-group/athena <version>`

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | override the base URL for this call |
| `apiKey` | `string` | override the API key for this call |
| `client` | `string` | value for the `x-athena-client` header |
| `stripNulls` | `boolean` | strip null fields from the response (default `true`) |
| `headers` | `Record<string, string>` | additional request headers |
| `userId` | `string \| null` | `X-User-Id` header |
| `organizationId` | `string \| null` | `X-Organization-Id` header |
| `publishEvent` | `string` | `X-Publish-Event` header |
| `count` | `"exact" \| "planned" \| "estimated"` | request a row count |
| `head` | `boolean` | return response headers only, no rows |
| `defaultToNull` | `boolean` | write explicit `null` for missing fields (insert / upsert) |
| `onConflict` | `string \| string[]` | conflict resolution column(s) for upsert |
| `updateBody` | `Record<string, unknown>` | fields to update on conflict (upsert) |

---

## AthenaRpcCallOptions

RPC call options accepted by `athena.rpc(..., options)` and `.select/.single/.maybeSingle` on `RpcQueryBuilder`.

| Option | Type | Description |
|--------|------|-------------|
| all `AthenaGatewayCallOptions` | inherited | base URL, headers, client, auth, etc. |
| `schema` | `string` | schema used for RPC execution |
| `count` | `"exact" \| "planned" \| "estimated"` | row count strategy for set-returning functions |
| `head` | `boolean` | request metadata without returning rows (when backend supports it) |
| `get` | `boolean` | call RPC through compatibility `GET /rpc/{function_name}` route |

---

## Gateway payload types

These are the raw payload shapes sent to the Athena gateway. The query builder constructs them automatically; you only need these if you are using the React hook directly.

### AthenaFetchPayload

```ts
type AthenaSortDirection = "ascending" | "descending"

interface AthenaSortBy {
  field: string
  direction: AthenaSortDirection
}

interface AthenaFetchPayload {
  table_name?: string
  view_name?: string
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

### AthenaInsertPayload

```ts
interface AthenaInsertPayload {
  table_name: string
  insert_body: Record<string, unknown> | Record<string, unknown>[]
  update_body?: Record<string, unknown>   // used for upsert
  columns?: string[] | string
  count?: AthenaCountOption
  head?: boolean
  default_to_null?: boolean
  on_conflict?: string | string[]
}
```

### AthenaUpdatePayload

Extends `AthenaFetchPayload` with:

```ts
interface AthenaUpdatePayload extends AthenaFetchPayload {
  update_body?: Record<string, unknown>
}
```

### AthenaDeletePayload

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

### AthenaRpcPayload

```ts
interface AthenaRpcPayload {
  function: string
  schema?: string
  args?: Record<string, unknown>
  select?: string
  filters?: AthenaRpcFilter[]
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  limit?: number
  offset?: number
  order?: AthenaRpcOrder
}
```

### AthenaRpcFilter

```ts
type AthenaRpcFilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "in"

interface AthenaRpcFilter {
  column: string
  operator: AthenaRpcFilterOperator
  value?: string | number | boolean | null | Array<string | number | boolean | null>
}
```

### AthenaRpcOrder

```ts
interface AthenaRpcOrder {
  column: string
  ascending?: boolean
}
```

### AthenaGatewayCondition

```ts
interface AthenaGatewayCondition {
  column?: string
  operator: AthenaConditionOperator
  value?: string | number | boolean | null | Array<string | number | boolean | null>
  value_cast?: string
  column_cast?: string
  eq_column?: string
  eq_value?: string | number | boolean | null | Array<string | number | boolean | null>
  eq_value_cast?: string
  eq_column_cast?: string
}
```

`AthenaConditionOperator` is one of: `"eq"`, `"neq"`, `"gt"`, `"gte"`, `"lt"`, `"lte"`, `"like"`, `"ilike"`, `"is"`, `"in"`, `"contains"`, `"containedBy"`, `"not"`, `"or"`.

---

## AthenaGatewayResponse

The raw response object returned by all hook gateway functions and the internal client:

```ts
interface AthenaGatewayResponse<T = unknown> {
  ok: boolean        // true when HTTP status is 2xx
  status: number     // HTTP status code
  data: T | null     // parsed response body, null on error
  count?: number | null // optional count (RPC exact count)
  error?: string     // error message extracted from the response
  errorDetails?: AthenaGatewayErrorDetails | null // structured gateway failure details
  raw: unknown       // unprocessed parsed body
}
```

`AthenaGatewayResponseLog` extends this with a `timestamp: string` field (ISO 8601).

---

## AthenaGatewayErrorDetails

Structured failure metadata attached to `AthenaGatewayResponse.errorDetails` and `AthenaResult.errorDetails`.

```ts
type AthenaGatewayErrorCode = "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_JSON" | "UNKNOWN_ERROR"

interface AthenaGatewayErrorDetails {
  code: AthenaGatewayErrorCode
  message: string
  status: number
  endpoint?: "/gateway/fetch" | "/gateway/insert" | "/gateway/update" | "/gateway/delete" | "/gateway/rpc"
  method?: "POST" | "PUT" | "DELETE"
  requestId?: string
  hint?: string
  cause?: string
}
```

The package also exports:
- `AthenaGatewayError` (typed exception class)
- `isAthenaGatewayError(value)` (type guard)

---

## AthenaGatewayCallLog

Recorded for every request made through the hook:

```ts
interface AthenaGatewayCallLog {
  endpoint: "/gateway/fetch" | "/gateway/insert" | "/gateway/update" | "/gateway/delete" | "/gateway/rpc"
  method: "POST" | "PUT" | "DELETE"
  payload: unknown
  headers: Record<string, string>
  timestamp: string  // ISO 8601
}
```
