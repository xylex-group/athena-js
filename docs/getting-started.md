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
    stripNulls: false,
    userId: currentUser.id,
    companyId: currentUser.companyId,
  },
);
```

## 3. Select rows

Every query starts with `.from(tableName)` and ends with `.select()`.

```ts
// fetch all columns
const { data, error, status } = await athena.from("users").select();

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

Chain filter methods before `.select()`. Filters accumulate and are all sent in the same request.

```ts
const { data } = await athena
  .from("users")
  .select("id, name, email")
  .eq("active", true)
  .gte("score", 100)
  .ilike("email", "%@example.com")
  .not("role", "eq", "banned");
```

All available filter methods:

| Method | SQL equivalent |
|--------|---------------|
| `.eq(col, val)` | `col = val` |
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

## 5. Paginate results

```ts
// explicit limit and offset
const { data } = await athena
  .from("orders")
  .select("id, total")
  .limit(25)
  .offset(50);

// range shorthand — equivalent to offset(0).limit(10)
const { data: page1 } = await athena
  .from("orders")
  .select()
  .range(0, 9);
```

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

## 11. React hook

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

The hook also exposes `insertGateway`, `updateGateway`, and `deleteGateway` for mutations, plus `lastRequest` and `lastResponse` for debugging.

## 12. Error handling

All query methods return `{ data, error, status, raw }`. Check `error` before using `data`.

```ts
const { data, error, status } = await athena.from("users").select();

if (error) {
  // error is a string message from the gateway
  console.error(`[${status}] ${error}`);
  return;
}

// data is typed as User[] | null here
```

The React hook sets `error` state automatically and throws from the gateway functions — use `try/catch` around `insertGateway`, `updateGateway`, and `deleteGateway` calls.

## Next steps

- [API reference](api-reference.md) — complete documentation for every method, option, and type
