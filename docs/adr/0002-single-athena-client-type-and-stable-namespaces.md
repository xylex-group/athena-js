# ADR 0002: Use one AthenaClient type with stable service namespaces

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

The current client identity is split across `AthenaSdkClient`, `AthenaSdkClientWithAuth`, and `AthenaSdkClientWithStorage`. The ordinary `createClient` result already contains auth and chat, making the base interface an uncommon partial view. Storage changes the nominal type only because its property is conditionally attached behind `experimental.athenaStorageBackend`.

This capability hierarchy propagates conditional types and overloads through core construction, Next adapters, typed registries, context methods, consumers, and generated docs.

## Decision

**Proposition:** Every client created by Athena JS will have one public identity, `AthenaClient<TModels>`, with stable `db`, `auth`, `chat`, and `storage` namespaces.

Storage is graduated from an experimental capability. Namespace availability no longer changes the client type.

## Contract

- `AthenaClient<TModels>` is the only public data-client interface.
- `AthenaSdkClient`, `AthenaSdkClientWithAuth`, and `AthenaSdkClientWithStorage` are absent from v3.
- Every `AthenaClient` exposes `db`, `auth`, `chat`, `storage`, `from`, `rpc`, `query`, `request`, and `verifyConnection`.
- `experimental.athenaStorageBackend` is absent from v3.
- Storage configuration controls routing and behavior, not property existence.
- Missing service configuration fails when that service is invoked through a structured service configuration error.
- Stable namespaces preserve their route manifests and result/error contracts.
- React, Next, generator, and downstream package types accept `AthenaClient<TModels>` without capability unions.
- A client generic may describe models; it may not describe runtime capabilities.

## Consequences

- Consumer function parameters become stable and readable.
- Storage-enabled overload matrices and casts disappear.
- The client object becomes a superset even when an endpoint is not configured.
- Service invocation must distinguish configuration failure from transport failure.
- Bundle size may increase if stable namespace attachment prevents tree shaking; internal lazy module creation may mitigate this without changing the public shape.

## Validation

- Type declarations must contain no `WithAuth`, `WithStorage`, or capability boolean client types.
- A focused client test must assert every namespace exists on every constructed client.
- Storage route-parity tests must pass without `athenaStorageBackend`.
- Missing DB/auth/chat/storage endpoints must produce the documented structured configuration error.
- `athena-auth-ui@1.16.1` source references to legacy client types must have a v3 migration patch or version constraint before release.
- `pnpm typecheck`, storage tests, chat tests, browser-entry tests, and `pnpm build` must pass.
