# ADR 0011: Graduate storage into the base Athena client

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

In `@xylex-group/athena@2.16.0`, storage is configured across three different locations. `storage` and `storageUrl` select the service route, while `experimental.storage` supplies storage runtime hooks and `experimental.directStorageUpload` configures direct uploads. The `client.storage` namespace exists only when `experimental.athenaStorageBackend` is `true`.

That flag changes both runtime object shape and the TypeScript return type. The SDK therefore exposes `AthenaCreateClientOptionsWithStorage`, `AthenaCreateClientConfigWithStorage`, `AthenaSdkClientWithStorage`, builder state generics, overload branches, and casts solely to express that one namespace was enabled. Consumers that know storage exists still resort to casts when inference crosses wrapper boundaries.

Storage now has a defined module, route manifest, file facade, upload behavior, error contract, browser support, and React integration. Its capability boundary is mature enough to be part of the ordinary client.

## Decision

**Proposition:** `createClient(config)` always exposes `client.storage`, and all storage routing and behavior are configured through the normal `storage` option without `experimental.athenaStorageBackend`.

The canonical configuration shape is:

```ts
const client = createClient({
  url,
  key,
  storage: {
    url: storageUrl,
    directUpload: {
      endpoint,
    },
    hooks,
  },
})

await client.storage.file.upload(input)
```

## Contract

- Every client returned by `createClient` exposes a non-optional `storage: AthenaStorageModule` namespace.
- `experimental.athenaStorageBackend` is removed and has no v3 replacement flag.
- `AthenaSdkClientWithStorage`, `AthenaCreateClientOptionsWithStorage`, `AthenaCreateClientConfigWithStorage`, storage-enabled builder states, and storage-specific constructor overloads are removed.
- `storage?: AthenaCreateClientStorageOptions` is the canonical storage configuration property.
- `AthenaCreateClientStorageOptions` owns the storage service `url`, direct-upload configuration, transport hooks, and other `AthenaStorageClientConfig` behavior.
- `experimental.storage` moves to `storage`; `experimental.directStorageUpload` moves to `storage.directUpload`.
- `storageUrl` may exist only as a documented transition alias. The canonical v3 documentation and generated examples use `storage.url`.
- Storage route precedence is explicit storage URL, then unified Athena root routing, then a structured `ATHENA_SERVICE_NOT_CONFIGURED` error when storage is invoked.
- A missing storage route does not remove `client.storage`, change the client return type, or make the property `undefined`.
- Implementations may initialize storage internals lazily, but lazy initialization must not change the public object shape or first-call result contract.
- Auth, organization, user, cookie, bearer, session, custom, and SDK headers use the same shared request-context precedence as other Athena services.
- Browser direct upload must not expose secret server credentials. Signing, managed-file metadata, progress, cancellation, and result behavior remain part of the storage contract.
- Storage errors retain the documented Athena storage error envelope and are distinguishable from service-configuration failures.
- The package root and browser conditional exports expose the same `client.storage` declaration.

## Consequences

- Normal consumers no longer opt in, narrow a return type, or cast to use storage.
- The storage namespace becomes part of the package compatibility promise and follows ordinary semantic-versioning rules.
- The storage module may contribute to the default bundle unless internal lazy construction and tree shaking are preserved.
- Applications using `experimental.storage` or `experimental.directStorageUpload` require a mechanical configuration migration.
- Existing code that used the absence of `client.storage` as a feature probe must instead inspect configuration or handle the structured service error.
- This record refines the storage clauses in ADR 0002 and the routing clauses in ADR 0008; it does not create a second client identity.

## Validation

- Type fixtures must prove that ordinary `createClient({ url, key })` exposes `client.storage` without a flag or cast.
- `rg` over v3 source, emitted declarations, tests, and generated docs must find no public `athenaStorageBackend`, `AthenaSdkClientWithStorage`, or storage-enabled constructor overload.
- Focused tests must cover unified-root routing, `storage.url` override routing, missing-route configuration errors, context/header parity, direct upload, cancellation, progress, and storage error normalization.
- Root and browser entry tests must expose structurally identical storage declarations and behavior.
- Migration fixtures must prove the documented mapping from `experimental.storage` and `experimental.directStorageUpload` to the canonical `storage` object.
- `pnpm typecheck`, storage tests, browser-entry tests, `pnpm docs:methods`, `pnpm build`, and package declaration inspection must pass before this proposition is implemented as complete.
