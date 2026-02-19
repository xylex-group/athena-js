# API reference

Athena exposes a Supabase-style client and a React hook for the Athena HTTP gateway.

## createClient

```ts
import { createClient } from 'athena-js'

const athena = createClient(url: string, apiKey: string, options?)
```

Creates a client that talks to the Athena gateway. Returns an object with `.from(tableName)`.

### client.from(table)

Returns a query builder with:

- `.select(columns?, options?)` — fetch rows
- `.insert(values, options?)` — insert row(s)
- `.update(values, options?)` — update matching rows
- `.delete(options?)` — delete by `resource_id` or `.eq('resource_id', id)`
- `.eq(column, value)` — add equality filter
- `.match(filters)` — add multiple equality filters
- `.limit(n)` — limit result size
- `.offset(n)` — offset results
- `.single(columns?, options?)` — return first row or null
- `.maybeSingle(columns?, options?)` — alias for `.single()`
- `.reset()` — clear filters and start fresh

### SupabaseResult

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
