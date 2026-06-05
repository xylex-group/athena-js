# `findMany` AST And Athena Server Contract

This page explains the new canonical Athena read API:

```ts
const { data, error } = await athena.from("table").findMany({
  select: {
    column: true,
    relation: {
      select: {
        column: true,
      },
    },
  },
  where: {},
  orderBy: {},
  limit: 100,
});
```

It covers five things:

1. What "AST" means in this SDK.
2. How `findMany(...)` compiles and executes.
3. What new exported types and behaviors now exist.
4. What response and error shapes callers should expect.
5. What Athena server changes are actually required now vs. optional later.

## Version baselines for this page

- SDK baseline for all SDK examples on this page: `@xylex-group/athena` `2.4.0`, read from local `package.json` on 2026-06-05.
- Live Athena server baseline used for verification on this page: `3.12.3`, confirmed from `GET https://athena-cluster.com` on 2026-06-04.
- When an example needs something narrower than "normal `findMany` support", that narrower server requirement is called out in the compatibility matrix below.

## Example compatibility matrix

| Example | SDK version | Expected Athena server version | Notes |
|---|---|---|---|
| Canonical intro `athena.from("table").findMany(...)` | `2.4.0` | `3.12.3` verified target | Also works on older Athena servers if they already support `POST /gateway/fetch` with `columns`, `conditions`, `sort_by`, and `limit`. |
| Legacy string `.select("name,instruments(name)")` compatibility example | `2.4.0` | `3.12.3` verified target | No new server behavior required. |
| Simple scalar read | `2.4.0` | `3.12.3` verified target | Requires normal `POST /gateway/fetch`. |
| Nested relation read | `2.4.0` | `3.12.3` verified target | Requires existing nested select-string grammar like `instruments(name)`. |
| Aliased relation with `as` and `via` | `2.4.0` | `3.12.3` verified target | Requires existing alias/FK select grammar like `from:sender_id(name)`. |
| Filtering with scalar values and operators | `2.4.0` | `3.12.3` verified target | Requires current `conditions` operator support. |
| Boolean expressions with `or` and `not` | `2.4.0` | `3.12.3` verified target | Requires current gateway string-expression support for `or` and `not`. |
| Ordering with `orderBy` | `2.4.0` | `3.12.3` verified target | Requires current single `sort_by` payload support. |
| Typed registry `fromModel(...).findMany(...)` | `2.4.0` | `3.12.3` verified target | Stronger typing is SDK-only; server requirement is the same as ordinary `findMany`. |
| Plain `from<Row>(...).findMany(...)` | `2.4.0` | `3.12.3` verified target | Server requirement is the same as ordinary `findMany`; relation fallback behavior is SDK-only. |
| UUID text-comparison fallback | `2.4.0` | `3.12.3` verified target | Requires `POST /gateway/query` in addition to `POST /gateway/fetch`. |
| Query tracing example | `2.4.0` | `3.12.3` verified target | Trace emission is SDK-side; any server version that already satisfies the executed query example is fine. |

## Snapshot: live Athena server state on 2026-06-04

I checked the live cluster root with `GET https://athena-cluster.com` on 2026-06-04.

The cluster currently reports:

```json
{
  "message": "athena is online",
  "athena_api": "online",
  "version": "3.12.3",
  "cargo_toml_version": "3.12.3"
}
```

The live route listing also includes:

- `POST /gateway/fetch`
- `POST /gateway/query`
- `POST /gateway/rpc`
- `GET /openapi.yaml`

For `findMany`, the only runtime routes that matter today are:

- `POST /gateway/fetch`
- `POST /gateway/query`

No new Athena server route is required for the current `athena-js` implementation.

## What AST means here

AST means "abstract syntax tree".

In this SDK, that just means "an object tree that describes the query before we serialize it into the older gateway transport".

This:

```ts
const { data, error } = await athena.from("orchestral_sections").findMany({
  select: {
    name: true,
    instruments: {
      select: {
        name: true,
      },
    },
  },
});
```

is an AST-shaped query.

The SDK compiles it into the existing gateway select string:

```ts
"name,instruments(name)"
```

and then sends the old transport payload:

```json
{
  "table_name": "orchestral_sections",
  "columns": "name,instruments(name)"
}
```

That is the core design decision:

- the public client API becomes cleaner
- the existing Athena wire contract stays compatible
- the SDK can infer nested response types from the object tree

## Why `findMany(...)` exists

The older read surface is still valid:

```ts
await athena.from("orchestral_sections").select("name,instruments(name)");
```

But string selects have three problems:

1. They are harder to infer precisely in TypeScript.
2. They are easier to mistype.
3. They hide the structure that the caller actually means.

`findMany(...)` fixes that without breaking the old surface.

## New public surface

### New method

`TableQueryBuilder` now exposes:

```ts
findMany<const TSelect extends AthenaSelectShape>(
  options: AthenaFindManyOptions<Row, TSelect>,
): Promise<AthenaResult<Array<AthenaFindManyResult<Row, TSelect, Context>>>>
```

It is:

- additive
- eager
- promise-based
- read-only
- fully compatible with the existing `.select(...)` chain

### New exported AST types

The root package now exports:

- `AthenaFindManyOptions`
- `AthenaFindManyResult`
- `AthenaSelectShape`
- `AthenaRelationSelectNode`
- `AthenaWhere`
- `AthenaWhereBooleanOperand`
- `AthenaWhereOperatorInput`
- `AthenaOrderBy`

### Simplified shape of the new types

```ts
interface AthenaRelationSelectNode<TSelect extends AthenaSelectShape = AthenaSelectShape> {
  select: TSelect
  as?: string
  via?: string
  schema?: string
}

type AthenaSelectShape = Record<string, true | AthenaRelationSelectNode<any>>

type AthenaWhereOperatorInput = {
  eq?: string | number | boolean | null
  neq?: string | number | boolean | null
  gt?: string | number | boolean | null
  gte?: string | number | boolean | null
  lt?: string | number | boolean | null
  lte?: string | number | boolean | null
  like?: string | number | boolean | null
  ilike?: string | number | boolean | null
  is?: string | number | boolean | null
  in?: Array<string | number | boolean | null>
  contains?: Array<string | number | boolean | null>
  containedBy?: Array<string | number | boolean | null>
}

type AthenaWhere<Row> = Partial<
  Record<keyof Row & string, string | number | boolean | null | AthenaWhereOperatorInput>
> & {
  or?: Array<Partial<Record<keyof Row & string, string | number | boolean | null | AthenaWhereOperatorInput>>>
  not?: Partial<Record<keyof Row & string, string | number | boolean | null | AthenaWhereOperatorInput>>
}

type AthenaOrderBy<Row> =
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

When the base table is not in `public`, qualify it directly in `from(...)`. When a nested relation
table lives in another schema, set `schema` on that relation node:

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

## How `findMany(...)` works

At runtime, `findMany(...)` does six things.

### 1. Compile `select`

The SDK takes the object tree and converts it into the existing `columns` string.

Example:

```ts
{
  select: {
    name: true,
    instruments: {
      select: {
        name: true,
      },
    },
  },
}
```

becomes:

```ts
"name,instruments(name)"
```

### 2. Snapshot existing builder state

`findMany(...)` does not ignore prior fluent state.

This means:

```ts
await athena
  .from("orders")
  .eq("status", "open")
  .findMany({
    select: {
      id: true,
    },
  });
```

keeps the earlier `.eq("status", "open")` condition.

### 3. Compile `where`

`where` is converted into the existing `conditions` array.

This:

```ts
where: {
  customer_id: "cust_1",
  total: {
    gte: 100,
  },
}
```

becomes:

```json
[
  {
    "operator": "eq",
    "column": "customer_id",
    "value": "cust_1",
    "eq_column": "customer_id",
    "eq_value": "cust_1"
  },
  {
    "operator": "gte",
    "column": "total",
    "value": 100
  }
]
```

### 4. Compile `orderBy` and `limit`

`orderBy` becomes the existing `sort_by` object.

This:

```ts
orderBy: {
  created_at: "desc",
},
limit: 25,
```

becomes:

```json
{
  "sort_by": {
    "field": "created_at",
    "direction": "descending"
  },
  "limit": 25
}
```

### 5. Pick the gateway route

The normal route is:

```text
POST /gateway/fetch
```

There is one important fallback:

- if the SDK sees an `eq` comparison on a UUID-like identifier column with a UUID-looking string value
- it uses `POST /gateway/query`
- it emits SQL with `::text` comparison so the comparison remains deterministic

Example:

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same `POST /gateway/query` availability

```ts
await athena.from("form_sessions").findMany({
  select: {
    session_id: true,
  },
  where: {
    session_id: "550e8400-e29b-41d4-a716-446655440000",
  },
});
```

can compile into a `POST /gateway/query` request similar to:

```json
{
  "query": "SELECT \"session_id\" FROM \"form_sessions\" WHERE \"session_id\"::text = '550e8400-e29b-41d4-a716-446655440000'"
}
```

### 6. Normalize the gateway response

The SDK then normalizes the raw route response into:

```ts
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

For `findMany(...)`, that means:

```ts
type FindManyResult<T> = AthenaResult<T[]>
```

## The canonical examples

### 1. Simple scalar read

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same `POST /gateway/fetch` contract

```ts
const { data, error } = await athena.from("users").findMany({
  select: {
    id: true,
    email: true,
  },
});
```

Expected response shape:

```ts
type Result = Array<{
  id: string
  email: string
}>
```

### 2. Nested relation read

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same nested select-string support

```ts
const { data, error } = await athena.from("orchestral_sections").findMany({
  select: {
    name: true,
    instruments: {
      select: {
        name: true,
      },
    },
  },
});
```

Expected response shape:

```ts
type Result = Array<{
  name: string
  instruments: Array<{
    name: string
  }>
}>
```

### 3. Aliased relation with explicit join key

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same alias/FK select grammar support

```ts
const { data, error } = await athena.from("messages").findMany({
  select: {
    sender: {
      as: "from",
      via: "sender_id",
      select: {
        name: true,
      },
    },
  },
});
```

Compiled select string:

```ts
"from:sender_id(name)"
```

Expected response shape:

```ts
type Result = Array<{
  from: {
    name: string
  } | null
}>
```

### 4. Filtering with scalar values and operators

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same `conditions` operator support

```ts
const { data, error } = await athena.from("orders").findMany({
  select: {
    id: true,
    total: true,
  },
  where: {
    customer_id: "cust_1",
    total: {
      gte: 100,
    },
  },
});
```

Expected `conditions` payload:

```json
[
  {
    "operator": "eq",
    "column": "customer_id",
    "value": "cust_1",
    "eq_column": "customer_id",
    "eq_value": "cust_1"
  },
  {
    "operator": "gte",
    "column": "total",
    "value": 100
  }
]
```

### 5. Boolean expressions

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same `or`/`not` condition expression support

```ts
const { data, error } = await athena.from("orders").findMany({
  select: {
    id: true,
  },
  where: {
    or: [{ priority: "high" }, { priority: "urgent" }],
    not: {
      archived_at: {
        is: null,
      },
    },
  },
});
```

Expected `conditions` payload:

```json
[
  {
    "operator": "or",
    "value": "priority.eq.high,priority.eq.urgent"
  },
  {
    "operator": "not",
    "value": "archived_at.is.null"
  }
]
```

### 6. Ordering

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same single `sort_by` support

Object shorthand:

```ts
const { data, error } = await athena.from("orders").findMany({
  select: {
    id: true,
  },
  orderBy: {
    created_at: "desc",
  },
});
```

Explicit shape:

```ts
const { data, error } = await athena.from("orders").findMany({
  select: {
    id: true,
  },
  orderBy: {
    column: "created_at",
    ascending: false,
  },
});
```

Both compile to:

```json
{
  "field": "created_at",
  "direction": "descending"
}
```

### 7. Typed registry inference with `fromModel(...)`

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same `findMany` transport support
- Important note: the stronger nested relation inference here is an SDK feature, not a new server requirement

```ts
const result = await typedAthena
  .fromModel("primary", "public", "orchestral_sections")
  .findMany({
    select: {
      name: true,
      instruments: {
        select: {
          name: true,
        },
      },
    },
  });
```

Expected inferred row shape:

```ts
type Result = Array<{
  name: string
  instruments: Array<{
    name: string
  }>
}>
```

Relation typing rules are:

- `one-to-many` and `many-to-many` become arrays
- `one-to-one` and `many-to-one` become `T | null`
- relation names resolve through `meta.relations`
- `via` can disambiguate when relation names are not enough

### 8. Plain `from<Row>(...)` behavior

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or older Athena server with the same `findMany` transport support

```ts
type UserRow = {
  id: string
  email: string
  organization_id: string | null
}

const result = await athena.from<UserRow>("users").findMany({
  select: {
    id: true,
    email: true,
    organization: {
      select: {
        name: true,
      },
    },
  },
});

const authUsers = await athena.from<UserRow>("users", { schema: "auth" }).findMany({
  select: {
    id: true,
    email: true,
  },
});
```

On this plain runtime path:

- base scalar fields still infer from `UserRow`
- unresolved relation leaves fall back to `unknown`
- full nested relation inference is guaranteed on `fromModel(...)`, not on plain `from("table")`

## What changed in typing behavior

The important typing changes are:

1. `TableQueryBuilder` now carries a fourth generic for model context.
2. `TypedAthenaClient.fromModel(...)` now returns a metadata-aware builder.
3. `findMany(...)` can map relation keys to relation metadata when the builder came from `fromModel(...)`.

What did not change:

- `.select(...)` still works
- `SelectChain` still works
- `client.db.*` still works
- `athena.query(...)` still works
- `athena.rpc(...)` still works

## Implications for users

These are the practical implications of the new surface.

### Good implications

- the canonical API is easier to read
- nested selections are obvious at the callsite
- result inference is much stronger on typed registry paths
- old code does not need to be rewritten

### Important constraints

- `findMany(...)` is eager, unlike `.select(...)`
- `orderBy` only supports one column in v1
- `where.not` only supports shapes that can compile losslessly into the current gateway condition transport
- malformed AST input throws before network execution

## Error handling

There are now two distinct failure modes.

### 1. AST validation errors throw immediately

These never reach Athena.

Examples:

```ts
await athena.from("users").findMany({
  select: {},
});
```

throws:

```txt
findMany select requires at least one field
```

```ts
await athena.from("orders").findMany({
  select: {
    id: true,
  },
  where: {
    not: {
      status: {
        eq: "open",
        neq: "closed",
      },
    },
  },
});
```

throws:

```txt
findMany where.not only supports a single lossless operator expression
```

This is new behavior compared with many old string-based errors, because the SDK can now validate structure locally.

### 2. Gateway failures return normalized `AthenaResult.error`

Example:

```ts
const result = await athena.from("missing_table").findMany({
  select: {
    id: true,
  },
});

if (result.error) {
  console.error(result.error.message);
  console.error(result.error.status);
  console.error(result.error.endpoint);
}
```

Normalized error shape:

```ts
interface AthenaResultError {
  message: string
  code: string | null
  athenaCode: string
  gatewayCode?: string | null
  kind: string
  category: string
  retryable: boolean
  details: unknown | null
  hint: string | null
  status: number
  statusText: string | null
  constraint?: string
  table?: string
  operation?: string
  endpoint?: string
  method?: string
  requestId?: string
  cause?: string
  raw: unknown
}
```

Important notes:

- `experimental.enableErrorNormalization` is now a compatibility no-op
- failed results already expose normalized structured `error`
- query tracing can be enabled with `experimental.traceQueries`

### Example: trace output support

Compatibility:

- SDK version: `@xylex-group/athena` `2.4.0`
- Expected Athena server version: `3.12.3` verified target, or any Athena server version already compatible with the query being traced

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: {
    traceQueries: true,
  },
});
```

That emits:

- operation
- endpoint
- payload
- SQL
- outcome
- callsite

## The route contracts `findMany(...)` depends on today

`findMany(...)` only depends on the transport routes below.

### `GET /`

This is not required for normal reads, but it is the easiest live version probe.

Observed response subset on 2026-06-04:

```json
{
  "message": "athena is online",
  "athena_api": "online",
  "version": "3.12.3",
  "cargo_toml_version": "3.12.3",
  "routes": [
    {
      "methods": ["POST"],
      "path": "/gateway/fetch"
    },
    {
      "methods": ["POST"],
      "path": "/gateway/query"
    }
  ]
}
```

### `POST /gateway/fetch`

#### Request shape used by `findMany(...)`

```json
{
  "table_name": "orchestral_sections",
  "columns": "name,instruments(name)",
  "conditions": [
    {
      "operator": "eq",
      "column": "active",
      "value": true,
      "eq_column": "active",
      "eq_value": true
    }
  ],
  "sort_by": {
    "field": "name",
    "direction": "ascending"
  },
  "limit": 10
}
```

#### Live success shape observed on 2026-06-04

I probed `athena_logging` with a real fetch against `athena_clients`:

```json
{
  "cache_key": "3cc1e5592ff9d9437995251c439329167d2629bb53901990fa723086b7ed92f3",
  "data": [
    {
      "client_name": "athena_backup_test",
      "description": null
    }
  ],
  "message": "Fetched 1 rows",
  "status": "success"
}
```

#### Live error shape observed on 2026-06-04

Missing client header:

```json
{
  "code": "missing_client_header",
  "data": {
    "details": {
      "missing_header": "X-Athena-Client"
    },
    "operation": "fetch"
  },
  "error": "X-Athena-Client header is required and cannot be empty",
  "message": "Missing required header",
  "status": "error"
}
```

Table/column error:

```json
{
  "data": {
    "operation": "fetch"
  },
  "error": "Column 'base_url' does not exist in table 'athena_clients' ...",
  "message": "Failed to fetch data",
  "status": "error"
}
```

### `POST /gateway/query`

#### Request shape used by `findMany(...)` fallback

```json
{
  "query": "SELECT \"session_id\" FROM \"form_sessions\" WHERE \"session_id\"::text = '550e8400-e29b-41d4-a716-446655440000'"
}
```

#### Live success shape observed on 2026-06-04

```json
{
  "data": [
    {
      "one": 1
    }
  ],
  "message": "Query executed",
  "meta": {
    "backend": "sqlx",
    "returned_row_count": 1,
    "rows_affected": 0,
    "statement_count": 1
  },
  "status": "success"
}
```

#### Important runtime note

Malformed request bodies can still produce plain-text errors instead of a JSON envelope.

Example observed on 2026-06-04:

```txt
Json deserialize error: key must be a string at line 1 column 2
```

That matters because the SDK can normalize it, but the raw Athena server contract is not fully uniform yet.

## What the SDK expects from those routes

The low-level gateway client currently handles successful route responses correctly when either:

1. the raw response itself is a row array
2. the response is an object whose `data` field is the row array

That means all of these are acceptable:

### Object envelope with optional metadata

```json
{
  "data": [
    {
      "id": 1
    }
  ],
  "count": 1,
  "message": "Query executed"
}
```

### Object envelope with other siblings

```json
{
  "status": "success",
  "message": "Fetched 1 rows",
  "cache_key": "abc123",
  "data": [
    {
      "id": 1
    }
  ]
}
```

### Raw array

```json
[
  {
    "id": 1
  }
]
```

Then `athena-js` converts that into:

```json
{
  "data": [
    {
      "id": 1
    }
  ],
  "error": null,
  "status": 200,
  "count": 1,
  "raw": {
    "data": [
      {
        "id": 1
      }
    ],
    "count": 1
  }
}
```

For `findMany(...)`, the final `data` field should be an array of selected rows.

## Important live mismatch: OpenAPI vs. live server

The live OpenAPI at `https://athena-cluster.com/openapi.yaml` currently documents `POST /gateway/fetch` and `POST /gateway/query` success examples like this:

```json
{
  "status": "success",
  "message": "Fetched 25 rows",
  "data": {
    "rows": [],
    "row_count": 25
  }
}
```

But the live probes on 2026-06-04 returned:

- `fetch`: `data: Row[]` plus `cache_key`
- `query`: `data: Row[]` plus `meta`

That discrepancy matters.

If Athena server really returned `data.rows` on those routes, the current SDK would not unwrap it into `AthenaResult<T[]>` correctly.

So the first server-side action item is not a new route. It is contract cleanup:

1. make the OpenAPI examples match the live route payloads
2. keep the live route payloads stable
3. keep `data` as the row array for `fetch` and `query`

## What needs to change on Athena server right now

### Required now for `athena-js findMany(...)` to work

Nothing new is required if Athena server already provides:

1. `POST /gateway/fetch` with `table_name`, `columns`, `conditions`, `sort_by`, and `limit`
2. `POST /gateway/query` for the UUID text-comparison fallback
3. the existing nested select-string grammar such as `instruments(name)` and `from:sender_id(name)`

That is why the SDK implementation is described as AST compatibility, not AST transport.

## What should be changed on Athena server next

These are the recommended server tasks, in order.

### Priority 1: fix published contract accuracy

1. Update `openapi.yaml` examples for `POST /gateway/fetch` and `POST /gateway/query`.
2. Document `cache_key` on fetch success.
3. Document `meta` on query success.
4. Document the actual JSON error envelope fields now emitted by fetch failures.

### Priority 2: standardize error envelopes

Today:

- fetch errors are structured JSON
- malformed query bodies can still return plain text

The server should normalize all gateway errors to one JSON envelope shape:

```json
{
  "status": "error",
  "message": "Human summary",
  "error": "Detailed message",
  "code": "machine_code",
  "data": {
    "operation": "query"
  }
}
```

That reduces special handling and makes the raw Athena contract more predictable for every client, not just `athena-js`.

### Priority 3: add server contract tests for the select-string grammar that powers `findMany(...)`

The server should have explicit tests for:

1. scalar selects like `id,name`
2. nested relation selects like `name,instruments(name)`
3. aliased join-path selects like `from:sender_id(name)`
4. sort and limit handling
5. parity between `/gateway/fetch` and `/gateway/query` result row shapes

### Priority 4: optionally add first-class AST support later

This is optional, not required for v1.

`athena-js` now exposes an opt-in `createClient(..., { experimental: { findManyAst: true } })` path for gateways that explicitly support direct AST bodies, but the default SDK transport still stays on the compiled `columns`/`conditions` contract described above.

When this flag is enabled today:

- shorthand `where` values like `{ status: "open" }` are normalized to explicit operator objects before `/gateway/fetch`
- UUID-like equality filters that need the SDK's `::text` comparison still fall back to the legacy compiled/query path
- nested relation select strings stay on `/gateway/fetch` and do not use the SQL query fallback

If Athena server later wants to accept AST directly, the clean shape would be something like:

```json
{
  "table_name": "orchestral_sections",
  "select": {
    "name": true,
    "instruments": {
      "select": {
        "name": true
      }
    }
  },
  "where": {
    "active": true
  },
  "orderBy": {
    "name": "asc"
  },
  "limit": 10
}
```

and the response should still normalize to:

```json
{
  "data": [
    {
      "name": "Strings",
      "instruments": [
        {
          "name": "Violin"
        }
      ]
    }
  ],
  "count": 1
}
```

If Athena server adds that later, it should expose a capability flag at root or health, for example:

```json
{
  "capabilities": {
    "find_many_ast": {
      "available": true
    }
  }
}
```

## Bottom line

The SDK work is done in the correct direction:

- `findMany(...)` is now the clean canonical Athena read API
- the old `.select(...)` path stays compatible
- no Athena server rewrite is required for v1

The main server work left is contract hardening, not feature invention:

1. fix OpenAPI to match live payloads
2. standardize gateway error envelopes
3. add server-side tests for the select-string grammar that the AST compiler targets
4. only then decide whether direct AST transport is worth adding later
