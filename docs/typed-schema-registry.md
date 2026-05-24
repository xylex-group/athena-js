# Typed schema registry and model contracts

The typed registry layer is the contract backbone of Athena JS.

It lets you define row, insert, and update types once, bind them to model metadata,
and route runtime queries through stable logical model names.

## Why this exists

Use the typed registry when these problems appear:

- repeated row interfaces across service code
- write payload drift between forms/services and DB contracts
- table renames forcing broad runtime string refactors
- cross-team uncertainty about nullable/primary-key semantics

`from("table")` remains supported. The typed system is additive.

## 1) Core primitives

The registry graph is:

```text
defineModel -> defineSchema -> defineDatabase -> defineRegistry -> createTypedClient
```

```ts
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const users = defineModel<
  { id: string; email: string; created_at: string | null; active: boolean },
  { email: string; active?: boolean },
  { email?: string; active?: boolean }
>({
  meta: {
    primaryKey: ["id"],
    nullable: {
      id: false,
      email: false,
      created_at: true,
      active: false,
    },
  },
});

const registry = defineRegistry({
  app: defineDatabase({
    public: defineSchema({ users }),
  }),
});

const typed = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);
```

## 2) Model metadata contract

`defineModel` accepts `{ meta }` and preserves metadata for runtime resolution and tooling.

### Required

- `primaryKey: string[]`

### Optional

- `database`
- `schema`
- `model`
- `tableName`
- `nullable`
- `relations`

### Table name resolution

`fromModel(database, schema, model)` resolves SQL target in this order:

1. `meta.tableName`
2. `${meta.schema ?? schema}.${meta.model ?? model}`

This lets you keep logical names stable while mapping to legacy physical tables.

## 3) Tri-generic write contracts

`TableQueryBuilder` carries 3 independent contracts:

- `Row` for read result typing
- `Insert` for `insert` and `upsert(values)`
- `Update` for `update(values)` and `upsert({ updateBody })`

`defineModel<Row, Insert, Update>` feeds all 3 through `fromModel(...)` automatically.

## 4) Filter column typing behavior

On typed paths, filter methods are keyed to row fields when row keys are known.

```ts
await typed
  .fromModel("app", "public", "users")
  .eq("email", "user@example.com")
  .order("created_at", { ascending: false })
  .limit(25)
  .select("id, email");
```

This applies to methods like `eq`, `gt`, `order`, `contains`, `not`, and `match`.

When row keys are not inferable, signatures gracefully fall back to `string` columns.

## 5) Utility types for service boundaries

Use utility types when you need contract-safe helper functions:

- `RowOf<Model>`
- `InsertOf<Model>`
- `UpdateOf<Model>`
- `ModelAt<Registry, Database, Schema, Model>`

```ts
import type { InsertOf, ModelAt, UpdateOf } from "@xylex-group/athena";

type UserModel = ModelAt<typeof registry, "app", "public", "users">;
type UserInsert = InsertOf<UserModel>;
type UserUpdate = UpdateOf<UserModel>;
```

This is ideal for request parsing helpers, mapper layers, and UI-to-service DTO boundaries.

## 6) Tenant context and header mapping

Typed clients can map logical tenant keys to concrete headers.

```ts
const tenantAware = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
    workspaceId: "X-Workspace-Id",
  },
});

const scoped = tenantAware.withTenantContext({
  organizationId: "org-1",
  workspaceId: "ws-2",
});
```

Behavior:

- `withTenantContext(...)` returns a new client
- context values are merged
- `null` and `undefined` values are skipped
- resulting headers are merged with any base headers

## 7) Relation metadata semantics

`meta.relations` can capture structural relations for tooling and generated artifacts.

```ts
{
  kind: "many-to-one",
  sourceColumns: ["organization_id"],
  targetSchema: "public",
  targetModel: "organizations",
  targetColumns: ["id"],
}
```

Current query builders do not auto-generate joins from this metadata.
Treat it as contract metadata for generation, inspection, and higher-level tooling.

## 8) Registry navigation errors

`fromModel(...)` fails fast for invalid paths:

- unknown database -> `Unknown database "..."`
- unknown schema -> `Unknown schema "..." in database "..."`
- unknown model -> `Unknown model "..." in schema "..."`

These checks run before HTTP calls, which keeps invalid path errors local and deterministic.

## 9) Migration strategy (incremental)

1. Keep existing `from("table")` calls running.
2. Introduce model contracts for the most unstable domains first.
3. Migrate those call sites to `fromModel(...)`.
4. Add generator output once config and CI behavior are deterministic.
5. Use utility types (`InsertOf`/`UpdateOf`) in form and service layers.

This avoids a high-risk flag day migration.

## 10) Common anti-patterns

- defining `Row` only and relying on `Partial<Row>` for business-critical writes
- mixing logical model names and physical table names without explicit `tableName`
- manually rebuilding tenant headers in every call instead of `tenantKeyMap`
- treating relation metadata as runtime join logic
- duplicating form DTO types instead of deriving from model contracts

## 11) Recommended contract shape for teams

For stable long-term maintenance:

- keep each domain model explicit with `Row`, `Insert`, and `Update`
- set `tableName` only when physical names diverge from logical names
- keep `primaryKey` and `nullable` accurate and reviewed with schema changes
- run generator dry-runs in CI to detect schema drift early

## 12) Model-to-form adapter (React Hook Form + Zod)

When forms are driven from model contracts, nullable DB values (`null`) often need
form-safe defaults (`""` / `undefined`) and submit payload normalization back to model shapes.

Use the built-in helpers:

```ts
import { defineModel, createModelFormAdapter } from "@xylex-group/athena";

const profiles = defineModel<{
  id: string;
  display_name: string | null;
  age: number | null;
}>({
  meta: {
    primaryKey: ["id"],
    nullable: { id: false, display_name: true, age: true },
  },
});

const formAdapter = createModelFormAdapter(profiles);

// Edit defaults for RHF (null -> "")
const defaultValues = formAdapter.toDefaults(existingRow);

// Submit payload ("" -> null on nullable fields)
const insertPayload = formAdapter.toInsert(formValues);
```

This keeps `model -> form -> insert/update` conversion rules centralized instead of re-implemented per form.

## 13) Next documents

- [`type-safety-playbook.md`](type-safety-playbook.md)
- [`generator-config.md`](generator-config.md)
- [`api-reference.md`](api-reference.md)
