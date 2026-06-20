# Typed schema registry and model contracts

The typed layer is the SDK's schema contract system. It keeps model metadata in TypeScript,
ensures runtime calls line up with table names, and lets the generator emit those same contracts for you.

## Why it exists

Use registry models when two things start to become expensive:

- duplicated row types across call sites
- schema changes causing drift between runtime strings and typed assumptions

The model system reduces both by introducing a source-of-truth object graph:
`registry -> database -> schema -> model -> metadata/metadata types`.

`createClient(...).from<Table>("table")` and
`createClient(...).from<Table>("table", { schema: "..." })` both remain valid and fully supported.
The typed path is additive.

## 1) Core contracts

The canonical authoring surface is now the Zero-style table DSL. `defineModel(...)`
is deprecated and retained only for compatibility and low-level manual contracts.

```ts
import {
  boolean,
  createTypedClient,
  defineDatabase,
  defineRegistry,
  defineSchema,
  enumeration,
  json,
  string,
  table,
} from "@xylex-group/athena";

const users = table("users")
  .schema("public")
  .columns({
    id: string().generated(),
    email: string(),
    active: boolean().defaulted(),
    mood: enumeration(["happy", "sad"] as const).optional(),
    settings: json<{ theme: "light" | "dark" }>(),
  })
  .primaryKey("id");

const primarySchema = defineSchema({ users });
const primaryDb = defineDatabase({ public: primarySchema });
const registry = defineRegistry({ app: primaryDb });

const client = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);
```

Preferred authoring is `.schema("public")` plus `.from("user_pref")` only when the DB table name differs from the TypeScript key. `.from("schema.table")` remains supported for compatibility.

`defineSchema`, `defineDatabase`, and `defineRegistry` remain lightweight identity builders with explicit type signatures. `defineModel(...)` remains available only as a deprecated compatibility builder:

```ts
import {
  defineModel,
  defineSchema,
  defineDatabase,
  defineRegistry,
  createTypedClient,
} from "@xylex-group/athena";

const users = defineModel<
  { id: string; email: string; createdAt: string | null },
  { id?: string; email: string },
  { email?: string }
>({
  meta: {
    primaryKey: ["id"],
    nullable: { id: false, email: false, createdAt: true },
  },
});

const primarySchema = defineSchema({ users });
const primaryDb = defineDatabase({ public: primarySchema });
const registry = defineRegistry({ app: primaryDb });

const client = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);
```

Treat the `defineModel(...)` example above as legacy compatibility authoring. Prefer the table DSL for new model declarations.

## 2) Model metadata contract

`meta` is where runtime behavior and typed metadata are stored.

- `primaryKey: string[]` (required)
- `database`, `schema`, `model`: logical naming hints
- `tableName`: explicit SQL table target; overrides `schema.model`
- `nullable`: map used to shape insert/update inference and nullability
- `columns`: optional per-column metadata used by the table DSL and generator
- `relations`: optional relation graph metadata emitted by generator

### `tableName` resolution order

`fromModel(database, schema, model)` resolves to:

1. `meta.tableName` when provided
2. `${meta.schema}.${meta.model}` when missing (defaults from registry path)

This means you can keep model names stable even when DB objects are renamed
or cross-namespace.

## 3) Client behavior and type coupling

`createTypedClient(registry, url, apiKey, options?)` returns an `AthenaSdkClient` with registry helpers:

- `.registry`
- `.tenantKeyMap`
- `.tenantContext`
- `.withContext(context)`
- `.withSession(session, options?)`
- `.withTenantContext(context)`
- `.fromModel(database, schema, model)`

`fromModel()` uses registry lookup and then delegates to the same runtime query builder
so chain methods behave exactly like `from()`.

```ts
const typed = createTypedClient(registry, "https://athena-db.com", "secret", {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
    workspaceId: "X-Workspace-Id",
  },
});

await typed
  .withTenantContext({ organizationId: "org-1" })
  .fromModel("app", "public", "users")
  .select("id, email")
  .eq("active", true);
```

Use `withSession(...)` when you already have a session object plus request headers and want the SDK to derive `userId`, `organizationId`, token defaults, and cookies automatically. Use `withContext(...)` for raw request-scoped gateway context such as `userId`, `organizationId`, `forceNoCache`, and extra headers. Keep `withTenantContext(...)` for values that should flow through `tenantKeyMap`.

If you already have the exported Athena table/model value in scope, the root client can also infer the runtime target directly:

```ts
const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);

await athena
  .from(users)
  .select("id, email")
  .eq("active", true);
```

Use the value form for this opt-in shortcut. A type-only call like `from<UserPublicSchema>()` cannot determine a runtime table name after TypeScript erases the generic.

If you want compile-time validation for simple string selects and RPC column names,
enable the experimental strict mode on the client:

```ts
const strictTyped = createTypedClient(
  registry,
  process.env.ATHENA_URL!,
  process.env.ATHENA_API_KEY!,
  {
    experimental: {
      typecheckColumns: true,
    },
  },
);

await strictTyped
  .fromModel("app", "public", "users")
  .select("id, email")
  .order("email");

// compile-time error
strictTyped.fromModel("app", "public", "users").select("id, missing_column");
```

### Tenant context behavior

- returns a new client
- merges new keys into existing context
- maps keys to headers using `tenantKeyMap`
- drops `null` / `undefined` values instead of serializing them

```ts
const scoped = typed.withTenantContext({ organizationId: "org-1" });
const scopedAgain = scoped.withTenantContext({ workspaceId: "ws-2" });
// scopedAgain sends both tenant headers
```

`withContext(...)` also returns a new client, but it targets the root Athena request context instead of the tenant-header map:

```ts
const requestScoped = typed.withContext({
  organizationId: "org-1",
  userId: "user-7",
  forceNoCache: true,
  headers: {
    "X-Request-Id": "req_123",
  },
});
```

## 4) Types generated from model metadata

`defineModel<Row, Insert, Update>(...)` influences type extraction:

- `Row` drives read results (`select` payloads)
- `Insert` defaults to `Partial<Row>`
- `Update` defaults to `Partial<Insert>`

The helper types available at runtime:

- `RowOf<Model>`
- `InsertOf<Model>`
- `UpdateOf<Model>`
- `FormValuesOf<Model>`
- `ModelAt<Registry, DB, Schema, Model>`

If you need explicit override typing for insert/update payloads while still sharing fields, pass the generics directly.

Table definitions also expose live Zod schemas:

- `table.schemas.row`
- `table.schemas.insert`
- `table.schemas.update`
- `table.schemas.form`
- `table.schemaName`
- `table.tableName`
- `table.qualifiedName`

`table.schemas.form.parse(...)` accepts UI-safe empty strings for nullable scalar
fields and normalizes them back to `null` for submit payloads.

## 5) Relation metadata

Generated models can include relation metadata for tooling that reads it.

```ts
type Kind = "one-to-one" | "many-to-one" | "one-to-many" | "many-to-many";

{
  kind: Kind;
  sourceColumns: string[];
  targetSchema: string;
  targetModel: string;
  targetColumns: string[];
  targetDatabase?: string;
  through?: {
    schema: string;
    model: string;
    sourceColumns: string[];
    targetColumns: string[];
  };
}
```

The SDK preserves this metadata and forwards it in generated model files.
`fromModel(...).findMany({ select: { ... } })` uses it for typed relation inference,
while existing string-based `.select(...)` calls remain unchanged.

## 6) Error behavior and guardrails

`fromModel` throws early when registry paths are invalid:

- missing database -> `Unknown database "..."`
- missing schema -> `Unknown schema "..." in database "..."`
- missing model -> `Unknown model "..." in schema "..."`

You can rely on constructor-time errors before making HTTP calls.

## 7) Generator interoperability

The generator can now emit either of two compatible shapes:

- `output.format = "define-model"` (default): `defineModel<...>` with row/insert/update types + metadata
- `output.format = "table-builder"`: `table(...).columns(...).primaryKey(...)` plus exported Zod schemas
- schema files: `defineSchema({ ... })`
- database files: `defineDatabase({ ... })`
- optional registry file: `defineRegistry({ ... })`

That means `generated registry artifacts` can be imported as-is with `createTypedClient(...)`.

### File template defaults

By default, generator target templates are:

- `athena/models/{schema_kebab}/{model_kebab}.ts`
- `athena/schemas/{schema_kebab}.ts`
- `athena/relations.ts`
- `athena/registry.generated.ts` (default safe direct preset)

These can be changed via `output.targets`.

Default safe direct layout:

```ts
output: {
  preset: "athena-direct",
  format: "table-builder",
}
```

That keeps registry output on `athena/registry.generated.ts`, which is usually a
better fit when `athena/config.ts` is a handwritten runtime seam.

## 8) Migration strategy: untyped -> model-first

A practical rollout sequence for existing code:

1. Keep existing `from("table")` or `from("table", { schema: "..." })` call sites untouched for now.
2. Add `table(...)` declarations per bounded domain. Use `defineModel(...)` only for legacy compatibility or when you explicitly need the lower-level contract.
3. Build a local registry from manual contracts.
4. Move call sites to `fromModel(...)` only where stability gains are high.
5. Replace manual contracts with generated output once generator config and checks are stable.

## 9) Configuration tips for stable generation

- Keep naming conventions explicit in config (`modelType`, `modelConst`, etc.)
- Use `filter.includeTables` / `filter.excludeTables` to keep generated surface area small in large schemas
- Use `emitRelations` only when relation metadata consumers are ready
- Use `emitRegistry` when your app imports `registry` as the primary source-of-truth; disable in transitional branches if needed
- Run `athena-js generate --dry-run` in CI to validate output deterministically before writing files

## 10) Model-to-form adapter (React Hook Form + Zod)

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

## 11) Common pitfalls

- Manual `defineModel` and generated model definitions with the same logical key but different metadata
- Using raw DB table names in `fromModel` calls; prefer logical model names and set `tableName` only for legacy mapping
- Assuming relation metadata automatically rewires queries (it is metadata only)
- Skipping tenant header mapping and setting tenant headers manually in each call

## 12) Next

For concrete CLI/config examples, flags, and provider behavior, continue to:

- [`generator-config.md`](generator-config.md)
- [`api-reference.md`](api-reference.md)

