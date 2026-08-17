# ADR 0006: Share one immutable client core across context views

**Date:** 2026-07-15
**Status:** Accepted
**Author:** Floris
**Accepted by:** Floris
**Pinned versions:**
- `athena-monorepo-root@3.29.0` - current repository manifest.
- `@xylex-group/athena@2.16.0` - current SDK baseline.
- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- `athena-auth-ui@1.16.1` - current local dependent baseline.
- Node.js `>=18.0.0` - declared engine range.

## Context

Current `withContext`, `withSession`, and `withOptions` methods call the root construction pipeline again. They recreate transports, tracers, formatters, namespaces, and storage modules. Storage clients duplicate these functions to preserve a different return type. `TypedAthenaClientImpl` repeats the same reconstruction pattern.

Request scoping does not require rebuilding stable endpoints, model metadata, policies, or transports.

## Decision

**Proposition:** Client construction creates one immutable `AthenaClientCore<TModels>`; context changes create lightweight `AthenaClient<TModels>` views that share that core.

## Contract

- The core owns resolved service routing, API key, backend, models, transports, retry policy, and diagnostics.
- A view owns only static context and/or a context provider reference.
- `withContext(context)` returns the same `AthenaClient<TModels>` type.
- `withContext` must not call `createClient` or recreate transports.
- `withOptions` is absent because endpoint/key retargeting is construction.
- `withSession` is absent; session-to-context conversion belongs to framework or application helpers.
- Context views are immutable and may safely coexist.
- Deferred query builders capture the view/context semantics documented at builder creation; execution-time provider resolution must be explicit and tested.
- Core state contains no mutable request identity.

## Consequences

- Context operations become cheaper and type-neutral.
- Internal modules need a common request execution boundary capable of resolving view context.
- Tests may assert shared core identity through internal test hooks without exposing the core publicly.
- Retargeting a client requires a new `createClient` call, which makes configuration changes visible.
- Query execution timing must be documented for context providers.

## Validation

- Instrumented tests must prove repeated `withContext` calls do not recreate gateway/auth/chat/storage transports.
- Context-view tests must prove isolation between sibling views.
- Deferred query tests must verify the chosen context-resolution timing.
- `rg` must find no `createClientFromInput` call inside context-view methods after migration.
- Performance tests should compare base construction and view creation allocations.
- Focused query, auth, chat, storage, and type tests plus `pnpm typecheck` must pass.
