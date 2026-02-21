# API reference

Athena exposes a query builder client and a React hook for the Athena HTTP gateway.

## createClient

```ts
import { createClient } from 'athena-js'

const athena = createClient(url: string, apiKey: string, options?)
```

Creates a client that communicates with the Athena gateway. The returned object exposes `.from(tableName)` and the full query builder.

### client.from(table)

Returns a query builder with:

- `.range(from, to)` — span a result window (updates `.limit()` and `.offset()`)
- `.gt/.gte/.lt/.lte/.neq/.like/.ilike/.is/.in/.contains/.containedBy` — comparison filters
- `.not(expression)` — negate a filter expression
- `.or(expression)` — logical OR expressions
- `.upsert(values, options?)` — insert with conflict handling and optional updates

Filters accumulate, so you can reuse `.eq()`, `.match()`, `.not()`, `.or()`, and the comparison helpers to build complex WHERE clauses before calling `.select()` or `.update()`.

### MutationQuery helpers

`insert`, `update`, `upsert`, and `delete` return a mutation query object that exposes `.select()`, `.returning()`, `.single()`, `.maybeSingle()`, `.then()`, `.catch()`, and `.finally()` so you can chain reads after mutating rows without rerunning a separate `.select()` call.

### Supported options

| Option | Applies to | Description |
|--------|------------|-------------|
| `count` | `select` / `insert` / `upsert` | request one of the built-in count algorithms (`exact`, `planned`, `estimated`) |
| `head` | `select` / `insert` / `upsert` | only return headers (no rows) |
| `defaultToNull` | `insert` / `upsert` | write explicit `null` values when no default is provided |
| `onConflict` | `upsert` | comma-delimited column list (e.g. `"id"`) to resolve unique key conflicts |
| `updateBody` | `upsert` | fields to apply when a conflict occurs |

`delete` accepts `options.resourceId` and can also rely on `.eq('resource_id', id)` or other filters before applying deletion.

### Query result shape

Every builder method resolves to:

```ts
{
  data: T | null;
  error: string | null;
  status: number;
  raw: unknown;
}
```

## useAthenaGateway

```ts
import { useAthenaGateway } from "athena-js/react";
```

React hook that wraps the gateway with loading state and request/response logs.

**Config:** `baseUrl`, `apiKey`, `stripNulls`, `headers`, `userId`, `companyId`, `organizationId`, `supabaseUrl`, `supabaseKey`, etc.

**Returns:** `fetchGateway`, `insertGateway`, `updateGateway`, `deleteGateway`, `isLoading`, `error`, `lastRequest`, `lastResponse`, `baseUrl`.

## Gateway types

- `AthenaFetchPayload`, `AthenaInsertPayload`, `AthenaUpdatePayload`, `AthenaDeletePayload`
- `AthenaGatewayCondition`, `AthenaGatewayBaseOptions`, `AthenaGatewayCallOptions`
- `AthenaGatewayResponse`, `AthenaGatewayHookConfig`, `AthenaGatewayHookResult`
