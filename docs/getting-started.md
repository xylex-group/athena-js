# Athena JS SDK — Getting Started

This page is the fastest path to a working client. It starts untyped and introduces model-first types and generator-backed registry contracts when your schema stabilizes.

## 1) Install

```bash
npm install @xylex-group/athena
# or
pnpm add @xylex-group/athena
```

Install React peers only if you use `@xylex-group/athena/react`:

```bash
npm install react # React >= 17
```

## 2) Create a client

### Minimal runtime client

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient("https://athena.example.com", process.env.ATHENA_API_KEY!);
```

### Reusable config

```ts
import { AthenaClient, Backend } from "@xylex-group/athena";

const athena = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .backend(Backend.Athena) // or Backend.PostgreSQL / Backend.ScyllaDB / Backend.Postgrest
  .client("app-web")
  .build();
```

### Environment bootstrap

```ts
import { AthenaClient } from "@xylex-group/athena";

const athena = AthenaClient.fromEnvironment(); // uses ATHENA_URL/ATHENA_API_KEY by default
```

Builder `options` are typically:

- `client` → sets `X-Athena-Client`
- `backend` → `{ type: BackendType }` or `BackendType`
- `headers` → shared headers applied to every request
- `healthTracking()` exists for future expansion and currently does not alter runtime behavior

## 3) First query

```ts
const users = await athena
  .from<{ id: number; name: string }>("users")
  .select("id, name")
  .order("created_at", { ascending: false })
  .limit(25);
```

Common result fields are:

- `data`: typed payload (`T[] | T | null`)
- `error`: message or `null`
- `errorDetails`: request metadata (`code`, `endpoint`, `requestId`, etc.)
- `status`: HTTP-style status code
- `count`: optional backend count
- `raw`: original payload from gateway

## 4) Filter, sort, and paging

```ts
await athena
  .from("users")
  .select("id, name, email")
  .eq("active", true)
  .gte("reputation", 10)
  .ilike("email", "%@example.com")
  .not("status", "eq", "banned")
  .order("created_at", { ascending: false })
  .limit(20);
```

Supported chain methods on table/select/update chains:

- `eq`, `eqCast`, `eqUuid`
- `neq`, `gt`, `gte`, `lt`, `lte`
- `like`, `ilike`
- `is`, `in`, `match`, `contains`, `containedBy`
- `not`, `or`, `range`, `offset`, `currentPage`, `pageSize`, `totalPages`, `order`

Pagination options:

- `offset/limit`: `offset(50).limit(10)`
- `range`: shorthand with inclusive end index, `range(50, 59)`
- page-style: `currentPage(2).pageSize(25)`

## 5) Writes and delete guardrails

```ts
const inserted = await athena
  .from<{ id: string; name: string }>("users")
  .insert({ name: "Ada" })
  .select("id, name");

const updated = await athena
  .from("users")
  .update({ name: "Bilbo Baggins" })
  .eq("id", 1)
  .single("id, name");

await athena
  .from("users")
  .upsert(
    { id: 1, name: "Bilbo Baggins" },
    { onConflict: "id", updateBody: { name: "Bilbo Baggins" } },
  )
  .select("id, name");
```

Delete requires one of:

- `eq("id", value)` on the same chain
- `eq("resource_id", value)` on the same chain
- `delete({ resourceId })`

```ts
await athena.from("users").eq("id", 1).delete();
await athena.from("users").delete({ resourceId: "abc-123" }).single("id");
```

## 6) RPC and raw SQL

```ts
const admins = await athena
  .rpc("list_users", { active_only: true }, { schema: "public", count: "exact" })
  .eq("active", true)
  .order("created_at", { ascending: false })
  .range(0, 9)
  .select(["id", "email"]);

const readOnly = await athena.rpc("list_users", { active_only: true }, { get: true }).single<{
  id: string;
  email: string;
}>();
```

```ts
const rows = await athena.query<{ id: number; name: string }>(
  "select id, name from users where active = true",
);
```

## 7) Error and result helpers

Use helpers to keep control flow predictable:

```ts
import { isOk, unwrapRows, unwrapOne, requireAffected } from "@xylex-group/athena";

const users = await athena.from<{ id: number; name: string }>("users").select("id, name");
if (isOk(users)) {
  const all = unwrapRows(users);
}

const user = await athena.from<User>("users").eq("id", 1).single("id, name");
const one = unwrapOne(user); // throws if empty unless allowNull

const insert = await athena.from<User>("users").insert({ name: "Ada" }).select("id, name");
requireAffected(insert, { min: 1 }); // enforces count-based write postcondition
```

If you want permissive null handling: `unwrap(result, { allowNull: true })`.

## 8) Adopt the typed model system

Keep this as the next step once table and column contracts are stable.

### Step 1: build a registry

```ts
import {
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
  createTypedClient,
} from "@xylex-group/athena";

const registry = defineRegistry({
  primary: defineDatabase({
    public: defineSchema({
      users: defineModel<{ id: string; email: string }>({
        meta: { primaryKey: ["id"], nullable: { id: false, email: false } },
      }),
    }),
  }),
});
```

### Step 2: switch reads/mutations to model paths

```ts
const typed = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  tenantKeyMap: { organizationId: "X-Organization-Id" },
});

const userRows = await typed
  .withTenantContext({ organizationId: "org_123" })
  .fromModel("primary", "public", "users")
  .select("id, email")
  .limit(20);
```

The typed surface gives:

- compile-time row typing from `defineModel<Row, Insert, Update>`
- stable call sites over physical table names via `tableName` and logical `model`
- tenant context injection without copying headers manually

## 9) Generator-assisted registry generation

When your schemas change frequently, generate typed registry code from the DB:

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
```

For generator wiring and all config flags, see [`generator-config.md`](generator-config.md).

## 10) Minimal React usage

```tsx
"use client";

import { createClient } from "@xylex-group/athena";
import { AthenaQueryClientProvider, createAthenaQueryClient, useQuery } from "@xylex-group/athena/react";

const athena = createClient(
  process.env.NEXT_PUBLIC_ATHENA_URL!,
  process.env.NEXT_PUBLIC_ATHENA_API_KEY!,
);
const queryClient = createAthenaQueryClient();

function Products() {
  const result = useQuery({
    queryKey: ["products"],
    queryFn: () => athena.from<{ id: string; name: string }>("products").select("id, name"),
  });

  if (result.isLoading) return <p>Loading…</p>;
  if (result.error) return <p>{result.error.message}</p>;

  return (
    <ul>
      {(result.data ?? []).map(row => (
        <li key={row.id}>{row.name}</li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <Products />
    </AthenaQueryClientProvider>
  );
}
```

## 11) Next

- [Core API reference](api-reference.md)
- [Typed schema registry and contracts](typed-schema-registry.md)
- [Generator and config](generator-config.md)
