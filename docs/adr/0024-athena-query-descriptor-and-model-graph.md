# ADR 0024: Athena query descriptor and model graph

**Date:** 14 August 2026
**Status:** Proposed
**Author:** Floris
**Accepted by:** Floris
**Depends on:** [0003](0003-model-derived-query-typing.md), [0004](0004-root-client-owns-typed-registry-behavior.md), [0006](0006-immutable-client-core-and-context-views.md), [0021](0021-layered-contract-policy.md)
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range

## Context

Athena already has models (`AthenaModelTarget`), a fluent `from(model)` DSL, a portable `AthenaReadQueryDefinition`, an Athena-native `AthenaQueryClient`, and a HeroUI table hook that re-implements TanStack keys over the same executor.

Those layers do not share identity:

- `from(model)` discards the model after resolving `tableName`.
- Builders are mutable and have no serializable descriptor.
- `AthenaQueryDebugAst` / findMany gateway AST are transport/debug snapshots, not cache IR.
- `useAthenaReadQuery` and HeroUI `useAthenaQuery` each reconstruct a cache key from definition fields.
- `AthenaQueryClient` is a token-keyed observer store: no `getQueryData` / `setQueryData` / `invalidateQueries`, no stored structured key, no entity graph.

A second Model Query DSL (`queryClient.model(File).query(...)`) would split the only strong property Athena has: one way to describe a database operation.

## Decision

**AthenaModels and the fluent DSL are the semantic backbone of the TypeScript application layer.** Cache, mutations, React hooks, and HeroUI are projections of one IR: `AthenaQueryDescriptor`.

```text
AthenaModel + athena.from(Model)…
        │
        ▼
AthenaQueryDescriptor  (cache IR)
        │
        ├── Query result cache
        └── Entity graph (model + access context + PK)
                │
        ┌───────┴────────┐
        ▼                ▼
  Athena React      HeroUI (presentation)
```

### Invariants

1. There is **one** database DSL: `athena.from(Model)…`. MUST NOT add `queryClient.model(File).query(...)` as a primary syntax.
2. The cache IR is `AthenaQueryDescriptor`, **not** SQL, **not** `AthenaQueryDebugAst`, **not** `AthenaFindManyAstPayload`.
3. `AthenaReadQueryDefinition` remains the portable page-read / `dataProxy` body. It is a projection of the descriptor, not a second language, and MUST NOT be deleted.
4. HeroUI AUTH/org/workspace TanStack cache stays. Only DATABASE table queries move to Athena React. `@tanstack/react-query` remains a HeroUI peer.
5. Presentation lives in `defineModelView`, **not** on `ModelMetadata` (extends [0021](0021-layered-contract-policy.md): persistence ≠ view).
6. `getQueryData` MUST NOT create idle cache entries (`getQueryState` may still do so for subscribe).
7. Invalidation matches **stored structured keys**, never serialization-token prefixes.

### Structured key matching (Phase 1)

`QueryEntry` stores the original `QueryKey`. `safeSerializeQueryKey` is the Map address only.

| Filter / stored | Rule |
| --- | --- |
| Both arrays, `exact: false` | Tuple prefix: each `filter[i]` structurally equals `stored[i]` |
| Both arrays, `exact: true` | Same length and every element structurally equal |
| Filter is a `string` | Equality only against a stored string. `"athena"` does not match `"athena-files"` or `["athena", …]` |
| Array vs string | No match |

MUST NOT implement `token.startsWith(filterToken)`.

### Descriptor (Phase 2)

Reads and writes share one protocol from day one:

```ts
interface AthenaExecutable<TResult> {
  getDescriptor(): AthenaQueryDescriptor
  execute(): Promise<TResult>
}
```

`select` / `insert` / `update` / `upsert` / `delete` chains implement `AthenaExecutable`. Phase 2 React consumes reads (`useAthenaQuery`). Phase 3 consumes writes (`useAthenaMutation`). Do not introduce a read-only `AthenaExecutableQuery` type.

The compiler emits a frozen descriptor including **compiled dependency metadata** and **two-level keys**:

```ts
interface AthenaQueryDescriptor {
  version: 1
  target: AthenaQueryTarget
  operation: AthenaQueryOperation
  projection?: AthenaProjectionDescriptor
  filters?: readonly AthenaFilterDescriptor[]
  relations?: readonly AthenaRelationDescriptor[]
  order?: readonly AthenaOrderDescriptor[]
  range?: AthenaRangeDescriptor
  context?: AthenaCacheContextDescriptor
  dependency?: {
    models: readonly AthenaModelDependency[]
    fields: readonly AthenaFieldDependency[]
    relations: readonly AthenaRelationDependency[]
  }
  modelScopeKey: readonly unknown[]  // athena + model + context + qualified table
  queryKey: readonly unknown[]       // modelScopeKey + operation + hashes
}
```

`modelScopeKey` is a tuple prefix of `queryKey`, so `invalidateQueries({ queryKey: descriptor.modelScopeKey })` is model-scoped invalidation without scanning descriptor structure.

`from(model)` MUST retain `AthenaModelTarget` on builder state. `getDescriptor()` is a live snapshot; React hooks (Phase 2b) freeze that snapshot on subscribe. Cache context on the descriptor is **tenant identity only** (`organizationId` / `userId`), never session tokens.

### Entity identity (Phase 3)

`modelIdentity(model, row)` yields only the primary-key slice. The graph node key is:

```ts
interface AthenaEntityKey {
  model: AthenaModelIdentity
  context: AthenaEntityContextIdentity
  primaryKey: AthenaPrimaryKey
}
```

The same physical row observed through different `withContext` / access envelopes MUST NOT share a node. Context identity is designed with `modelIdentity`, not bolted on after normalize.

### Package boundary

`@xylex-group/athena` owns models, DSL, descriptor, execution, query identity, `AthenaQueryClient`, entity graph, React data hooks, portable `defineModelView`.

`@xylex-group/athena-auth-ui` owns rendering, pagination UX, filters UI, forms chrome, `dataProxy` route, compiling views to HeroUI. After Phase 4 it MUST NOT construct DATABASE query identity. It accepts `AthenaExecutable` or `AthenaReadQueryDefinition`. `queryKeyPrefix` is a compatibility escape hatch only.

### Public API progression

```text
Phase 1  getQueryData / setQueryData / invalidateQueries
Phase 2  AthenaExecutable.getDescriptor() / modelScopeKey+queryKey / useAthenaQuery(read)
Phase 3  forModel / modelIdentity / AthenaEntityKey / useAthenaMutation
Phase 4  HeroUI DB hooks delegate to Athena React; AthenaTable model/query layers
Phase 5  defineModelView (full presentation contract) / AthenaModelTable / AthenaModelForm
```

`defineModelView` covers label, plural label, default projection/order, identity title/subtitle, column visibility, formatting intent, filter capabilities, form field intent, searchability, read-only intent, and relation presentation — not column cosmetics only.

## Non-goals

- A second Model Query DSL on the query client
- Replacing AUTH TanStack caches
- HeroUI chips/colors on `ModelMetadata`
- Treating debug/gateway AST as cache keys
- Deleting `AthenaReadQueryDefinition` / `useAthenaReadQuery`
- Flipping default `AthenaQueryClient` `cache.mode` in Phase 1

## Consequences

- Descriptor-backed queries will opt into memory-cache semantics; the constructor default remains `"none"` until a later decision.
- Apps that use HeroUI tables will mount `AthenaQueryClientProvider` beside the existing TanStack provider.
- Delete/update identity will eventually use `meta.primaryKey` when `from(model)` is used, instead of only `id` / `resource_id`.
- Status remains **Proposed** until Phase 4 lands HeroUI database-cache convergence. Phases 1–3 (cache primitives, descriptor, entity graph, `useAthenaMutation`) are implemented.
- `setQueryData` MUST bump `activeRequestId` so in-flight fetches cannot overwrite a manual write.

## Validation

- Phase 1: `getQueryData` does not create entries; structural prefix tests; no serialized-prefix matches; existing `react-query-client*.test.ts` still pass.
- Phase 2: descriptor snapshot stability, filter-order independence, tenant context isolation.
- Phase 3: entity keys include context; field∩filter invalidation; `displayName` vs `category` membership cases.
- Phase 4: HeroUI table hook has no `@tanstack/react-query` import; auth-cache tests untouched.

## Related work

- Extends [0003](0003-model-derived-query-typing.md) (models remain the known-shape source)
- Extends [0004](0004-root-client-owns-typed-registry-behavior.md) (`from(model)` remains the DSL)
- Extends [0006](0006-immutable-client-core-and-context-views.md) (context views become entity-key scope)
- Extends [0021](0021-layered-contract-policy.md) (`defineModelView` is the View layer)
