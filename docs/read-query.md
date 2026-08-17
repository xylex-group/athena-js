# Portable read queries

`executeAthenaReadQuery` runs a portable page query against a v3 Athena client.
Use it for tables, KPIs, scripts, and server data proxies that share one definition shape.

## Construction boundary

The executor **never** creates a client. Pass a result of:

```ts
import { createClient, executeAthenaReadQuery } from "@xylex-group/athena"

const client = createClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
})

const result = await executeAthenaReadQuery({
  client,
  page: 1,
  pageSize: 20,
  query: {
    table: "orders",
    schema: "public",
    mode: "findMany", // or "select"
    countColumn: "id",
    columns: [
      { column: "id", key: "id" },
      { column: "status", key: "status" },
    ],
    filters: [{ column: "status", operator: "eq", value: "paid" }],
    orderBy: { column: "created_at", direction: "desc" },
  },
})

// result.rows — flat rows keyed by column `key` (alias)
// result.totalItems
// result.debugAst? — when experimental AST tracing is enabled
```

Session-scoped views (`withContext`, Next server facades, `useAthenaSessionClient`) work the same way: pass the scoped client’s `.db` surface.

## Definition contract

| Field | Role |
| --- | --- |
| `table` / `schema` | Target |
| `columns[].column` | Athena select expression or base column |
| `columns[].key` | Flat-row alias after execute |
| `columns[].relation` | Optional relation projection |
| `countColumn` | Exact count head select |
| `filters` | Operator filters (`eq` default) |
| `orderBy` | Single or multi-column order |
| `mode` | `findMany` (default) or fluent `select` |
| `limit` / `rowKey` | Optional cap and preferred row id field |

## Browser

The same symbols are exported from `@xylex-group/athena/browser`.

## React (athena-js)

SDK apps that already use `AthenaQueryClientProvider` can subscribe with
**`useAthenaReadQuery`** from `@xylex-group/athena/react`:

```tsx
import { createClient } from "@xylex-group/athena"
import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  useAthenaReadQuery,
} from "@xylex-group/athena/react"

const athena = createClient({ url, key })
const queryClient = createAthenaQueryClient()

function OrdersKpi() {
  const { rows, totalItems, isLoading } = useAthenaReadQuery({
    client: athena,
    page: 1,
    pageSize: 1,
    query: {
      table: "orders",
      countColumn: "id",
      columns: [{ column: "count(*)", key: "total" }],
    },
  })
  // ...
}

// wrap tree: <AthenaQueryClientProvider client={queryClient}>...</AthenaQueryClientProvider>
```

`useAthenaReadQuery` does **not** open a `dataProxy`, does not own table
pagination UI state, and does not use TanStack. It only runs
`executeAthenaReadQuery` through the Athena-native cache.

For fluent model queries, prefer **`useAthenaQuery(query)`** from
`@xylex-group/athena/react`. Pass `athena.from(Model).select()...` — no
manual `queryKey`. Rebuild the chain when inputs change; mutating the same
builder after subscribe does not retarget the observer.

Mutations use **`useAthenaMutation((input) => athena.from(Model).update(...)...)`**.
The client reconciles the entity graph from the mutation descriptor: non-membership
field changes patch cached lists; membership/order field changes invalidate
those collections. `queryClient.forModel(Model)` is a cache-only escape hatch.

`AthenaQueryClient` also exposes cache escape hatches:

```ts
queryClient.getQueryData(queryKey)
queryClient.setQueryData(queryKey, data)
await queryClient.invalidateQueries({ queryKey: ["athena", "read-query"] })
```

`invalidateQueries` matches **stored structured keys** by array tuple prefix
(or string equality). It does not use serialization-token prefixes. See
[ADR 0024](adr/0024-athena-query-descriptor-and-model-graph.md).

## UI hooks (athena-auth-ui)

HeroUI tables, TanStack cache, and app `dataProxy` POST routes live in
**athena-auth-ui** (`useAthenaQuery` / `useAthenaInfiniteQuery`). Those hooks
call the same executor (or re-export it), not a parallel findMany stack.

Do not confuse:

| Symbol | Package | Role |
| --- | --- | --- |
| `executeAthenaReadQuery` | `@xylex-group/athena` | Imperative execute |
| `useAthenaReadQuery` | `@xylex-group/athena/react` | AthenaQueryClient + page read |
| `useAthenaQuery` | `@xylex-group/athena-auth-ui` | TanStack + pagination + optional proxy |
| `useQuery` / `useAthenaQueryClient` | `@xylex-group/athena/react` | Generic Athena-native cache |
| `createAthenaQueryClient` | `@xylex-group/athena/react` | Athena-native cache factory |
| `createAuthUiTanstackQueryClient` | `@xylex-group/athena-auth-ui` | TanStack factory (old name `createAthenaQueryClient` is deprecated there) |

## Aliases

`executeAthenaTableQuery` and `AthenaTableQueryDefinition` (and related table-prefixed names) are stable aliases of the read-query API for existing consumers.
