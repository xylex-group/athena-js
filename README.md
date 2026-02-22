# athena-js

`@xylex-group/athena` is a database driver and API gateway SDK that lets you interact with SQL backends over HTTP through a fluent builder API. It ships a typed query builder for Node.js / server environments and a React hook for client-side use.

## Install

```bash
npm install @xylex-group/athena
# or
pnpm add @xylex-group/athena
# or
yarn add @xylex-group/athena
```

React peer dependency is optional — only needed if you use `useAthenaGateway`.

```bash
npm install react  # React >=17 required for the hook
```

## Quick start

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
);

const { data, error } = await athena.from("characters").select(`
    id,
    name,
    from:sender_id(name),
    to:receiver_id(name)
  `);

if (error) {
  console.error("gateway error", error);
} else {
  console.table(data);
}
```

Every query resolves to `{ data, error, status, raw }`. `data` is `null` on error; `error` is `null` on success.

## Query builder

### Reading rows

```ts
// select all columns
const { data } = await athena.from("users").select();

// select specific columns
const { data } = await athena.from("users").select("id, name, email");

// select with type annotation
const { data } = await athena.from<User>("users").select("id, name");
```

### Filters

Filters accumulate on the builder and are sent together when the query executes.

```ts
const { data } = await athena
  .from("characters")
  .select("id, name")
  .eq("active", true)           // column = value
  .neq("role", "guest")         // column != value
  .gt("level", 5)               // column > value
  .gte("score", 100)            // column >= value
  .lt("age", 30)                // column < value
  .lte("created_at", "2024-01-01") // column <= value
  .like("name", "Ali%")         // SQL LIKE (case-sensitive)
  .ilike("email", "%@example%") // SQL ILIKE (case-insensitive)
  .is("deleted_at", null)       // IS NULL / IS TRUE etc.
  .in("status", ["active", "pending"])    // IN (…)
  .contains("tags", ["hero"])             // array contains value
  .containedBy("tags", ["hero", "villain"]) // array is subset of value
  .match({ role: "admin", active: true }) // multiple eq filters at once
  .not("role", "eq", "banned")  // NOT col op val
  .or("status.eq.active,status.eq.pending"); // OR expression
```

### Pagination

```ts
// explicit limit and offset
const { data } = await athena.from("users").select().limit(25).offset(50);

// range shorthand — equivalent to offset(from).limit(to - from + 1)
const { data } = await athena.from("users").select().range(0, 24);
```

### Single row

```ts
// returns the first row or null instead of an array
const { data: user } = await athena
  .from("users")
  .select("id, name")
  .eq("id", 42)
  .single();
```

`maybeSingle` behaves identically — both return the first element of the result set.

### Options

Pass options as the second argument to `.select()`:

| Option | Type | Description |
|--------|------|-------------|
| `count` | `"exact" \| "planned" \| "estimated"` | request a row count alongside the data |
| `head` | `boolean` | return response headers only (no rows) |
| `stripNulls` | `boolean` | strip null values from rows (default `true`) |

```ts
const { data } = await athena
  .from("orders")
  .select("id", { count: "exact", stripNulls: false });
```

## Mutations

Insert, update, upsert, and delete all return a `MutationQuery` that you can await directly or chain further calls onto before the request fires.

### Insert

```ts
const { data: inserted } = await athena
  .from("countries")
  .insert({ name: "Mordor" })
  .select("id, name");

// insert multiple rows
const { data } = await athena
  .from("characters")
  .insert([{ name: "Frodo" }, { name: "Sam" }])
  .select();
```

### Update

```ts
const { data: updated } = await athena
  .from("countries")
  .update({ name: "Gondor" })
  .eq("id", 1)
  .select();
```

Filters (`.eq()`, `.match()`, etc.) applied before `.update()` are used as `WHERE` conditions.

### Upsert

```ts
const { data } = await athena
  .from("countries")
  .upsert(
    { id: 2, name: "Rohan" },
    { updateBody: { name: "Rohan" }, onConflict: "id" },
  )
  .select();
```

| Option | Type | Description |
|--------|------|-------------|
| `onConflict` | `string \| string[]` | column(s) that determine a conflict |
| `updateBody` | `object` | fields to apply when a conflict occurs |
| `defaultToNull` | `boolean` | write explicit `null` for missing fields |
| `count` | `"exact" \| "planned" \| "estimated"` | request a row count |
| `head` | `boolean` | return headers only |

### Delete

```ts
// delete by id filter
await athena.from("countries").eq("id", 1).delete();

// delete with explicit resourceId option
await athena.from("countries").delete({ resourceId: "abc-123" });

// chain .select() to get the deleted row back
const { data: deleted } = await athena
  .from("countries")
  .eq("resource_id", "abc-123")
  .delete()
  .select("id, name");
```

Delete requires either `.eq("resource_id", …)`, `.eq("id", …)`, or `options.resourceId` — calling `.delete()` without any of these throws an error.

### MutationQuery chaining

All mutation methods return a `MutationQuery` which supports:

```ts
const mutation = athena.from("users").insert({ name: "Alice" });

await mutation.select("id, name");        // fire request, return rows
await mutation.returning("id");           // alias for .select()
await mutation.single("id");              // return first row or null
await mutation.maybeSingle("id");         // same as .single()
await mutation;                           // fire request, return default columns
mutation.then(({ data }) => …);           // thenable
mutation.catch(err => …);
mutation.finally(() => …);
```

The request fires only once regardless of how many times you call `.then()` or await the object.

## React hook

```tsx
"use client";

import { useAthenaGateway } from "@xylex-group/athena/react";
import { useEffect } from "react";

export function UsersPanel() {
  const { fetchGateway, lastResponse, isLoading, error } = useAthenaGateway({
    baseUrl: "https://athena-db.com",
    apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  });

  useEffect(() => {
    fetchGateway({
      table_name: "users",
      columns: ["id", "email"],
      limit: 25,
    });
  }, [fetchGateway]);

  if (error) return <div>Error: {error}</div>;
  if (isLoading) return <div>Loading…</div>;

  return <pre>{JSON.stringify(lastResponse?.data, null, 2)}</pre>;
}
```

The hook returns `fetchGateway`, `insertGateway`, `updateGateway`, `deleteGateway`, `isLoading`, `error`, `lastRequest`, `lastResponse`, and `baseUrl`.

Hook config options mirror the client options: `baseUrl`, `apiKey`, `stripNulls`, `headers`, `userId`, `companyId`, `organizationId`, `supabaseUrl`, `supabaseKey`, `publishEvent`.

## User context headers

Pass user and tenant context to every request without repeating it on each call:

```ts
const athena = createClient("https://athena-db.com", process.env.ATHENA_API_KEY, {
  userId: currentUser.id,
  companyId: currentUser.companyId,
  organizationId: currentUser.organizationId,
});
```

These are sent as `X-User-Id`, `X-Company-Id`, and `X-Organization-Id` request headers. You can override them per-call by passing the same options to `.select()` or any mutation method.

## Custom headers

```ts
const athena = createClient("https://athena-db.com", process.env.ATHENA_API_KEY, {
  headers: {
    "X-Custom-Header": "value",
  },
});
```

Per-call headers are merged with the client-level headers, with per-call values winning on conflict.

## TypeScript

The package is written in TypeScript and ships declaration files. Pass a row type to `.from()` for fully-typed builder methods and results:

```ts
interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const { data } = await athena.from<User>("users").select("id, name").eq("active", true);
// data is User[] | null
```

## Learn more

- [Getting started](docs/getting-started.md) — step-by-step walkthrough
- [API reference](docs/api-reference.md) — complete method and type reference
