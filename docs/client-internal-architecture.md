# Athena JS client internal architecture

This guide describes the internal ownership boundaries behind the Athena JS 3.0 single-client API. It is for SDK maintainers. Consumers should import only published package entrypoints.

Consumer guides: [getting-started](./getting-started.md) · [next-js](./next-js.md) · [api-reference](./api-reference.md) · [docs index](./index.md).

## Public invariant

The public **materializer** is intentionally singular:

```ts
const client = createClient(config)
const scoped = client.withContext(context)
```

Both values implement `AthenaClient<TModels>`. A scoped client is a view over the same immutable transport core, not a reconstructed legacy client.

Framework packages may expose thin **construction façades** that only adapt inputs or resolve runtime context, then call `createClient` (ADR 0014):

```ts
import { createAthenaBrowserClient } from '@xylex-group/athena/next/client'
import { createAthenaServerClient } from '@xylex-group/athena/next/server'

const browser = createAthenaBrowserClient({ url, key })
const server = await createAthenaServerClient({ url, key })
```

Façades must not implement a second transport core, cache request-bound clients, or silently read browser environment variables.

## Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| `src/v3-client.ts` | public config/types, environment and service URL resolution, immutable public core, service guards, public view | fluent SQL implementation, response parsing, domain route details, framework imports |
| `src/context/merge.ts` | shared `mergeAthenaRequestContexts` (deep header merge) used by core views and Next façades | client construction, transports |
| `src/config/errors.ts` | structured `AthenaConfigurationError` codes and service tags | transport/auth/gateway error types |
| `src/client.ts` | fluent table/RPC/query builder orchestration, builder state, namespace assembly over an existing core/view | public constructor overloads, environment reads, raw HTTP parsing, SQL rendering internals, normalized error internals |
| `src/client-result.ts` | `AthenaResult` / `AthenaResultError`, copies transport `count` + mutation-only `affectedRows`, `applyCardinality` → `toSingleResult` | transports, query-builder state, public client construction |
| `src/result/mutation-meta.ts` | Honest mutation row-count from Gateway aliases / PG `rowCount` / D1 `changes` (never fabricate `0`) | SELECT totals, fluent builders |
| `src/query/legacy-boolean.ts` | Parse fluent `.or(string)` / nested groups into structured predicates | SQL interpolation, Gateway HTTP emulation |
| `src/client-sql.ts` | SQL compilation for typed reads and trace/debug rendering | network calls, query execution, mutable builder state |
| `src/client-request.ts` | public raw request contracts, service URL selection, request headers, body/query serialization, response parsing | fluent builders, framework context discovery, global environment reads |
| `src/gateway/client.ts` | immutable gateway transport and request-scoped gateway views | public client configuration policy |
| `src/query-transport.ts` | transport planning and pagination normalization | request execution or public client identity |
| `src/query-debug-ast.ts` | normalized operation ASTs | SQL execution or transport ownership |
| `src/query-tracing.ts` | trace events, callsites, and trace execution wrapper | query semantics or response normalization |
| `src/next/client.ts` | browser-safe façade typing + re-exported bridge/cookie/route helpers | caching, `env` bags, `next/headers`, transport construction |
| `src/next/server.ts` / `shared.ts` | server façade, request/session context resolvers, session-bridge handlers | module-level client caches, alternate materializers |
| `src/runtime/client-internals.ts` | WeakMap internals on **root** `createClient` only (`config`, `gatewayTransport`, `plan`, `getAuthStores`) | request views, browser/`v3-client-core` imports |
| `src/next/data-handlers.ts` | derive Local Runtime HTTP from the root client | rematerializing `pg` / Auth keyring per request |
| `src/auth/**`, `src/chat/**`, `src/storage/**`, `src/db/**` | domain modules and their route contracts | replacement client materializers |
| `src/cloudflare/**` | Worker D1/R2 execution transport + `createCloudflareClient` (ADR 0015) | browser bundles, second fluent builder tree |

`client-result.ts`, `client-sql.ts`, and `client-request.ts` are internal implementation modules. Their public types remain re-exported from the existing root client contract where applicable; consumers must not deep-import these files.

## Dependency direction

```text
index.ts / browser.ts
  -> v3-client.ts
    -> config/errors.ts
    -> context/merge.ts
    -> client.ts
      -> client-result.ts
      -> client-sql.ts
      -> client-request.ts
      -> gateway, query, auth, chat, storage, db modules

next/client.ts
  -> v3-client.ts (createClient only)

next/server.ts
  -> v3-client.ts (createClient)
  -> context/merge.ts
  -> shared.ts (next/headers resolution)
```

The extracted modules do not import `client.ts` or `v3-client.ts` except for type-only or façade composition at the Next boundary. This one-way dependency rule prevents the refactor from replacing one monolith with circular helper barrels.

Domain modules may depend on shared gateway/context utilities. They must not import the public constructor to manufacture nested clients.

## Core and view lifecycle

1. `createClient(config)` normalizes explicit configuration and creates one immutable core.
2. The core owns service URLs, API key, backend selection, models, behavior flags, gateway transport, and configured context.
3. The initial public client is a view with no extra request scope.
4. `withContext(context)` creates another frozen view that references the same core.
5. Every operation resolves configured context and view context immediately before dispatch.
6. HTTP chat resolves context per operation. WebSocket chat snapshots context when connecting and resolves it again for reconnect.

The architecture deliberately separates immutable process-level configuration from request-level identity and credentials.

## Request-context precedence

Header and credential inputs are merged in this order:

1. client-level headers;
2. static or provider context configured on `createClient`;
3. explicit `withContext` context;
4. per-operation headers.

Later layers override earlier layers. Company or tenant headers remain ordinary context headers rather than creating another capability-specific client type.

## Result path

All gateway-backed builder operations use the same result path:

```text
builder state
  -> gateway payload
  -> gateway transport/view
  -> client-result formatter
  -> AthenaResult<T>
  -> optional read retry / trace outcome
```

Result normalization is transport-independent. A new builder operation should not implement a second error shape or retry loop.

## SQL and debug path

`client-sql.ts` has two related responsibilities:

- compile typed builder conditions into executable SQL where the transport requires it;
- render deterministic SQL for tracing and debugging without executing it.

The compiler is pure. It accepts normalized payload/state and returns strings or `null` when a typed query cannot be represented safely. It must not perform network calls or mutate builder state.

When adding a condition operator, update the executable compiler and debug renderer together, then add parity tests.

## Raw request path

`client-request.ts` is the single escape-hatch dispatcher for DB, auth, chat, and storage routes not represented by a domain binding. It owns:

- service route selection;
- canonical Athena headers and context propagation;
- query-string encoding;
- JSON-versus-native body selection;
- JSON/text/raw `Response` parsing.

Do not duplicate this behavior in consumers or domain modules. Add a stable domain binding when a route becomes part of the supported SDK contract; keep `request(...)` for genuinely unwrapped routes.

## Rules for future extraction

Extract a concern from `client.ts` when all of the following are true:

- it has a clear input/output contract;
- it does not need to own mutable builder state;
- it can depend toward gateway/query primitives without importing the public client;
- tests can exercise it through the public behavior or a narrow internal test;
- the extraction does not change published imports or declaration identities.

Good future candidates are builder-state reducers and mutation execution planning. Avoid splitting every method into a file; cohesion matters more than file count.

## Adding a new client operation

1. Choose the owning domain module.
2. Define or reuse the gateway payload contract.
3. Reuse request-context resolution from the existing view.
4. Reuse `client-result.ts` for normalized results.
5. Add SQL/debug AST parity if the operation participates in tracing.
6. Keep the root and browser declarations identical.
7. Update the closest focused tests, API reference, method generator when relevant, and migration docs only if the public contract changes.

## Documentation dual-publish

Consumer Markdown under `docs/` is the narrative source of truth. A curated
allowlist is projected into the monorepo product site:

```text
docs/** + site-publish.manifest.json
  → apps/docs/scripts/sync-athena-js-docs.mts
  → apps/docs/content/docs/sdks/athena-js/**
```

Full operator guide: [site-publish.md](./site-publish.md).

When public contract docs change, re-run:

```powershell
pnpm --dir packages/athena-js docs:methods   # if method catalog changed
pnpm --dir packages/athena-js docs:site:sync
pnpm --dir packages/athena-js docs:site:check
```

## Validation gates

For internal refactors that should not change the public API, run:

```powershell
pnpm --dir packages/athena-js typecheck
pnpm --dir packages/athena-js test
pnpm --dir packages/athena-js build
pnpm --dir packages/athena-js docs:methods
pnpm --dir packages/athena-js docs:site:sync
pnpm --dir packages/athena-js pack --dry-run
```

Also inspect root and browser declaration output and search for removed v2 identities. A refactor is incomplete when source passes but generated declarations or documentation reintroduce a removed constructor/type.

## Related decisions

- [ADR 0006: immutable client core and context views](./adr/0006-immutable-client-core-and-context-views.md)
- [ADR 0010: module ownership and artifact governance](./adr/0010-client-module-ownership-and-artifact-governance.md)
- [site-publish dual-publish pipeline](./site-publish.md)
- [v2.16.0 to v3.0.0 migration guide](./migration-v2-to-v3.md)
- [single-client consolidation report](./client-v3-consolidation-report.md)

