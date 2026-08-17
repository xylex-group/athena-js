# ADR 0001: Use createClient as the only primitive client materializer

**Date:** 2026-07-15
**Status:** Superseded by [0014](0014-next-client-construction-facades.md)
**Author:** Floris
**Accepted by:** Floris
**Pinned versions:**
- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- Node.js `>=18.0.0` - declared engine range.

## Context

The SDK previously constructed equivalent clients through `createClient(...)`, `AthenaClient.builder().build()`, `AthenaClient.fromEnvironment()`, `createTypedClient(...)`, and framework wrappers that recreated construction logic or cached singletons. Those entrances converged on the same root client materialization logic but required separate overloads, types, tests, documentation, and migration knowledge.

The object overload of `createClient` already expresses unified-root routing, direct service overrides, authentication, models, storage options, headers, backend selection, and diagnostics. The builder provides no unique runtime capability. Static environment and framework constructors primarily resolve inputs before re-entering client construction.

## Original decision

**Decision:** `createClient(config)` is the only public API allowed to materialize an Athena runtime client core.

The v3 constructor is object-only. Environment inputs, model registries, service overrides, and request-context providers are fields of its single configuration contract.

The `AthenaClient` name becomes the public client interface and is no longer a static factory class.

## Supersession (ADR 0014)

ADR 0014 narrows this decision without abandoning it:

- **Still true:** only `createClient` implements client materialization; builder/static/typed alternate materializers remain forbidden.
- **Relaxed:** thin framework façades such as `createAthenaBrowserClient` and `createAthenaServerClient` may exist when they only adapt inputs and call `createClient`.

See [0014](0014-next-client-construction-facades.md) for the façade contract and validation rules.

## Contract (narrowed after 0014)

- `createClient(config)` is synchronous and returns `AthenaClient<TModels>`.
- `createClient(url, key, options)` is not part of the public surface.
- `AthenaClient.builder()` and `AthenaClient.fromEnvironment()` are forbidden public APIs.
- `createTypedClient` as a separate materializer remains forbidden.
- `athenaAuth` remains public because it constructs the server authentication plugin rather than an Athena SDK client.
- Framework, environment, session, and tenant utilities may resolve data consumed by `createClient`.
- Framework packages may expose thin construction façades that delegate to `createClient` (ADR 0014).
- Only one internal function may materialize a client core.
- The root and browser conditional bundles export the same `createClient` signature.

## Consequences

- Configuration becomes explicit, immutable, and mechanically searchable.
- Builder merge semantics and constructor overload matrices disappear.
- Future constructor features extend one config object rather than adding another materializer.
- Discoverable Next entrypoints can exist without reintroducing a second construction spine.

## Validation

- `rg` must find no exported `class AthenaClient`, `AthenaClientBuilder`, or `createTypedClient` materializer in public declarations.
- Thin Next façades must delegate to `createClient` (ADR 0014 tests).
- `test/type-compatibility-v3.ts` must compile object-only `createClient` examples and reject removed materializer forms.
- `test/browser-entry.test.ts` must verify `createClient` is present and the static `AthenaClient` value is absent.
- `pnpm typecheck`, `pnpm build`, and `pnpm check:all` must pass before release.
