# ADR 0004: Make the root client own typed-registry behavior

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

The SDK currently supports typed behavior through both `createClient({ models })` and `createTypedClient(registry, url, key, options)`. `TypedAthenaClientImpl` wraps a base client and duplicates construction, session-context resolution, header/auth merging, tenant mapping, context cloning, method forwarding, registry navigation, and strictness overloads.

Root model-value access and model-map inference now cover the primary reasons for a separate typed constructor.

## Decision

**Proposition:** `createClient({ models })` will be the sole typed-client construction path, and typed-registry behavior will be part of `AthenaClient<TModels>`.

## Contract

- `createTypedClient`, `TypedAthenaClient`, `TypedClientOptions`, and their strictness variants are absent from v3.
- `createClient({ models })` infers and preserves the exact supplied model/registry type.
- `from(modelValue)` remains the preferred direct model path.
- Registry-aware table-name inference remains available from the root client.
- If `fromModel(database, schema, model)` remains, it is a method of `AthenaClient<TModels>` and uses the same core transport.
- Tenant header mapping is request-context behavior or an independent utility, not a client implementation.
- Registry navigation errors preserve exact database/schema/model names and remain deterministic.
- Generated registry artifacts remain directly consumable without wrapper conversion.

## Consequences

- `src/schema/typed-client.ts` can be deleted after unique navigation utilities are relocated.
- Typed and untyped consumers share one runtime implementation.
- Tenant-context consumers require a migration to context providers or utilities.
- The root client generic and model utility types become the single source of inference truth.
- Docs no longer teach a separate advanced client.

## Validation

- Existing `createTypedClient` runtime/type fixtures must be rewritten against `createClient({ models })` before the implementation is removed.
- Tests must cover `from(modelValue)`, typed table strings, registry navigation, tenant headers, context views, and generated registries.
- `rg` must find no exported `createTypedClient` or `TypedAthenaClient` in v3.
- Browser-entry tests must prove model-aware root construction remains browser-safe.
- `pnpm typecheck`, typed-schema tests, generator tests, and `pnpm build` must pass.
