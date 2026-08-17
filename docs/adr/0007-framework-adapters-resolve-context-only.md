# ADR 0007: Framework adapters resolve context (and may compose createClient)

**Date:** 2026-07-15
**Status:** Superseded by [0014](0014-next-client-construction-facades.md)
**Author:** Floris
**Accepted by:** Floris
**Pinned versions:**
- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- Node.js `>=18.0.0` - declared engine range.

## Context

The Next subpaths previously exposed browser and server client constructors that either cached singletons or recreated construction paths. Framework-specific code is still needed for `next/headers`, session bridges, route helpers, cookie detection, and auth URL behavior.

ADR 0007 originally prohibited adapters from constructing clients at all so applications would own lifetime and context would stay request-scoped.

## Original decision

**Proposition:** Framework adapters will resolve request/session context and bridge behavior only; they will not construct or cache Athena clients.

## Supersession (ADR 0014)

ADR 0014 keeps the durable constraints and relaxes the absolute ban on calling `createClient` from framework entrypoints:

- **Still true:** no request-bound client caching; no second transport/core implementation; browser and server export separation; resolvers remain available.
- **Relaxed:** Next may export thin façades that resolve context (and optional session identity) and then call `createClient`.

See [0014](0014-next-client-construction-facades.md).

## Contract (narrowed after 0014)

- `@xylex-group/athena/next/server` exports `resolveNextRequestContext` / `resolveAthenaServerContext` and may export `createAthenaServerClient` as a façade over them.
- The server resolver reads current headers/cookies on every invocation unless explicit inputs are supplied.
- `@xylex-group/athena/next/client` retains browser bridge, route, cookie, and URL utilities and may export `createAthenaBrowserClient` as a thin typed façade.
- No framework adapter stores a module-level request-bound client.
- Framework adapters return plain context/session DTOs from resolvers with exact field meanings.
- The root `createClient` remains the sole materializer; façades must not reimplement construction.
- Session bridge routes and cookie names remain unchanged unless separately versioned.
- Adapter subpaths remain browser/server separated in the package export map.

## Consequences

- Applications still own client singleton lifetime.
- Next integration is convenient without reconstructing the constructor matrix.
- Server-only dependencies cannot leak into browser bundles through root client construction.
- Advanced consumers can keep using resolvers + `withContext` without the server factory.

## Validation

- Next façades must call `createClient` only for materialization (no alternate core builder).
- Next tests must verify cookie, authorization, user, organization, and no-cache resolution.
- Session bridge tests must remain green.
- Package export tests must preserve `./next/client` and `./next/server` separation.
- Browser bundle analysis must show no `next/headers` import from the client entry.
- `pnpm typecheck`, Next tests, browser tests, and `pnpm build` must pass.
