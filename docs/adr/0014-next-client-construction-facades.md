# ADR 0014: Permit thin Next client construction façades

**Date:** 2026-07-17
**Status:** Accepted
**Author:** Floris
**Accepted by:** Floris
**Supersedes:** [0001](0001-single-create-client-constructor.md), [0007](0007-framework-adapters-resolve-context-only.md)
**Pinned versions:**
- `@xylex-group/athena@3.0.3` - current JS SDK package version.
- Node.js `>=18.0.0` - declared engine range.

## Context

ADR 0001 forbade every alternate public constructor, including `createAthenaBrowserClient` and `createAthenaServerClient`, because the SDK previously maintained multiple independent materialization paths (builder, typed client, environment statics, and framework wrappers with caches).

ADR 0007 then limited Next adapters to context and bridge resolution only so framework code could not reconstruct clients or hide request-bound singletons.

That preserved a valuable invariant—one internal construction spine—but forced every Next consumer to rebuild the same thin adapter:

- browser-safe config typing without `env` or request providers
- server resolution of cookies, bearer tokens, session identity, and cache policy
- explicit import paths for Client Components vs Server Components

The earlier risk was **duplicate materializers**, not **multiple public entrypoints that all call one materializer**.

## Decision

**Decision:** `createClient(config)` remains the only primitive that materializes an Athena runtime client core. Framework packages may expose thin construction façades when they satisfy all of the following:

1. They delegate to `createClient` and contain no duplicate transport or core construction.
2. They add only runtime-specific typing and/or context resolution.
3. They do not cache request-bound clients.
4. They do not implicitly read browser environment variables.
5. Application code owns singleton lifetime.

### Permitted façades

| Entrypoint | Contract |
| --- | --- |
| `createAthenaBrowserClient(config)` from `@xylex-group/athena/next/client` | Synchronous. Requires explicit `url` and `key`. Omits `env` and `context` from its public config type. No caching. Calls `createClient(config)`. |
| `createAthenaServerClient(options)` from `@xylex-group/athena/next/server` | Asynchronous. Accepts flat client config plus Next request options and optional session. Requires either explicit `{ url, key }` or `{ env }`. Resolves request context (and session identity) on every invocation, merges with any configured context, then calls `createClient`. |

### Still forbidden

- `AthenaClient.builder()` / `AthenaClient.fromEnvironment()` as public factories
- `createTypedClient(...)` as a separate materializer
- Positional `createClient(url, key, options)`
- Module-level browser or server client caches inside the SDK
- Zero-argument server construction that silently reads global `process.env`

## Contract

- Public construction entrypoints may be multiple; internal materialization remains singular.
- `createClient` stays synchronous and runtime-neutral (ADR 0005).
- Context views still share one immutable core (ADR 0006).
- Context merging (including nested headers) uses one shared helper for core views and Next façades.
- Configuration failures use structured `AthenaConfigurationError` codes, including Next server runtime failures.
- Existing context resolvers (`resolveNextRequestContext`, `resolveAthenaServerContext`) remain available for advanced integrations.
- Package export map keeps `./next/client` and `./next/server` separation; no new export paths are required for these façades.

## Consequences

- Next apps regain a discoverable construction path without reintroducing constructor-matrix drift.
- ADR 0001’s main benefit is preserved: one place implements client construction.
- ADR 0007’s main benefit is preserved: adapters do not own request-scoped singleton lifetime.
- Consumers may keep using root `createClient` + manual `withContext` if they prefer.
- Documentation and migration tables should describe the façades as convenience layers over `createClient`, not alternate client implementations.

## Validation

- `createAthenaBrowserClient` and `createAthenaServerClient` must call `createClient` only (no second core builder).
- Browser factory tests must prove no module-level cache and no `env`/`process` coupling.
- Server factory tests must prove cookie, bearer, header, session user, organization, and no-cache forwarding, plus fresh resolution per invocation.
- Source of `src/next/client.ts` must not import `next/headers` or Node-only modules.
- `pnpm typecheck`, Next adapter tests, v3 type-compatibility fixtures, and `pnpm build` must pass.
