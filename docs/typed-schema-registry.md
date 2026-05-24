# Typed schema registry and model contracts

The typed layer is the SDK's schema contract system. It keeps model metadata in TypeScript,
ensures runtime calls line up with table names, and lets the generator emit those same contracts for you.

## Why it exists

Use registry models when two things start to become expensive:

- duplicated row types across call sites
- schema changes causing drift between runtime strings and typed assumptions

The model system reduces both by introducing a source-of-truth object graph:
`registry -> database -> schema -> model -> metadata/metadata types`.

`createClient(...).from<Table>("table")` remains valid and fully supported. The typed path is additive.

## 1) Core contracts

`defineModel`, `defineSchema`, `defineDatabase`, and `defineRegistry` are lightweight identity builders with explicit type signatures.

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

## 2) Model metadata contract

`meta` is where runtime behavior and typed metadata are stored.

- `primaryKey: string[]` (required)
- `database`, `schema`, `model`: logical naming hints
- `tableName`: explicit SQL table target; overrides `schema.model`
- `nullable`: map used to shape insert/update inference and nullability
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

## 4) Types generated from model metadata

`defineModel<Row, Insert, Update>(...)` influences type extraction:

- `Row` drives read results (`select` payloads)
- `Insert` defaults to `Partial<Row>`
- `Update` defaults to `Partial<Insert>`

The helper types available at runtime:

- `RowOf<Model>`
- `InsertOf<Model>`
- `UpdateOf<Model>`
- `ModelAt<Registry, DB, Schema, Model>`

If you need explicit override typing for insert/update payloads while still sharing fields, pass the generics directly.

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

The SDK preserves this metadata and forwards it in generated model files. It does not perform automatic join expansion in current query builders.

## 6) Error behavior and guardrails

`fromModel` throws early when registry paths are invalid:

- missing database -> `Unknown database "..."`
- missing schema -> `Unknown schema "..." in database "..."`
- missing model -> `Unknown model "..." in schema "..."`

You can rely on constructor-time errors before making HTTP calls.

## 7) Generator interoperability

The generator outputs directly in the same shape:

- model files: `defineModel<...>` with row/insert/update types + metadata
- schema files: `defineSchema({ ... })`
- database files: `defineDatabase({ ... })`
- optional registry file: `defineRegistry({ ... })`

That means `generated registry artifacts` can be imported as-is with `createTypedClient(...)`.

### File template defaults

By default, generator target templates are:

- `athena/models/{schema_kebab}/{model_kebab}.ts`
- `athena/schemas/{schema_kebab}.ts`
- `athena/relations.ts`
- `athena/config.ts`

These can be changed via `output.targets`.

## 8) Migration strategy: untyped -> model-first

A practical rollout sequence for existing code:

1. Keep existing `from("table")` call sites untouched for now.
2. Add `defineModel` declarations per bounded domain.
3. Build a local registry from manual contracts.
4. Move call sites to `fromModel(...)` only where stability gains are high.
5. Replace manual contracts with generated output once generator config and checks are stable.

## 9) Configuration tips for stable generation

- Keep naming conventions explicit in config (`modelType`, `modelConst`, etc.)
- Use `emitRelations` only when relation metadata consumers are ready
- Use `emitRegistry` when your app imports `registry` as the primary source-of-truth; disable in transitional branches if needed
- Run `athena-js generate --dry-run` in CI to validate output deterministically before writing files

## 10) Common pitfalls

- Manual `defineModel` and generated model definitions with the same logical key but different metadata
- Using raw DB table names in `fromModel` calls; prefer logical model names and set `tableName` only for legacy mapping
- Assuming relation metadata automatically rewires queries (it is metadata only)
- Skipping tenant header mapping and setting tenant headers manually in each call

## 11) Next

For concrete CLI/config examples, flags, and provider behavior, continue to:

- [`generator-config.md`](generator-config.md)
- [`api-reference.md`](api-reference.md)

