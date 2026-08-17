# Athena JS 3 type-surface manifest

## Root client

```ts
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels>
```

`AthenaClient<TModels>` is the only public SDK client identity. It always exposes `db`, `auth`, `chat`, `storage`, `from`, `rpc`, `query`, `request`, `verifyConnection`, and `withContext`.

## Model inference

When `models` is supplied, table names, rows, inserts, updates, and known columns derive from the registry. Explicit row types remain supported:

```ts
const typed = createClient({ url, key, models: registry })
await typed.from(registry.app.schemas.public.models.users).select("id,email")
await typed.from("users").findMany({
  select: { id: true, email: true },
})

const dynamic = createClient({ url, key })
await dynamic.from<UserRow>("users").select("id,email")
await dynamic.from<UserRow>("users").findMany({
  select: { id: true, email: true },
})
```

Known model columns are typechecked for both string/array `.select(...)` inputs and object-select keys on `.findMany({ select })`. Unknown scalar select keys fail at compile time. Relation nodes in `findMany` select trees still allow non-row keys (relation names). Dynamic clients without model information continue accepting free-form table and column names.

## Request context

`AthenaRequestContext` carries user and organization scope, custom headers, cookie, bearer/session tokens, and no-cache behavior. `AthenaRequestContextProvider` may resolve synchronously or asynchronously before each operation.

## Configuration errors

Every namespace exists in the type surface. Calling a service without a resolved route throws `AthenaConfigurationError` with service-specific metadata. The public return type never changes based on which service objects were configured.

## Removed type families

Athena JS 3 has no capability-specific clients, builder-state clients, strictness generic, environment-specific client identity, or storage-enabled return type. The v2-to-v3 replacement table lives in [`migration-v2-to-v3.md`](migration-v2-to-v3.md).
