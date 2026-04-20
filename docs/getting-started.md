# Getting started with athena-js

Athena is a database driver and API gateway SDK. This guide walks through installation, client setup, querying, mutations, pagination, and the React hook.

## 1. Install

```bash
npm install @xylex-group/athena
# or
pnpm add @xylex-group/athena
# or
yarn add @xylex-group/athena
```

Install the React peer dependency only if you plan to use `useAthenaGateway`:

```bash
npm install react  # React >=17
```

## 2. Create a client

`createClient` returns a query builder bound to your Athena server URL and API key.

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
);
```

You can also pass a third `options` argument to set defaults for every request:

```ts
const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
  {
    client: "your_client",
    headers: {
      "X-User-Id": currentUser.id ?? "",
    },
  },
);
```

## 3. Select rows

Every query starts with `.from(tableName)` and ends with `.select()`.

```ts
// fetch all columns
const { data, error, errorDetails, status } = await athena.from("users").select();

if (error) {
  console.error("query failed:", error);
} else {
  console.table(data);
}
```

Select specific columns by passing a comma-separated string:

```ts
const { data } = await athena.from("users").select("id, name, email");
```

Annotate the row type for full TypeScript inference:

```ts
interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const { data } = await athena.from<User>("users").select("id, name");
// data is User[] | null
```

## 4. Filter rows

Chain filter methods with `.select()`. Filters accumulate and are all sent in the same request.

```ts
const { data } = await athena
  .from("users")
  .select("id, name, email")
  .eq("active", true)
  .gte("score", 100)
  .ilike("email", "%@example.com")
  .not("role", "eq", "banned");
```

Canonical read style is:

```ts
const { data } = await athena
  .from("instruments")
  .select("name, section_id")
  .eq("name", "violin");
```

All available filter methods:

| Method | SQL equivalent |
|--------|---------------|
| `.eq(col, val)` | `col = val` |
| `.eqUuid(col, val)` | `col = val::uuid` (explicit UUID compare) |
| `.eqCast(col, val, cast)` | `col = val::cast` (explicit cast compare) |
| `.neq(col, val)` | `col != val` |
| `.gt(col, val)` | `col > val` |
| `.gte(col, val)` | `col >= val` |
| `.lt(col, val)` | `col < val` |
| `.lte(col, val)` | `col <= val` |
| `.like(col, val)` | `col LIKE val` |
| `.ilike(col, val)` | `col ILIKE val` |
| `.is(col, val)` | `col IS val` |
| `.in(col, vals)` | `col IN (…)` |
| `.contains(col, vals)` | `col @> vals` |
| `.containedBy(col, vals)` | `col <@ vals` |
| `.match(filters)` | multiple `col = val` |
| `.not(col, op, val)` | `NOT col op val` |
| `.or(expression)` | `col1.op1.val1,col2.op2.val2` |

`eq()` also auto-detects UUID-like values on identifier columns (`id`, `*_id`, `*uuid*`) and uses a typed-safe comparison path, so fluent UUID filters work without manual app-side casts.

## 5. Paginate results

The builder supports two styles of pagination. Both map to plain body fields on `/gateway/fetch` — pick the one that matches your backend/UI.

### 5.1 Offset / limit

Good for infinite-scroll or cursor-free sequential loading.

```ts
// rows 51..75
const { data } = await athena
  .from("orders")
  .select("id, total")
  .limit(25)
  .offset(50);

// range shorthand — equivalent to .offset(0).limit(10)
const { data: firstTen } = await athena
  .from("orders")
  .select()
  .range(0, 9);
```

### 5.2 Page based

Good for classic "page 1 of 10" UIs. `.currentPage` is 1-based.

```ts
// second page of 25 rows each
const { data } = await athena
  .from("orders")
  .select("id, total")
  .currentPage(2)
  .pageSize(25);

// if your gateway needs a total-pages hint in the request, pass it
const { data: hinted } = await athena
  .from("orders")
  .select("id, total")
  .currentPage(2)
  .pageSize(25)
  .totalPages(8);
```

Payload field mapping:

| Method | Body field |
|--------|------------|
| `.limit(n)` | `limit` |
| `.offset(n)` | `offset` |
| `.currentPage(n)` | `current_page` |
| `.pageSize(n)` | `page_size` |
| `.totalPages(n)` | `total_pages` |

Pagination helpers work **before or after `.select()`** — the `FilterChain` is shared:

```ts
// both of these serialize identically
await athena.from("users").currentPage(2).pageSize(50).select();
await athena.from("users").select().currentPage(2).pageSize(50);
```

## 5a. Sort results with `.order()`

`.order()` maps to the gateway `sort_by: { field, direction }` object. It's available on the base builder, `SelectChain`, `UpdateChain`, and on delete — so it can appear before or after the operation terminator.

```ts
// ascending (default)
await athena.from("events").select("id, occurred_at").order("occurred_at");

// descending
await athena
  .from("rsf_messages")
  .eq("room_id", roomId)
  .select("*", { stripNulls: false })
  .order("created_at", { ascending: false })
  .limit(100);
// → SELECT * FROM rsf_messages WHERE room_id = $1
//     ORDER BY created_at DESC LIMIT 100

// combined with page-based pagination
await athena
  .from("orders")
  .select("id, total, created_at")
  .order("created_at", { ascending: false })
  .currentPage(1)
  .pageSize(25);

// pick the most-recent row
const { data: latest } = await athena
  .from("messages")
  .eq("room_id", roomId)
  .select("*")
  .order("created_at", { ascending: false })
  .single();
```

> Only the last `.order()` wins — the SDK does not support multi-column ordering. Use `.rpc()` or `.query()` if you need that.

## 6. Fetch a single row

`.single()` returns the first row as a plain object instead of an array, or `null` if there are no results.

```ts
const { data: user } = await athena
  .from("users")
  .select("id, name")
  .eq("id", 42)
  .single();

if (user) console.log(user.name);
```

## 7. Insert rows

```ts
const { data: inserted } = await athena
  .from("users")
  .insert({ name: "Bilbo", email: "bilbo@shire.com" })
  .select("id, name");

// insert multiple rows
const { data } = await athena
  .from("characters")
  .insert([
    { name: "Frodo" },
    { name: "Sam" },
  ])
  .select();

// Types are inferred from payload shape:
// inserted: User | null (single payload)
// data: User[] | null (array payload)
```

## 8. Update rows

Apply filter conditions before calling `.update()`. The conditions become the `WHERE` clause.

```ts
const { data: updated } = await athena
  .from("users")
  .update({ name: "Bilbo Baggins" })
  .eq("id", inserted?.[0]?.id ?? 0)
  .select();
```

## 9. Upsert rows

```ts
await athena
  .from("users")
  .upsert(
    { id: 1, name: "Bilbo" },
    { updateBody: { name: "Bilbo Baggins" }, onConflict: "id" },
  )
  .select("id, name");

// upsert(one) resolves as AthenaResult<User>
// upsert(many) resolves as AthenaResult<User[]>
```

`updateBody` specifies which fields to update on conflict. `onConflict` names the unique key column(s).

## 10. Delete rows

```ts
// delete by id
await athena.from("users").eq("id", 1).delete();

// delete and return the deleted row
const { data: deleted } = await athena
  .from("users")
  .eq("resource_id", "abc-123")
  .delete()
  .select("id, name");
```

Delete requires a `.eq("resource_id", …)`, `.eq("id", …)`, or `options.resourceId` — calling `.delete()` without one throws an error.

## 11. RPC

Use `.rpc()` to call Postgres functions with a chainable API. By default it uses `POST /gateway/rpc`; with `{ get: true }`, it uses the compatibility route `GET /rpc/{function_name}`.

```ts
const { data, count } = await athena
  .rpc("list_users", { role: "admin" }, { schema: "public", count: "exact" })
  .eq("active", true)
  .order("created_at", { ascending: false })
  .range(0, 24)
  .select(["id", "email"]);

const { data: user } = await athena
  .rpc<{ id: number; email: string }>("list_users", { role: "admin" })
  .single("id,email");

const { data: readOnlyUser } = await athena
  .rpc<{ id: number; email: string }>("list_users", { role: "admin" }, { get: true, count: "planned", head: true })
  .eq("id", 1)
  .single("id,email");
```

RPC chain supports: `.eq()`, `.neq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.like()`, `.ilike()`, `.is()`, `.in()`, `.order()`, `.limit()`, `.offset()`, `.range()`, `.select()`, `.single()`, `.maybeSingle()`.
RPC options include `schema`, `count` (`exact`, `planned`, `estimated`), `head`, and `get`.

For table-returning RPC functions, you can apply filters before `.single()`/`.maybeSingle()`:

```ts
const { data } = await athena
  .rpc("list_stored_countries")
  .eq("id", 1)
  .single();
```
## 12. React hook

Use `useAthenaGateway` for client-side calls with loading and error state managed by React.

```tsx
"use client";

import { useAthenaGateway } from "@xylex-group/athena/react";
import { useEffect } from "react";

export function UserList() {
  const { fetchGateway, lastResponse, isLoading, error } = useAthenaGateway({
    baseUrl: "https://athena-db.com",
    apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  });

  useEffect(() => {
    fetchGateway({
      table_name: "users",
      columns: ["id", "name", "email"],
      conditions: [{ column: "active", operator: "eq", value: true }],
      limit: 25,
    });
  }, [fetchGateway]);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <ul>
      {(lastResponse?.data as Array<{ id: number; name: string }> ?? []).map(
        (user) => <li key={user.id}>{user.name}</li>,
      )}
    </ul>
  );
}
```

The hook also exposes `insertGateway`, `updateGateway`, `deleteGateway`, and `rpcGateway` for mutations, plus `lastRequest` and `lastResponse` for debugging.

## 13. Error handling

All query methods return `{ data, error, errorDetails?, status, count?, raw }`. Check `error` before using `data`.

```ts
const { data, error, errorDetails, status } = await athena.from("users").select();

if (error) {
  // error is a readable message
  console.error(`[${status}] ${error}`);
  console.error(errorDetails?.code, errorDetails?.endpoint, errorDetails?.requestId);
  return;
}

// data is typed as User[] | null here
```

The React hook sets `error` state automatically and throws from the gateway functions, so use `try/catch` around `insertGateway`, `updateGateway`, `deleteGateway`, and `rpcGateway` calls. For typed exceptions, use `AthenaGatewayError` and `isAthenaGatewayError`.

## 14. Local validation commands

Before opening a PR, run:

```bash
pnpm typecheck
pnpm check:all
```

`check:all` runs lint, typecheck, tests, and build in sequence.

## Next steps

- [API reference](api-reference.md) — complete documentation for every method, option, and type

