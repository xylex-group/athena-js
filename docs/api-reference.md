# API reference

Complete reference for every export in `@xylex-group/athena`.

## createClient

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(url: string, apiKey: string, options?: AthenaGatewayCallOptions): SupabaseClient
```

Creates and returns a `SupabaseClient` bound to the given URL and API key. All requests use `url` as the base URL and send `apiKey` as the `apikey` and `x-api-key` headers.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Base URL of the Athena gateway server |
| `apiKey` | `string` | API key sent with every request |
| `options` | `AthenaGatewayCallOptions` | Default options applied to every request from this client |

**Returns** `SupabaseClient`

---

## SupabaseClient

```ts
interface SupabaseClient {
  from<Row = unknown>(table: string): TableQueryBuilder<Row>
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

---

## TableQueryBuilder

All filter methods return `this` so they can be chained. The query does not execute until `.select()`, `.insert()`, `.update()`, `.upsert()`, `.delete()`, `.single()`, or `.maybeSingle()` is called.

### .select

```ts
.select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T>>
```

Executes a fetch query and resolves to a `SupabaseResult`. Defaults to `"*"` (all columns) when `columns` is omitted.

```ts
const { data } = await athena.from("users").select();
const { data } = await athena.from("users").select("id, name");
const { data } = await athena.from("users").select(["id", "name"]);
```

### .single

```ts
.single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<SupabaseResult<T | null>>
```

Executes `.select()` and returns `data` as a single object (the first element of the result array) instead of an array. Returns `null` when there are no results.

### .maybeSingle

Alias for `.single()`. Identical behavior.

### .insert

```ts
.insert(values: Row | Row[], options?: AthenaGatewayCallOptions): MutationQuery<Row | Row[]>
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
  values: Row | Row[],
  options?: AthenaGatewayCallOptions & {
    updateBody?: Partial<Row>
    onConflict?: string | string[]
  },
): MutationQuery<Row | Row[]>
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

### Modifier methods

| Method | Description |
|--------|-------------|
| `.limit(count)` | maximum number of rows to return |
| `.offset(count)` | number of rows to skip |
| `.range(from, to)` | shorthand for `.offset(from).limit(to - from + 1)` |
| `.reset()` | clears all accumulated conditions, limit, and offset |

---

## MutationQuery

`insert`, `update`, `upsert`, and `delete` all return a `MutationQuery`. It is a thenable — you can `await` it, `.then()` it, or chain one of the methods below. The HTTP request fires exactly once.

```ts
interface MutationQuery<Result> extends PromiseLike<SupabaseResult<Result>> {
  select(columns?, options?): Promise<SupabaseResult<Result>>
  returning(columns?, options?): Promise<SupabaseResult<Result>>
  single(columns?, options?): Promise<SupabaseResult<MutationSingleResult<Result>>>
  maybeSingle(columns?, options?): Promise<SupabaseResult<MutationSingleResult<Result>>>
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

## SupabaseResult

Every query and mutation resolves to:

```ts
interface SupabaseResult<T> {
  data: T | null      // response payload, null on error
  error: string | null // error message, null on success
  status: number       // HTTP status code
  raw: unknown         // unprocessed response body
}
```

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
| `apiKey` | `string` | API key for all requests |
| `stripNulls` | `boolean` | Strip null values from responses (default `true`) |
| `headers` | `Record<string, string>` | Extra headers added to every request |
| `userId` | `string \| null` | Sent as `X-User-Id` |
| `companyId` | `string \| null` | Sent as `X-Company-Id` |
| `organizationId` | `string \| null` | Sent as `X-Organization-Id` |
| `supabaseUrl` | `string` | Sent as `x-supabase-url` |
| `supabaseKey` | `string` | Sent as `x-supabase-key` |
| `publishEvent` | `string` | Sent as `X-Publish-Event` |
| `client` | `string` | Sent as `X-Athena-Client` (default `"railway_direct"`) |

**Returns** (`AthenaGatewayHookResult`)

| Property | Type | Description |
|----------|------|-------------|
| `fetchGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | execute a fetch query |
| `insertGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | insert rows |
| `updateGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | update rows |
| `deleteGateway` | `(payload, options?) => Promise<AthenaGatewayResponse>` | delete a row |
| `isLoading` | `boolean` | `true` while a request is in flight |
| `error` | `string \| null` | error message from the most recent request, or `null` |
| `lastRequest` | `AthenaGatewayCallLog \| null` | metadata about the most recent request |
| `lastResponse` | `AthenaGatewayResponseLog \| null` | response from the most recent request |
| `baseUrl` | `string` | resolved base URL of the client |

`insertGateway`, `updateGateway`, and `deleteGateway` throw on non-OK responses. Wrap them in `try/catch` or handle rejection in `.catch()`.

---

## AthenaGatewayCallOptions

Options that can be passed to `createClient`, any builder method, or any hook gateway function:

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | override the base URL for this call |
| `apiKey` | `string` | override the API key for this call |
| `client` | `string` | value for the `X-Athena-Client` header |
| `stripNulls` | `boolean` | strip null fields from the response (default `true`) |
| `headers` | `Record<string, string>` | additional request headers |
| `userId` | `string \| null` | `X-User-Id` header |
| `companyId` | `string \| null` | `X-Company-Id` header |
| `organizationId` | `string \| null` | `X-Organization-Id` header |
| `supabaseUrl` | `string` | `x-supabase-url` header |
| `supabaseKey` | `string` | `x-supabase-key` header |
| `publishEvent` | `string` | `X-Publish-Event` header |
| `count` | `"exact" \| "planned" \| "estimated"` | request a row count |
| `head` | `boolean` | return response headers only, no rows |
| `defaultToNull` | `boolean` | write explicit `null` for missing fields (insert / upsert) |
| `onConflict` | `string \| string[]` | conflict resolution column(s) for upsert |
| `updateBody` | `Record<string, unknown>` | fields to update on conflict (upsert) |

---

## Gateway payload types

These are the raw payload shapes sent to the Athena gateway. The query builder constructs them automatically; you only need these if you are using the React hook directly.

### AthenaFetchPayload

```ts
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
}
```

### AthenaGatewayCondition

```ts
interface AthenaGatewayCondition {
  column?: string
  operator: AthenaConditionOperator
  value?: string | number | boolean | null | Array<string | number | boolean | null>
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
  error?: string     // error message extracted from the response
  raw: unknown       // unprocessed parsed body
}
```

`AthenaGatewayResponseLog` extends this with a `timestamp: string` field (ISO 8601).

---

## AthenaGatewayCallLog

Recorded for every request made through the hook:

```ts
interface AthenaGatewayCallLog {
  endpoint: "/gateway/fetch" | "/gateway/insert" | "/gateway/update" | "/gateway/delete"
  method: "POST" | "PUT" | "DELETE"
  payload: unknown
  headers: Record<string, string>
  timestamp: string  // ISO 8601
}
```
