# Athena JS SDK - Getting Started

This guide takes you from an untyped runtime client to a typed registry workflow with stable write contracts.

If you only need immediate runtime usage, complete sections 1 to 7.
If you need team-wide type consistency, continue through sections 8 to 13.

## 1) Prerequisites

- Node.js 18+
- Athena gateway URL
- Athena API key

Environment names recognized by `AthenaClient.fromEnvironment()`:

- `ATHENA_URL` or `ATHENA_GATEWAY_URL`
- `ATHENA_API_KEY` or `ATHENA_GATEWAY_API_KEY`

## 2) Install

```bash
pnpm add @xylex-group/athena
```

React runtime support is optional and shipped from `@xylex-group/athena/react`.

## 3) Create your first client

### `createClient` (fastest)

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  client: "web-dashboard",
  backend: { type: "athena" },
});
```

### `AthenaClient.builder()` (explicit configuration)

```ts
import { AthenaClient, Backend } from "@xylex-group/athena";

const athena = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .backend(Backend.Athena)
  .client("web-dashboard")
  .headers({ "X-App-Region": "eu" })
  .build();
```

### `AthenaClient.fromEnvironment()` (ops-friendly)

```ts
import { AthenaClient } from "@xylex-group/athena";

const athena = AthenaClient.fromEnvironment();
```

## 4) Read data with table builders

```ts
type UserRow = {
  id: string;
  email: string;
  active: boolean;
  created_at: string;
};

const result = await athena
  .from<UserRow>("users")
  .select("id, email, active")
  .eq("active", true)
  .order("created_at", { ascending: false })
  .limit(25);
```

### Important chain behavior

- `.select(...)` returns a `SelectChain`, not a promise.
- `await` on the chain triggers execution.
- `.single(...)` and `.maybeSingle(...)` are read terminators.

```ts
const one = await athena.from<UserRow>("users").eq("id", "u-1").single("id, email");
```

## 5) Filter, paging, and schema-qualified calls

```ts
const page = await athena
  .from<UserRow>("users")
  .select("id, email")
  .currentPage(2)
  .pageSize(50)
  .order("created_at", { ascending: false });

const usersInPublic = await athena
  .from<UserRow>("users")
  .select("id, email", { schema: "public" });
```

Filter operators include:

- `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- `like`, `ilike`, `is`, `in`
- `contains`, `containedBy`
- `or`, `not`, `match`

`eq()` has UUID-aware behavior for identifier-like columns (`id`, `*_id`, `*uuid*`).

## 6) Writes and mutation contracts

### Insert

```ts
await athena
  .from<{ id: string; email: string }, { email: string }>("users")
  .insert({ email: "user@example.com" })
  .select("id, email");
```

### Update

```ts
await athena
  .from<{ id: string; email: string }, { email: string }, { email?: string }>("users")
  .eq("id", "u-1")
  .update({ email: "new@example.com" })
  .select("id, email");
```

### Upsert

```ts
await athena
  .from<{ id: string; email: string }, { id: string; email: string }, { email?: string }>("users")
  .upsert(
    { id: "u-1", email: "user@example.com" },
    {
      onConflict: "id",
      updateBody: { email: "user@example.com" },
    },
  )
  .select("id, email");
```

### Delete guardrail

Delete requires one of:

- `eq("id", ...)`
- `eq("resource_id", ...)`
- `delete({ resourceId: ... })`

If none is present, the SDK throws before network execution.

## 7) RPC and SQL query path

### RPC

```ts
const rpcResult = await athena
  .rpc<{ count: number }, { active_only: boolean }>("list_users", { active_only: true })
  .single("count");
```

### Raw query

```ts
const rows = await athena.query<{ id: string; email: string }>(
  "select id, email from users where active = true",
);
```

Use `query(...)` when the shape is hard to express through table/RPC builders.

## 8) Handle responses safely

Every operation resolves to `AthenaResult<T>`:

- `data`
- `error`
- `errorDetails`
- `status`
- optional `count`
- `raw`

Use helpers for strict service-layer handling:

```ts
import { isOk, unwrapRows, unwrapOne, requireAffected } from "@xylex-group/athena";

const list = await athena.from<{ id: string }>("users").select("id");
if (!isOk(list)) throw new Error(list.error ?? "Unknown error");
const rows = unwrapRows(list);

const single = await athena.from<{ id: string }>("users").eq("id", "u-1").single("id");
const user = unwrapOne(single, { allowNull: true });

const inserted = await athena.from<{ id: string }, { email: string }>("users").insert({ email: "a@b.com" });
requireAffected(inserted, { min: 1 });
```

## 9) Move to typed model registry

When runtime strings and payload types start drifting, define model contracts once and use `fromModel(...)`.

```ts
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const users = defineModel<
  { id: string; email: string; created_at: string | null },
  { email: string },
  { email?: string }
>({
  meta: {
    primaryKey: ["id"],
    nullable: { id: false, email: false, created_at: true },
  },
});

const registry = defineRegistry({
  app: defineDatabase({
    public: defineSchema({ users }),
  }),
});

const typed = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);

await typed
  .fromModel("app", "public", "users")
  .select("id, email")
  .eq("email", "user@example.com");
```

What this gives you:

- row typing on reads
- insert typing on `insert/upsert`
- update typing on `update/upsert({ updateBody })`
- filter column keys tied to known row keys

## 10) Tenant header propagation

Use `tenantKeyMap` once, then apply tenant values per request context.

```ts
const scopedClient = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
    workspaceId: "X-Workspace-Id",
  },
});

const tenantBound = scopedClient.withTenantContext({ organizationId: "org-1", workspaceId: "ws-4" });

await tenantBound.fromModel("app", "public", "users").select("id, email");
```

`withTenantContext(...)` returns a new client and merges context values.

## 11) Form contracts with Zod and React Hook Form

This is the practical path to collapse form/model drift:

1. keep `Insert` and `Update` types in your model contract
2. derive form values from schema validation
3. pass parsed values directly into typed builder methods

```ts
import { z } from "zod";
import type { InsertOf, UpdateOf } from "@xylex-group/athena";

const userCreateSchema = z.object({
  email: z.string().email(),
  active: z.boolean().default(true),
});

type UserModel = typeof registry.app.schemas.public.models.users;
type UserInsert = InsertOf<UserModel>;
type UserUpdate = UpdateOf<UserModel>;

function toInsert(input: unknown): UserInsert {
  return userCreateSchema.parse(input);
}

function toUpdate(input: unknown): UserUpdate {
  return userCreateSchema.partial().parse(input);
}
```

If you use React Hook Form:

- validate with Zod at submit boundaries
- map create form to `InsertOf<Model>`
- map patch form to `UpdateOf<Model>`

This keeps UI payloads aligned with model contracts instead of duplicating ad-hoc DTO interfaces.

## 12) Generate registry code from PostgreSQL

Use code generation when the database schema changes often.

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --help
```

Minimal direct mode config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: process.env.DATABASE_URL!,
    database: "app_db",
    schemas: ["public", "athena"],
  },
  output: {
    targets: {
      model: "athena/models/{schema_kebab}/{model_kebab}.ts",
      schema: "athena/schemas/{schema_kebab}.ts",
      database: "athena/relations.ts",
      registry: "athena/config.ts",
    },
  },
});
```

Use `mode: "gateway"` when CI or runners cannot open direct PostgreSQL connections.

## 13) Production checklist

- Use typed `fromModel(...)` on domains with frequent schema changes.
- Keep write contracts explicit (`Insert` and `Update`) for business-critical models.
- Run `athena-js generate --dry-run` in CI before writing artifacts.
- Keep generated file paths schema-aware to avoid collisions.
- Guard all service-layer writes with `requireAffected(...)` when mutation cardinality matters.
- Prefer helper-based error normalization for API boundary consistency.

## 14) Where to go next

- [`typed-schema-registry.md`](typed-schema-registry.md)
- [`type-safety-playbook.md`](type-safety-playbook.md)
- [`generator-config.md`](generator-config.md)
- [`api-reference.md`](api-reference.md)
