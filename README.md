# athena-js

current version: `1.3.1`
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

const athenaClient = createClient(ATHENA_URL, ATHENA_API_KEY, {
  client: "CLIENT_NAME",
  backend: { type: "athena" },
});

const { data, error } = await athenaClient.from("characters").select(`
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

Every query resolves to `{ data, error, errorDetails?, status, count?, raw }`. `data` is `null` on error; `error` is `null` on success.

For richer handling, inspect `errorDetails` (`code`, `status`, `endpoint`, `method`, `requestId`, etc.) or use `AthenaGatewayError` / `isAthenaGatewayError` from the package exports.

## Reliability helper APIs

The SDK exports composable helpers to reduce repetitive route-handler logic.

### Result unwrapping and success guards

```ts
import {
  isOk,
  unwrap,
  unwrapRows,
  unwrapOne,
  requireSuccess,
  requireAffected,
} from "@xylex-group/athena";

const result = await athena.from("users").select("id,name");

if (isOk(result)) {
  const rows = unwrapRows(result); // typed User[]
  console.log(rows.length);
}

const one = await athena.from("users").eq("id", 1).single("id,name");
const user = unwrapOne(one, { allowNull: true });

const inserted = await athena
  .from("users")
  .insert({ name: "Alice" })
  .select("id", { count: "exact" });

requireSuccess(inserted, { table: "users", operation: "insert" });
requireAffected(inserted, { min: 1 }, { table: "users", operation: "insert" });
```

`requireAffected` uses `result.count`; request it on writes with `{ count: "exact" }` when you need enforced postconditions.

### Error normalization

```ts
import { normalizeAthenaError } from "@xylex-group/athena";

const result = await athena.from("users").insert({ id: 1 }).select();
if (result.error) {
  const err = normalizeAthenaError(result, {
    table: "users",
    operation: "insert",
  });
  if (err.kind === "unique_violation") {
    // deterministic conflict handling
  }
}
```

Normalized errors expose stable `kind` values (`unique_violation`, `validation`, `auth`, `rate_limit`, `transient`, etc.) plus operation metadata.

### Numeric coercion

```ts
import { coerceInt, assertInt } from "@xylex-group/athena";

const maybeCaseId = coerceInt(req.query.case_id, { min: 1 });
if (maybeCaseId == null) throw new Error("Invalid case id");

const caseId = assertInt(req.query.case_id, "case_id", { min: 1 });
```

### Retry helper

```ts
import { withRetry } from "@xylex-group/athena";

const result = await withRetry(
  {
    retries: 3,
    backoff: "exponential",
    baseDelayMs: 100,
    jitter: true,
  },
  () => athena.from("users").select("id,name"),
);
```

By default, retries target transient/rate-limit failures; use `shouldRetry` for custom policies.

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
  .eq("active", true) // column = value
  .neq("role", "guest") // column != value
  .gt("level", 5) // column > value
  .gte("score", 100) // column >= value
  .lt("age", 30) // column < value
  .lte("created_at", "2024-01-01") // column <= value
  .like("name", "Ali%") // SQL LIKE (case-sensitive)
  .ilike("email", "%@example%") // SQL ILIKE (case-insensitive)
  .is("deleted_at", null) // IS NULL / IS TRUE etc.
  .in("status", ["active", "pending"]) // IN (…)
  .contains("tags", ["hero"]) // array contains value
  .containedBy("tags", ["hero", "villain"]) // array is subset of value
  .match({ role: "admin", active: true }) // multiple eq filters at once
  .not("role", "eq", "banned") // NOT col op val
  .or("status.eq.active,status.eq.pending"); // OR expression
```

Canonical style for reads is to call `.select(...)` first, then apply filters:

```ts
const { data } = await athena
  .from("instruments")
  .select("name, section_id")
  .eq("name", "violin");
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

### RPC

Use `athena.rpc(...)` for Postgres function calls. By default it calls `POST /gateway/rpc`, and with `{ get: true }` it uses the compatibility route `GET /rpc/{function_name}`.

```ts
const { data, count } = await athena
  .rpc("list_users", { role: "admin" }, { count: "exact", schema: "public" })
  .eq("active", true)
  .order("created_at", { ascending: false })
  .range(0, 24)
  .select(["id", "email"]);

const { data: firstUser } = await athena
  .rpc<{ id: number; email: string }>("list_users", { role: "admin" })
  .single("id,email");

const { data: readOnlyUser } = await athena
  .rpc<{
    id: number;
    email: string;
  }>(
    "list_users",
    { role: "admin" },
    { get: true, count: "planned", head: true },
  )
  .eq("id", 1)
  .single("id,email");
```

RPC chain methods: `.eq()`, `.neq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.like()`, `.ilike()`, `.is()`, `.in()`, `.order()`, `.limit()`, `.offset()`, `.range()`, `.select()`, `.single()`, `.maybeSingle()`.
RPC options: `schema`, `count` (`"exact" | "planned" | "estimated"`), `head`, `get`.

### Options

Pass options as the second argument to `.select()`:

| Option       | Type                                  | Description                                  |
| ------------ | ------------------------------------- | -------------------------------------------- |
| `count`      | `"exact" \| "planned" \| "estimated"` | request a row count alongside the data       |
| `head`       | `boolean`                             | return response headers only (no rows)       |
| `stripNulls` | `boolean`                             | strip null values from rows (default `true`) |

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

// Type inference differs by payload shape:
// - insert(one) => AthenaResult<Row>
// - insert(many) => AthenaResult<Row[]>
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

// Type inference differs by payload shape:
// - upsert(one) => AthenaResult<Row>
// - upsert(many) => AthenaResult<Row[]>
```

| Option          | Type                                  | Description                              |
| --------------- | ------------------------------------- | ---------------------------------------- |
| `onConflict`    | `string \| string[]`                  | column(s) that determine a conflict      |
| `updateBody`    | `object`                              | fields to apply when a conflict occurs   |
| `defaultToNull` | `boolean`                             | write explicit `null` for missing fields |
| `count`         | `"exact" \| "planned" \| "estimated"` | request a row count                      |
| `head`          | `boolean`                             | return headers only                      |

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

The hook returns `fetchGateway`, `insertGateway`, `updateGateway`, `deleteGateway`, `rpcGateway`, `isLoading`, `error`, `lastRequest`, `lastResponse`, and `baseUrl`.

Hook config options mirror the client options: `baseUrl`, `apiKey`, `headers`, `userId`, `organizationId`, `publishEvent`.

## User context headers

Pass user and tenant context to every request without repeating it on each call:

```ts
const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
  {
    headers: {
      "X-User-Id": currentUser.id,
      "X-Organization-Id": currentUser.organizationId ?? "",
    },
  },
);
```

Or pass per-call via options. The Athena server interprets `url` and `key` based on the configured backend type.

## Custom headers

```ts
const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
  {
    headers: {
      "X-Custom-Header": "value",
    },
  },
);
```

Per-call headers are merged with the client-level headers, with per-call values winning on conflict.

The SDK also sends a standard identification header on every request:

- `X-Athena-Sdk: xylex-group/athena <version>`

## TypeScript

The package is written in TypeScript and ships declaration files. Pass a row type to `.from()` for fully-typed builder methods and results:

```ts
interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const { data } = await athena
  .from<User>("users")
  .select("id, name")
  .eq("active", true);
// data is User[] | null
```

## Development Validation

For local quality checks:

```bash
pnpm typecheck   # compile-time type compatibility checks
pnpm check:all   # lint + typecheck + test + build
```

CI and publish workflows run `typecheck` before build/publish.

## Learn more

- [Getting started](docs/getting-started.md) — step-by-step walkthrough
- [API reference](docs/api-reference.md) — complete method and type reference
