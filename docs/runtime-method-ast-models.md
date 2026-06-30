# Runtime Method AST Models And Transport Contracts

This page documents the normalized request models behind the runtime data methods in `@xylex-group/athena`.

The goal is not to invent a second public API. The goal is to show, method by method, what the SDK actually builds in memory, what route it eventually hits, and what payload shape it emits.

If you want only the object-select read model, use [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md).
If you want exact public signatures, use [`api-reference.md`](api-reference.md).
If you want the generated one-line method catalog, use [`complete-method-reference.md`](complete-method-reference.md).

## Version baseline for this page

- SDK baseline: `@xylex-group/athena` `2.4.0`, read from local `package.json` on 2026-06-07.
- This page reflects the current SDK implementation in `src/client.ts`, `src/query-transport.ts`, `src/gateway/client.ts`, and `src/gateway/types.ts`.

## Scope

This page covers the runtime data-plane methods:

- `createClient(...)`
- `AthenaClient.builder()`
- `AthenaClient.fromEnvironment()`
- `from(...)`
- table-builder filter methods
- `select(...)`
- `single(...)`
- `maybeSingle(...)`
- `findMany(...)`
- `insert(...)`
- `upsert(...)`
- `update(...)`
- `delete(...)`
- `rpc(...)`
- `query(...)`
- `db.*` aliases
- `verifyConnection(...)`

This page does not model `client.auth.*`.
Those methods are HTTP auth bindings, not gateway query AST builders.

## One-screen mental model

There are five distinct internal model families:

1. A client-config AST for `createClient(...)` and `AthenaClient.builder()`.
2. A table-builder state AST for `from(...)`, filters, pagination, and ordering.
3. A read transport plan AST that decides between `/gateway/fetch` and `/gateway/query`.
4. Mutation payload ASTs for insert/upsert/update/delete.
5. RPC and raw SQL payload ASTs for `rpc(...)` and `query(...)`.

## Method family map

| Public method family | Internal model root | Primary route(s) |
|---|---|---|
| `createClient(...)` | `AthenaClientConfig`-shaped config object | none directly |
| `AthenaClient.builder()` | mutable builder config state | none directly |
| `from(...)` | `TableBuilderState` | none directly |
| fluent table filters | `TableBuilderState.conditions`, `limit`, `offset`, `order`, paging fields | none directly |
| `.select(...)` / `.single(...)` / `.maybeSingle(...)` | `AthenaSelectTransportPlan` | `/gateway/fetch` or `/gateway/query` |
| `.findMany(...)` | object select AST + compiled `TableBuilderState` | `/gateway/fetch` or `/gateway/query` |
| `.insert(...)` / `.upsert(...)` | `AthenaInsertPayload` | `/gateway/insert` |
| `.update(...)` | `AthenaUpdatePayload` | `/gateway/update` |
| `.delete(...)` | `AthenaDeletePayload` | `/gateway/delete` |
| `rpc(...)` | RPC builder state + `AthenaRpcPayload` | `/gateway/rpc` or `GET /rpc/{fn}` |
| `query(...)` | `AthenaQueryPayload` | `/gateway/query` |
| `verifyConnection(...)` | connection probe request | `GET <baseUrl>/<path>` |

## Shared building blocks

These are the core shapes reused across method families.

### Client config AST

Both `createClient(...)` and `AthenaClient.builder().build()` end up materializing the same config shape:

```ts
interface AthenaClientConfigAst {
  baseUrl: string
  apiKey: string
  athenaKey?: string | null
  pgUri?: string | null
  jdbcUrl?: string | null
  client?: string
  userId?: string | null
  organizationId?: string | null
  backend?: BackendConfig
  headers?: Record<string, string>
  auth?: AthenaAuthClientConfig
  forceNoCache?: boolean
  experimental?: AthenaClientExperimentalOptions
}
```

Builder methods `.athenaKey(...)`, `.pgUri(...)`, and `.jdbcUrl(...)` populate the same fields before `build()`.

For header precedence and per-call override examples, see [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md).

When `experimental.debugAst` is enabled, executed runtime methods also attach a normalized per-operation debug AST to the returned `AthenaResult`. If `experimental.traceQueries` is enabled too, that same AST is emitted on the trace event for the operation.

This is then split into:

- a gateway client
- an auth client
- a `db` alias module
- top-level `from(...)`, `rpc(...)`, `query(...)`, and `verifyConnection(...)` methods

### Table builder state AST

Every `from(...)` chain starts from the same mutable state object:

```ts
interface TableBuilderStateAst {
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  order?: AthenaSortBy
  currentPage?: number
  pageSize?: number
  totalPages?: number
}
```

This state is what fluent methods mutate before execution.

### Shared condition node

Most table filters eventually become `AthenaGatewayCondition` entries:

```ts
interface AthenaGatewayCondition {
  column?: string
  operator:
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
    | "or"
  value?: string | number | boolean | null | Array<string | number | boolean | null> | string
  value_cast?: string
  column_cast?: string
  eq_column?: string
  eq_value?: unknown
  eq_value_cast?: string
  eq_column_cast?: string
}
```

Two important details:

- `eq` stores both the modern generic fields and the legacy `eq_*` compatibility fields.
- `not` and `or` use string expressions in the plain fluent builder, while `findMany(...)` additionally supports a stricter object AST form.

### Shared sort node

```ts
interface AthenaSortBy {
  field: string
  direction: "ascending" | "descending"
}
```

### Core wire payload families

```ts
interface AthenaFetchPayload {
  table_name?: string
  columns?: string | string[]
  select?: string | Record<string, unknown>
  where?: Record<string, unknown>
  conditions?: AthenaGatewayCondition[]
  sort_by?: AthenaSortBy
  orderBy?: Record<string, unknown> | unknown[]
  limit?: number
  offset?: number
  current_page?: number
  page_size?: number
  total_pages?: number
  strip_nulls?: boolean
  count?: "exact" | "planned" | "estimated"
  head?: boolean
}

interface AthenaInsertPayload {
  table_name: string
  insert_body: Record<string, unknown> | Array<Record<string, unknown>>
  update_body?: Record<string, unknown>
  columns?: string | string[]
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  default_to_null?: boolean
  on_conflict?: string | string[]
}

interface AthenaUpdatePayload {
  table_name: string
  set?: Record<string, unknown>
  conditions?: AthenaGatewayCondition[]
  sort_by?: AthenaSortBy
  current_page?: number
  page_size?: number
  total_pages?: number
  columns?: string | string[]
  strip_nulls?: boolean
}

interface AthenaDeletePayload {
  table_name: string
  resource_id?: string
  conditions?: AthenaGatewayCondition[]
  sort_by?: AthenaSortBy
  current_page?: number
  page_size?: number
  total_pages?: number
  columns?: string | string[]
}

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
  order?: {
    column: string
    ascending?: boolean
  }
}

interface AthenaQueryPayload {
  query: string
}
```

## 1. `createClient(url, apiKey, options?)`

### Public role

`createClient(...)` is the convenience constructor.

### Internal AST model

It immediately normalizes into the client config AST:

```ts
const configAst = {
  baseUrl: url,
  apiKey,
  client: options?.client,
  backend: toBackendConfig(options?.backend),
  headers: options?.headers,
  auth: options?.auth,
  experimental: options?.experimental,
}
```

### Important normalization

- `backend` is normalized into a full `BackendConfig`.
- `auth.bearerToken`, when present, is also mirrored into gateway defaults as `X-Athena-Auth-Bearer-Token` unless that header is already explicitly set.
- `headers` remain the root place where caller-supplied gateway headers are preserved.

### Transport

None directly.
This method only builds the root client graph.

## 2. `AthenaClient.builder()`

### Public role

`AthenaClient.builder()` is the explicit mutable constructor surface.

### Builder AST model

The builder maintains this evolving config state:

```ts
interface AthenaClientBuilderAst {
  baseUrl?: string
  apiKey?: string
  backendConfig: BackendConfig
  clientName?: string
  defaultHeaders?: Record<string, string>
  authConfig?: AthenaAuthClientConfig
  experimentalOptions?: AthenaClientExperimentalOptions
}
```

### Builder method semantics

#### `.url(url)`

Sets `baseUrl`.

#### `.key(apiKey)`

Sets `apiKey`.

#### `.backend(backend)`

Normalizes a shorthand backend string or config object into `backendConfig`.

#### `.client(clientName)`

Sets the default `X-Athena-Client` source.

#### `.headers(headers)`

Replaces the builder-level default header map.

#### `.auth(config)`

Merges auth config into the existing auth config AST.

#### `.experimental(options)`

Merges experimental runtime flags into the existing experimental config AST.

#### `.options(options)`

Applies a `createClient(...)`-style options object onto the builder AST.
This is a merge step, not a separate transport model.

#### `.build()`

Validates that `url` and `key` exist, then materializes the same client config AST used by `createClient(...)`.

## 3. `AthenaClient.fromEnvironment()`

### Public role

Ops-friendly constructor that reads environment variables and then delegates into the builder path.

### Internal AST model

```ts
const url = process.env.ATHENA_URL ?? process.env.ATHENA_GATEWAY_URL
const key = process.env.ATHENA_API_KEY ?? process.env.ATHENA_GATEWAY_API_KEY
```

It then behaves like:

```ts
AthenaClient.builder().url(url).key(key).build()
```

### Transport

None directly.

## 4. `from(table, options?)`

### Public role

`from(...)` creates a table-scoped fluent builder.

### Root AST model

```ts
interface FromAst {
  tableName: string
  fromOptions?: {
    schema?: string
  }
  state: TableBuilderStateAst
}
```

The initial state is always:

```ts
{
  conditions: []
}
```

### Schema behavior

`from("users", { schema: "auth" })` does not execute anything by itself.
The schema is only resolved when a concrete method executes and the final table name is built.

### Transport

None directly.

## 5. Fluent table filter methods

These methods mutate `TableBuilderStateAst`.

### Equality-family methods

#### `.eq(column, value)`

Adds:

```ts
{
  operator: "eq",
  column,
  value,
  eq_column: column,
  eq_value: value
}
```

If the SDK detects a UUID-like text comparison that should fall back to SQL query transport, it also adds:

```ts
{
  column_cast: "text"
}
```

#### `.eqCast(column, value, cast)`

Adds an `eq` condition plus `value_cast`.

#### `.eqUuid(column, value)`

Adds an `eq` condition plus `value_cast: "uuid"`.

#### `.match(record)`

Expands a record into multiple `eq` conditions.

### Comparison and pattern methods

These append one condition each:

- `.gt(...)`
- `.gte(...)`
- `.lt(...)`
- `.lte(...)`
- `.neq(...)`
- `.like(...)`
- `.ilike(...)`
- `.is(...)`
- `.in(...)`
- `.contains(...)`
- `.containedBy(...)`

Example:

```ts
athena
  .from("orders")
  .gte("created_at", "2026-01-01")
  .lt("created_at", "2027-01-01")
```

becomes:

```ts
{
  conditions: [
    { operator: "gte", column: "created_at", value: "2026-01-01" },
    { operator: "lt", column: "created_at", value: "2027-01-01" },
  ]
}
```

### Boolean-expression methods

#### `.not(columnOrExpression, operator?, value?)`

This method uses a string-backed expression model in the plain fluent builder.

Examples:

```ts
.not("status", "eq", "closed")
```

becomes:

```ts
{
  operator: "not",
  value: "status.eq.closed"
}
```

and:

```ts
.not("status.eq.closed")
```

becomes:

```ts
{
  operator: "not",
  value: "status.eq.closed"
}
```

#### `.or(expression)`

Adds:

```ts
{
  operator: "or",
  value: expression
}
```

### Pagination and ordering methods

These mutate dedicated state fields rather than appending `conditions`.

#### `.order(column, { ascending? })`

Sets:

```ts
state.order = {
  field: column,
  direction: ascending === false ? "descending" : "ascending",
}
```

Only the last `.order(...)` wins.

#### `.limit(count)`

Sets `state.limit`.

#### `.offset(count)`

Sets `state.offset`.

#### `.range(from, to)`

Sets:

```ts
state.offset = from
state.limit = to - from + 1
```

#### `.currentPage(value)`, `.pageSize(value)`, `.totalPages(value)`

Set those paging fields directly.
They are preserved into fetch/update/delete payloads and can also be converted into `limit` and `offset` during select/query planning.

## 6. `.reset()`

### Public role

Clears the table-builder state AST in place.

### Internal effect

It resets:

- `conditions`
- `limit`
- `offset`
- `order`
- `currentPage`
- `pageSize`
- `totalPages`

### Transport

None directly.

## 7. `.select(columns?, options?)`

### Public role

Creates a deferred read chain.

### Internal AST model

`select(...)` does not execute immediately.
It creates a `SelectChain` that closes over:

- the current table name
- the selected columns
- current options
- a snapshot of the current table-builder state at execution time

### Execution plan AST

When the chain is awaited, the SDK builds:

```ts
type AthenaSelectTransportPlan =
  | {
      kind: "query"
      query: string
      payload: { query: string }
    }
  | {
      kind: "fetch"
      payload: AthenaFetchPayload
      debug: {
        columns: string | string[]
        conditions?: AthenaGatewayCondition[]
        limit?: number
        offset?: number
        order?: AthenaSortBy
      }
    }
```

### Default fetch payload shape

The common route is `POST /gateway/fetch` with:

```ts
{
  table_name: resolvedTableName,
  columns,
  conditions,
  sort_by,
  limit,
  offset,
  current_page,
  page_size,
  total_pages,
  strip_nulls,
  count,
  head
}
```

### Structured select transport

If the select string includes schema-qualified nested relation tokens such as:

```ts
profiles("auth.users"(id,email))
```

the SDK can switch to a structured `/gateway/fetch` payload:

```ts
{
  table_name,
  select: "profiles(\"auth.users\"(id,email))",
  where,
  orderBy,
  limit,
  offset,
  strip_nulls
}
```

This path is intentionally narrower than the normal fetch payload.
It only accepts a subset of filters and does not currently support `count` or `head`.

### SQL query fallback

If the read contains cast-aware equality comparisons that need lossless SQL generation, the SDK can instead synthesize:

```ts
{
  query: "SELECT ... FROM ... WHERE ..."
}
```

and send it to `POST /gateway/query`.

This is still the same `.select(...)` public API.
Only the transport plan changes.

### `.single(...)` and `.maybeSingle(...)` on a select chain

These are post-processing wrappers over the same read plan.

They do not define a new wire model.
They simply collapse:

```ts
AthenaResult<Row[]>
```

into:

```ts
AthenaResult<Row | null>
```

by returning the first row or `null`.

## 8. Top-level `.single(...)` and `.maybeSingle(...)` on `from(...)`

These methods are direct convenience forms of `select(...)`.

Conceptually:

```ts
athena.from("users").single("id,email")
```

is a thin wrapper around:

```ts
athena.from("users").select("id,email").single()
```

The same select transport planner is used underneath.

## 9. `.findMany({ select, where, orderBy, limit })`

### Public role

This is the object-AST eager read surface.

### Method AST model

The public AST is:

```ts
interface AthenaFindManyAst<Row, TSelect> {
  select: TSelect
  where?: AthenaWhere<Row>
  orderBy?: AthenaOrderBy<Row>
  limit?: number
}
```

### Internal execution model

`findMany(...)` does four important things before transport selection:

1. Compiles the object `select` tree into a select string.
2. Compiles `where` into `AthenaGatewayCondition[]` for the legacy compatible path.
3. Compiles `orderBy` into `AthenaSortBy`.
4. Merges those compiled pieces with any existing builder state.

### Legacy-compatible compiled transport

The default path is still the compiled read transport:

```ts
{
  table_name: resolvedTableName,
  columns: compileSelectShape(select),
  conditions: compileWhere(where),
  sort_by: compileOrderBy(orderBy),
  limit
}
```

That payload then goes through the same select transport planner described above.

### Direct AST transport

If all of these are true:

- `experimental.findManyAst` is enabled
- the builder did not already accumulate fluent filter or paging state that cannot be represented losslessly
- the select tree does not use explicit relation `schema`
- the `where` tree does not require UUID/text query fallback

then the SDK can send a direct AST-style body to `POST /gateway/fetch`:

```ts
{
  table_name: resolvedTableName,
  select,
  where: normalizedWhere,
  orderBy,
  limit
}
```

That direct AST body is opt-in.
The default implementation remains compatibility-first.

### Boolean `where` notes

`findMany(...)` is the only runtime data method with a first-class boolean object AST.

Today:

- `where.or` is a non-empty array of single-column clauses when row keys are known
- `where.not` is a single-column clause with either primitive `eq` shorthand or exactly one lossless scalar operator expression

For the full deep dive, use [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md).

## 10. `.insert(values, options?)`

### Public role

Creates a deferred mutation query for one row or many rows.

### Payload AST model

Single-row insert:

```ts
{
  table_name: resolvedTableName,
  insert_body: record,
  columns?,
  count?,
  head?,
  default_to_null?
}
```

Batch insert:

```ts
{
  table_name: resolvedTableName,
  insert_body: [record, record, ...],
  columns?,
  count?,
  head?,
  default_to_null?
}
```

### Route

`POST /gateway/insert`

### Mutation-chain model

`insert(...)` returns a `MutationQuery`.
That mutation chain carries deferred selection state:

```ts
interface MutationSelectionAst {
  selectedColumns?: string | string[]
  selectedOptions?: AthenaGatewayCallOptions
}
```

By default, insert/upsert start with `*` as the default returning selection unless the caller overrides it.

### `.select(...)`, `.returning(...)`, `.single(...)`, `.maybeSingle(...)`

These do not change the route.
They only decorate the insert AST with selected columns and return-shape expectations.

## 11. `.upsert(values, options?)`

### Public role

Uses the insert route with extra conflict/update fields.

### Payload AST model

```ts
{
  table_name: resolvedTableName,
  insert_body,
  update_body?: options.updateBody,
  on_conflict?: options.onConflict,
  columns?,
  count?,
  head?,
  default_to_null?
}
```

### Route

`POST /gateway/insert`

### Important point

Upsert is not a separate wire endpoint in the SDK today.
It is an insert payload with upsert-specific fields.

## 12. `.update(values, options?)`

### Public role

Creates a deferred mutation chain whose filters can still be extended after `update(...)` is called.

### Internal model

The update executor snapshots `state.conditions` at execution time, not at method creation time.

That means this works as expected:

```ts
athena
  .from("users")
  .update({ role: "admin" })
  .eq("id", "user_1")
  .select("id,role")
```

### Payload AST model

```ts
{
  table_name: resolvedTableName,
  set: values,
  conditions,
  strip_nulls,
  sort_by?,
  current_page?,
  page_size?,
  total_pages?,
  columns?
}
```

### Route

`POST /gateway/update`

### Default returning behavior

Update does not start with `*` as a default returning selection.
You opt into columns by calling `.select(...)`, `.returning(...)`, `.single(...)`, or `.maybeSingle(...)`.

## 13. `.delete(options?)`

### Public role

Creates a deferred delete mutation query.

### Guard model

Delete refuses to execute unless one of these is already available:

- `options.resourceId`
- an existing `.eq("resource_id", ...)`
- an existing `.eq("id", ...)`
- any other existing filters, because filtered delete is allowed when conditions already exist

If neither `resourceId` nor filters are present, the SDK throws before network execution.

### Payload AST model

```ts
{
  table_name: resolvedTableName,
  resource_id?: resourceId,
  conditions?: filters,
  sort_by?,
  current_page?,
  page_size?,
  total_pages?,
  columns?
}
```

### Route

`POST /gateway/delete`

### Returning behavior

Delete, like update, has no default `*` returning selection.

## 14. `rpc(fn, args?, options?)`

### Public role

Creates a deferred RPC builder around a Postgres function call.

### Internal RPC state AST

```ts
interface RpcBuilderStateAst {
  functionName: string
  args?: Record<string, unknown>
  filters: AthenaRpcFilter[]
  limit?: number
  offset?: number
  order?: {
    column: string
    ascending?: boolean
  }
  selectedColumns?: string | string[]
  selectedOptions?: AthenaRpcCallOptions
}
```

### Base payload AST

```ts
{
  function: functionName,
  args,
  schema?: options.schema,
  select?: toRpcSelect(columns),
  filters?: state.filters,
  count?: options.count,
  head?: options.head,
  limit?: state.limit,
  offset?: state.offset,
  order?: state.order
}
```

### Default route

`POST /gateway/rpc`

### GET compatibility route

If `options.get === true`, the SDK uses:

```text
GET /rpc/{function_name}?...
```

The payload AST is flattened into query params:

- `schema`
- `select`
- `count`
- `head`
- `limit`
- `offset`
- `order`
- each RPC argument
- each RPC filter

Important current behavior:

- repeated same-column filters are preserved as repeated query params
- RPC GET rejects a filter when it conflicts with an argument of the same key

Example:

```ts
athena
  .rpc("list_orders", { status: "open" }, { get: true })
  .gte("created_at", "2026-01-01")
  .lt("created_at", "2027-01-01")
```

can produce query params like:

```text
/rpc/list_orders?status=open&created_at=gte.2026-01-01&created_at=lt.2027-01-01
```

### `.single(...)` and `.maybeSingle(...)`

These collapse the RPC result array the same way select-chain single helpers do.

## 15. `query(sql, options?)`

### Public role

Raw SQL execution path.

### Payload AST model

```ts
{
  query: normalizedQuery
}
```

where `normalizedQuery` is the trimmed non-empty SQL string.

### Route

`POST /gateway/query`

### Validation

If the trimmed query string is empty, the SDK throws before any network call.

## 16. `db.*` aliases

The `db` module is not a separate transport family.
It is a convenience alias layer over the same runtime methods.

### `db.from(table, options?)`

Equivalent to `client.from(table, options?)`.

### `db.select(table, columns?, options?)`

Equivalent to:

```ts
client.from(table).select(columns, options)
```

### `db.insert(table, values, options?)`

Equivalent to:

```ts
client.from(table).insert(values, options)
```

### `db.upsert(table, values, options?)`

Equivalent to:

```ts
client.from(table).upsert(values, options)
```

### `db.update(table, values, options?)`

Equivalent to:

```ts
client.from(table).update(values, options)
```

### `db.delete(table, options?)`

Equivalent to:

```ts
client.from(table).delete(options)
```

### `db.rpc(...)` and `db.query(...)`

Equivalent to the top-level `rpc(...)` and `query(...)` methods.

The AST and routes are identical.

## 17. `verifyConnection(options?)`

### Public role

Performs a lightweight GET probe against the resolved Athena base URL.

### Request model

```ts
interface ConnectionProbeAst {
  path?: `/${string}`
  headers?: Record<string, string>
  signal?: AbortSignal
}
```

### Route

This is not a gateway POST route.
It performs:

```text
GET <resolved-base-url><path>
```

with `/` as the default path.

### Header behavior

It merges the normal gateway base headers with probe-specific headers and ensures `X-Athena-Sdk` is present.

## 18. Header layer shared by executing methods

Every runtime data method that goes through the gateway client eventually runs through a shared header builder.

That header layer is orthogonal to the method ASTs above, but it is part of the final transport contract.

Shared behavior includes:

- `X-Athena-Sdk`
- `X-Athena-Client`
- backend headers
- `apikey` and `x-api-key`
- optional `X-User-Id`
- optional `X-Organization-Id`
- optional `X-Publish-Event`
- caller-supplied `headers`
- auth-context mirroring into:
  - `X-Athena-Auth-Session-Token`
  - `X-Athena-Auth-Bearer-Token`

For the full auth forwarding contract, use [`auth-session-forwarding.md`](auth-session-forwarding.md).

## 19. Practical examples by method

### `select(...)`

```ts
await athena
  .from("users")
  .eq("status", "active")
  .order("created_at", { ascending: false })
  .limit(20)
  .select("id,email,created_at")
```

Typical compiled fetch payload:

```json
{
  "table_name": "users",
  "columns": "id,email,created_at",
  "conditions": [
    { "operator": "eq", "column": "status", "value": "active", "eq_column": "status", "eq_value": "active" }
  ],
  "sort_by": { "field": "created_at", "direction": "descending" },
  "limit": 20,
  "strip_nulls": true
}
```

### `findMany(...)`

```ts
await athena.from("projects").findMany({
  select: {
    id: true,
    owner: {
      select: {
        id: true,
        email: true,
      },
    },
  },
  where: {
    status: { eq: "active" },
  },
  orderBy: {
    created_at: "desc",
  },
  limit: 10,
})
```

Typical compiled payload:

```json
{
  "table_name": "projects",
  "columns": "id,owner(id,email)",
  "conditions": [
    { "operator": "eq", "column": "status", "value": "active", "eq_column": "status", "eq_value": "active" }
  ],
  "sort_by": { "field": "created_at", "direction": "descending" },
  "limit": 10
}
```

### `insert(...)`

```ts
await athena.from("projects").insert({
  name: "Athena Docs",
  status: "active",
})
```

Typical payload:

```json
{
  "table_name": "projects",
  "insert_body": {
    "name": "Athena Docs",
    "status": "active"
  },
  "columns": "*"
}
```

### `update(...)`

```ts
await athena
  .from("projects")
  .update({ status: "archived" })
  .eq("id", "proj_1")
  .select("id,status")
```

Typical payload:

```json
{
  "table_name": "projects",
  "set": {
    "status": "archived"
  },
  "conditions": [
    { "operator": "eq", "column": "id", "value": "proj_1", "eq_column": "id", "eq_value": "proj_1" }
  ],
  "columns": "id,status",
  "strip_nulls": true
}
```

### `delete(...)`

```ts
await athena.from("projects").eq("id", "proj_1").delete()
```

Typical payload:

```json
{
  "table_name": "projects",
  "resource_id": "proj_1",
  "conditions": [
    { "operator": "eq", "column": "id", "value": "proj_1", "eq_column": "id", "eq_value": "proj_1" }
  ]
}
```

### `rpc(...)`

```ts
await athena
  .rpc("list_projects", { account_id: "acct_1" })
  .eq("status", "active")
  .order("created_at", { ascending: false })
  .limit(25)
  .select("id,name,status")
```

Typical payload:

```json
{
  "function": "list_projects",
  "args": {
    "account_id": "acct_1"
  },
  "select": "id,name,status",
  "filters": [
    { "column": "status", "operator": "eq", "value": "active" }
  ],
  "order": {
    "column": "created_at",
    "ascending": false
  },
  "limit": 25
}
```

### `query(...)`

```ts
await athena.query("select id, email from users where active = true")
```

Payload:

```json
{
  "query": "select id, email from users where active = true"
}
```

## 20. What to use when

- Use `findMany(...)` when you want a typed object-select AST and relation-aware response inference.
- Use `.select(...)` when you already have a stable select string or need compatibility with existing query grammar.
- Use `insert(...)`, `upsert(...)`, `update(...)`, and `delete(...)` when you want the SDK to keep using the gateway mutation routes.
- Use `rpc(...)` when the server contract is a function call rather than a table operation.
- Use `query(...)` when the shape cannot be expressed losslessly through the builder models.

## Related docs

- [`getting-started.md`](getting-started.md)
- [`api-reference.md`](api-reference.md)
- [`complete-method-reference.md`](complete-method-reference.md)
- [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md)
- [`auth-session-forwarding.md`](auth-session-forwarding.md)
