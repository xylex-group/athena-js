# ADR 0005: Use a runtime-neutral client with per-operation request context

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

Browser fetch can use ambient cookies with `credentials: 'include'`. Server fetch requires explicit forwarding of the current request cookie, authorization bearer token, session token, user ID, and organization ID. Resolving those values during construction makes a module-level server client unsafe because request identity can be captured and reused.

The package already has conditional root/browser exports. The remaining difference is request context, not client identity.

## Decision

**Proposition:** `createClient` remains synchronous and runtime-neutral, while request identity is resolved lazily for every operation through an optional `AthenaRequestContextProvider`.

## Contract

- `createClient` never returns `AthenaClient | Promise<AthenaClient>`.
- `AthenaRequestContext` includes user ID, organization ID, headers, cookie, bearer token, session token, and no-cache behavior.
- A context provider may be synchronous or asynchronous.
- The provider executes for each DB, RPC, raw, auth, chat, and storage operation that emits a request.
- Request context is never cached across server requests.
- Static client configuration contains no request-bound credential by default.
- Header precedence is: core defaults, static client context, per-operation provider context, `withContext` view context, then per-operation headers.
- Explicit `null` credential fields clear inherited credentials; `undefined` preserves normal resolution semantics.
- Browser credentials default behavior remains documented and consistent across auth calls.
- The browser conditional bundle contains no Node-only request-context dependency.

## Consequences

- One long-lived client can be safe when its provider resolves the active request lazily.
- All service transports must share context resolution semantics.
- WebSocket/chat connection setup must snapshot context at connection time and document refresh behavior.
- Provider failures need structured boundary normalization.
- Context resolution adds a small async step to each request path.

## Validation

- A concurrency test must interleave two request contexts and prove no cookie, bearer, user, or organization leakage.
- Tests must cover header precedence and explicit credential clearing.
- DB, auth, chat, storage, and raw request tests must observe the same resolved context.
- Browser-entry tests must prove Node/Next request modules are absent from the browser graph.
- A test must prove `createClient` stays synchronous with an async context provider.
- `pnpm typecheck`, focused context tests, browser tests, and `pnpm build` must pass.
