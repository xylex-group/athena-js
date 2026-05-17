# Athena JS SDK - Getting Started

This is the fastest path to a working runtime and then a typed, generated schema workflow.

For quick setup and API-level details, follow the sections in order. If your schema is stable, you can skip ahead to the typed and generator sections.

## Prerequisites

- Node.js 18+
- An Athena gateway URL and API key

## 1) Install

```bash
npm install @xylex-group/athena
# or
pnpm add @xylex-group/athena
```

React is optional and only required for `@xylex-group/athena/react`.

```bash
npm install react
```

## 2) Create an Untyped Client

Use `createClient` for direct string-based tables.

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  client: "web-dashboard",
  backend: { type: "athena" },
});
```

Or use the builder for explicit construction and env-based defaults:

```ts
import { AthenaClient, Backend } from "@xylex-group/athena";

const athena = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .backend(Backend.Athena)
  .client("web-dashboard")
  .build();
```

`AthenaClient.fromEnvironment()` loads from:

- `ATHENA_URL` or `ATHENA_GATEWAY_URL`
- `ATHENA_API_KEY` or `ATHENA_GATEWAY_API_KEY`

## 3) Query Basics

```ts
const users = await athena
  .from<{ id: string; email: string }>("users")
  .select("id, email")
  .eq("active", true)
  .order("created_at", { ascending: false })
  .limit(25);
```

Common methods on read chains:

- `.select()`
- `.eq`, `.neq`, `.gt`, `.gte`, `.lt`, `.lte`
- `.like`, `.ilike`, `.is`, `.in`
- `.contains`, `.containedBy`, `.range`, `.offset`, `.currentPage`, `.pageSize`
- `.order`
- `.or`
- `.single`, `.maybeSingle`

Result shape is `AthenaResult<T>`:

- `data`
- `error`
- `errorDetails` (when present)
- `status`
- `count` (optional)
- `raw`

## 4) Writes

### Insert

```ts
await athena.from<{ id: string; email: string }>("users").insert({ email: "a@b.com" }).select();
await athena.from<{ id: string; email: string }>("users").insert([{ email: "a@b.com" }]).select();
```

### Update

```ts
await athena
  .from<{ id: string; email: string }>("users")
  .eq("id", "u-123")
  .update({ email: "new@b.com" })
  .select("id, email");
```

### Upsert

```ts
await athena
  .from<{ id: string; email: string }>("users")
  .upsert({ id: "u-123", email: "a@b.com" }, { onConflict: "id", updateBody: { email: "a@b.com" } })
  .select("id, email");
```

### Delete Guardrails

```ts
await athena.from("users").eq("id", "u-123").delete();
await athena.from("users").delete({ resourceId: "rk-456" }).single("id, email");
```

Delete requires one of:

- `eq("id", ...)`
- `eq("resource_id", ...)`
- `delete({ resourceId })`

If none is present, the SDK throws immediately before making the request.

## 5) RPC and Raw SQL

```ts
const result = await athena.rpc<{ count: number }>("list_users", { active_only: true }).single("count");
const activeCount = result.data?.count ?? 0;
```

Use raw SQL when you need query shapes that are not ergonomic with the builder:

```ts
const rows = await athena.query<{ id: number; name: string }>(
  "select id, name from users where active = true",
);
```

## 6) React Quick Start

```tsx
"use client";

import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  useQuery,
} from "@xylex-group/athena/react";
import { createClient } from "@xylex-group/athena";

const athena = createClient(process.env.NEXT_PUBLIC_ATHENA_URL!, process.env.NEXT_PUBLIC_ATHENA_API_KEY!);
const queryClient = createAthenaQueryClient({
  cache: { mode: "none" },
});

function ProductList() {
  const productsQuery = useQuery({
    queryKey: ["products", { limit: 50 }],
    queryFn: () => athena.from<{ id: string; name: string }>("products").select("id,name,price").limit(50),
    select: (result) => result.data ?? [],
  });

  if (productsQuery.isLoading) return <p>Loading...</p>;
  if (productsQuery.error) return <p>{productsQuery.error.message}</p>;

  return (
    <ul>
      {(productsQuery.data ?? []).map((row) => (
        <li key={row.id}>{row.name}</li>
      ))}
    </ul>
  );
}

export function ProductsPage() {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <ProductList />
    </AthenaQueryClientProvider>
  );
}
```

The query runtime is intentionally lean:

- no persistent cache by default (`cache.mode = "none"`)
- retry is off by default (`retry = 0`)
- invalidation is typically handled with explicit `refetch()`

## 7) Move to the Typed Type System

When table contracts begin to stabilize, move stable domains to model-first types.

```ts
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const registry = defineRegistry({
  app: defineDatabase({
    public: defineSchema({
      users: defineModel<{ id: string; email: string; createdAt: string | null }>(
        {
          meta: {
            primaryKey: ["id"],
            nullable: { id: false, email: false, createdAt: true },
          },
        },
      ),
    }),
  }),
});

const typed = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
  },
});

await typed
  .withTenantContext({ organizationId: "org-1" })
  .fromModel("app", "public", "users")
  .select("id, email")
  .order("created_at", { ascending: false });
```

At this point you get:

- compile-time row/insert/update types from model declarations
- stable logical model names while preserving physical `tableName`
- one tenant-header mapping surface across all runtime calls

See [`typed-schema-registry.md`](typed-schema-registry.md) for the full typed system model and migration path.

## 8) Generate Registry Code From PostgreSQL

When the schema changes often, generate model files and registry code instead of hand-maintaining contracts.

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --help
```

The full generator contract, provider modes, output tokens, and feature flags are documented in
[`generator-config.md`](generator-config.md).
The full CLI command/help/troubleshooting reference is documented in
[`cli-command-reference.md`](cli-command-reference.md).

A minimal direct mode config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

const config = defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: process.env.DATABASE_URL!,
    database: "app_db",
    schemas: ["public"],
  },
  output: {
    targets: {
      model: "athena/models/{model_kebab}.ts",
      schema: "athena/schema.ts",
      database: "athena/relations.ts",
      registry: "athena/config.ts",
    },
  },
});

export default config;
```

Use gateway mode when the codegen process cannot access PostgreSQL directly.

```ts
provider: {
  kind: "postgres",
  mode: "gateway",
  gatewayUrl: process.env.ATHENA_URL!,
  apiKey: process.env.ATHENA_API_KEY!,
  database: "app_db",
  schemas: ["public"],
}
```

## 9) Error Handling Patterns

Use helper functions for branch-safe request handling:

```ts
import { isOk, requireAffected, unwrapRows, unwrapOne } from "@xylex-group/athena";

const list = await athena.from<{ id: string }>("users").select("id");
if (!isOk(list)) {
  // route-specific error behavior
  throw new Error(list.error!);
}
const rows = unwrapRows(list);

const one = await athena.from<{ id: string }>("users").eq("id", "u-1").single("id");
const user = unwrapOne(one, { allowNull: true });

const inserted = await athena.from("users").insert({ email: "a@b.com" }).select("id");
requireAffected(inserted, { min: 1 });
```

## 10) Learn More

- [Typed schema and registry architecture](typed-schema-registry.md)
- [Generator configuration and output behavior](generator-config.md)
- [API reference](api-reference.md)
- [`generator-codex-handoff-prompt-pack.md`](generator-codex-handoff-prompt-pack.md)

The next decision point is straightforward:

- keep table-string calls for legacy stability, or
- adopt `fromModel` and optional generated contracts for team-wide consistency.

