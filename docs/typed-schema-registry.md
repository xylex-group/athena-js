# Typed schema registry and model-first client usage

The typed layer gives you explicit model contracts while preserving the same runtime API (`from`, `fromModel`, `rpc`, `query`, filters, and mutations).

## Why this exists

- stable typing for rows, insert payloads, and update payloads
- logical model naming that can stay stable while DB names change
- one place for schema metadata (`primaryKey`, `nullable`, relation hints)
- generator-to-runtime parity for source-of-truth model contracts

## 1) Build model contracts

```ts
import {
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const users = defineModel<
  { id: string; email: string; createdAt: string | null }, // Row
  { id?: string; email: string }, // Insert
  { email?: string } // Update
>({
  meta: {
    primaryKey: ["id"],
    nullable: { id: false, email: false, createdAt: true },
  },
});

const publicSchema = defineSchema({ users });
const appDb = defineDatabase({ public: publicSchema });
const registry = defineRegistry({ primary: appDb });
```

`defineModel` is a typed identity helper:

- `Row` is required and drives `select`/query typing.
- `Insert` defaults to `Partial<Row>` unless provided.
- `Update` defaults to `Partial<Insert>` unless provided.
- `meta` stores schema metadata consumed by runtime/table resolution.

### What metadata is expected

- `primaryKey: string[]` (required)
- `database`, `schema`, `model` (logical names, optional)
- `tableName` (exact SQL table name override; takes precedence)
- `nullable` map (`column -> boolean`)
- `relations` map (from generator, optional)

## 2) Use typed client in place of runtime client

`createTypedClient(registry, url, apiKey, options?)` returns a client compatible with the base `AthenaSdkClient` surface plus typed model lookup helpers:

- `.registry`
- `.tenantKeyMap`
- `.tenantContext`
- `.withTenantContext(context)`
- `.fromModel(database, schema, model)`

```ts
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const registry = defineRegistry({
  primary: defineDatabase({
    public: defineSchema({
      users: defineModel<{ id: string; email: string }>({
        meta: {
          primaryKey: ["id"],
          nullable: { id: false, email: false },
        },
      }),
    }),
  }),
});

const typed = createTypedClient(registry, "https://athena.example.com", process.env.ATHENA_API_KEY!, {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
  },
});

const users = await typed
  .withTenantContext({ organizationId: "org_123" })
  .fromModel("primary", "public", "users")
  .select("id, email")
  .eq("active", true)
  .limit(20);
```

`fromModel(database, schema, model)` resolves at runtime by:

1. locating model metadata in `registry[database].schemas[schema].models[model]`
2. using `meta.tableName` when set
3. else resolving to `<meta.schema ?? schema>.<meta.model ?? model>`

## 3) Tenant context behavior

```ts
typed.withTenantContext({
  organizationId: "org_456",
  workspaceId: "ws_001",
});
```

Behavior:

- returns a new typed client (immutability)
- maps tenant keys to headers via `tenantKeyMap`
- merges those values into request headers on the scoped client
- ignores missing values (`null` / `undefined`) for a clean header set

## 4) Relation metadata

Generated output can include relation metadata:

```ts
type Kind = "one-to-one" | "many-to-one" | "one-to-many" | "many-to-many";

{
  kind: Kind;
  sourceColumns: string[];
  targetSchema: string;
  targetModel: string;
  targetColumns: string[];
  through?: {
    schema: string;
    model: string;
    sourceColumns: string[];
    targetColumns: string[];
  };
}
```

The SDK currently preserves this metadata for downstream tooling and generator consumers; it does not yet drive query joins automatically.

## 5) Migration strategy: untyped → model-first

Recommended progression:

1. keep `createClient(...).from("users")` for most code
2. add typed models for stable domains
3. migrate call sites one bounded area at a time to `fromModel(...)`
4. switch source-of-truth to generated contracts once your schema contract is stable

The runtime surface (`query`, `rpc`, `select`, filters, pagination) remains the same.

## 6) Generator coupling

The generator emits exactly the same primitives and metadata this file documents:

- per-table model files (`defineModel` + `Row`, `Insert`, `Update`)
- per-schema files (`defineSchema`)
- per-database files (`defineDatabase`)
- optional root registry (`defineRegistry` when `features.emitRegistry` is true)

See [`generator-config.md`](generator-config.md) for provider config, output paths, and feature flags.

## 7) Troubleshooting typed contracts

### Unknown path in `fromModel`

If `fromModel` throws:

- verify `registry` nesting keys for `database / schema / model`
- check exact key casing
- ensure generated file names match placeholder transforms used in your generator config

### Inferred types are too narrow/wide

- inspect `Insert` / `Update` generic arguments in `defineModel`
- ensure `nullable` reflects DB behavior where applicable
- keep column keys exactly aligned with DB names (generator handles reserved names safely)

### Tenant headers not arriving

- confirm `tenantKeyMap` key-to-header mapping
- check one request path at a time (`withTenantContext` + one typed query)
- confirm values are serializable (`string | number | boolean | null | undefined`)

## 8) Anti-patterns

- forcing global `fromModel(...)` migration before contracts are complete
- mixing generated and handwritten `meta` assumptions in the same feature area
- manually editing generated registry artifacts without regeneration

## 9) Next

- [`generator-config.md`](generator-config.md) for how contracts are generated
- [`api-reference.md`](api-reference.md) for full API signatures
