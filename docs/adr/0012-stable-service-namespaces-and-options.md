# ADR 0012: Use stable service namespaces and normal service options

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

The current root client does not treat every service consistently. DB methods are part of the base `AthenaSdkClient`; auth and chat are added by `AthenaSdkClientWithAuth`; storage is added only by `AthenaSdkClientWithStorage`. Chat is already created for ordinary clients and its `chat` configuration is already a normal option, but its public type is coupled to the auth-derived client. Storage routing is normal while storage capability and runtime behavior remain experimental.

This history makes the public hierarchy describe implementation timing rather than actual client behavior. It also encourages new services to arrive through another `WithCapability` interface, constructor overload, or enable flag.

## Decision

**Proposition:** DB, auth, chat, and storage are permanent namespaces on the base `AthenaClient`, and each service is configured through its ordinary named option on `createClient(config)`.

The canonical service configuration pattern is:

```ts
const client = createClient({
  url,
  key,
  db: { url: dbUrl },
  auth: { url: authUrl, credentials: 'include' },
  chat: { url: chatUrl, wsUrl: chatWsUrl, webSocketFactory },
  storage: { url: storageUrl, directUpload },
})
```

## Contract

- One `AthenaClient<TModels>` exposes non-optional `db`, `auth`, `chat`, and `storage` namespaces.
- Chat is not an auth capability. `AthenaChatModule` is declared directly on `AthenaClient`, not on an auth-derived client interface.
- No service may introduce `AthenaClientWith<Service>`, an enablement generic, a capability union, or a constructor overload that changes client identity.
- `db`, `auth`, `chat`, and `storage` are the canonical normal configuration objects for their respective services.
- `chat` owns `url`, `wsUrl`, and `webSocketFactory`; no `experimental.chat`, `enableChat`, or `createChatClient` data-client path is added.
- `storage` follows ADR 0011 and owns its URL and runtime behavior without an enable flag.
- Auth-specific credentials and behavior remain under `auth`; ordinary request context remains shared across all services.
- Flat aliases such as `dbUrl`, `gatewayUrl`, `authUrl`, `chatUrl`, `chatWsUrl`, and `storageUrl` are absent from v3; named service objects are the only service override contract.
- Explicit service configuration overrides unified-root routing for that service. Unified-root routing remains the fallback when an explicit route is absent.
- An unconfigured service fails only when invoked, using `ATHENA_SERVICE_NOT_CONFIGURED` with the exact service identity. The namespace remains present.
- `client.request({ service })` uses the same service routing, headers, credentials, error normalization, and configuration failure contract as the high-level namespace.
- HTTP chat operations resolve request context per operation. WebSocket chat connections snapshot the resolved context when connecting and must document how reconnection refreshes it.
- Service module construction may be lazy internally, but property availability and TypeScript declarations are stable.
- The root, browser, and framework-adapter entry points must not expose different service capability types.

## Consequences

- Consumers can pass one client type through DB, auth, chat, and storage code without capability unions.
- Chat behavior remains operationally compatible while its ownership moves out of the misleading auth-derived interface.
- Missing service routes become explicit operational errors instead of type-level or property-presence checks.
- Service-object configuration provides one extensible location for future service-specific behavior.
- The hard cut removes duplicate flat URL configuration paths immediately.
- This record refines ADR 0002 and ADR 0008 and depends on the storage graduation proposed by ADR 0011.

## Validation

- Type fixtures must prove that every normal client exposes `db`, `auth`, `chat`, and `storage` with no capability narrowing.
- Emitted declarations must contain no `WithAuth`, `WithChat`, `WithStorage`, service capability union, or service enablement generic.
- Routing tests must cover explicit service objects, unified-root fallback, explicit-over-root precedence, and structured missing-service errors.
- Header-parity tests must verify user, organization, cookie, bearer, session, custom, and SDK headers across DB, auth, chat, storage, and raw requests.
- Chat tests must cover HTTP routing, WebSocket URL selection, injected `webSocketFactory`, connection-time context, and reconnection behavior.
- Browser tests must prove that stable chat and storage namespaces do not import Node-only modules.
- `pnpm typecheck`, focused auth/chat/storage/request tests, `pnpm docs:methods`, `pnpm build`, and emitted declaration inspection must pass before this proposition is implemented as complete.
