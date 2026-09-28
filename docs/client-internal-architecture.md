# Athena JS client internal architecture

This guide describes the internal ownership boundaries behind the Athena JS 3.0 single-client API. It is for SDK maintainers. Consumers should import only published package entrypoints.

Consumer guides: [getting-started](./getting-started.md) · [next-js](./next-js.md) · [api-reference](./api-reference.md) · [docs index](./index.md).

## Public invariant

The public **materializer** is intentionally singular:

```ts
const client = createClient(config)
const scoped = client.withContext(context)
```

Both values implement `AthenaClient<TModels>`. A scoped client is a view over the same immutable transport core, not a reconstructed legacy client. Internals compose over `AthenaClientRuntimeContext` (`InternalAthenaClientCore`); consumers never construct a second client identity (ADR 0028 / monorepo 0029).

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
| `src/v3-client.ts` | Node `createClient`: `prepareNodeRuntimePlan` → `assembleAthenaClient`; root `close()`, trusted-node asserts | fluent SQL, browser graphs, `storage/local.ts` / `postgres/transport.ts` / billing providers / `chat/local/database.ts` |
| `src/runtime/plan/**` | Internal `AthenaRuntimePlan` (`normalize` / `resolve` / `validate` / `materialize`). Not a public config | package `exports`, provider SDK handles as config |
| `src/runtime/authority/**` | Request→`AthenaResolvedPrincipal` (Node-ok; **not** Next `server-only` — ADR 0064). Types stay in `runtime/data/principal.ts` | public `./authority`, minting identity from `x-user-id` / `x-rights`, browser / Next client / RN graphs |
| `src/runtime/finality/matrix.ts` | Cross-domain finality SSOT (Data / Auth / Storage-R2 / Storage-S3 / Billing-Mollie). Not a package export | topology transport matrix, Rights evaluation, provider SDKs |
| `src/runtime/materializers/**` | Node backends: database, storage, auth, chat, billing | browser graphs, public constructors |
| `src/client/contracts.ts` | public `AthenaClient` / config contracts | construction implementation, Node-only adapters |
| `src/v3-client-assembly.ts` | browser-safe `createClientWithNormalizer`, `createClientView`, D1/R2 wiring | `pg`, `node:fs`, `server-only`, Node materializers |
| `src/v3-client-core.ts` | stable compatibility re-exports for the browser-safe assembly and contracts | parallel contracts, construction implementation |
| `src/client/context.ts` | `InternalAthenaClientCore` / `AthenaClientRuntimeContext`, `createInternalClientCore`, `createInternalClientView` | public constructor overloads, Node-only adapters |
| `src/client/create-client.ts` | browser-safe `createClient` wrappers re-exported by the façade barrel | Node `v3-client.ts` |
| `src/client.ts` | public re-export façade (builder/result/request types + universal `createClient`) | factory implementation, Node `close` |
| `src/client-fluent.ts` | fluent table/RPC/query builder orchestration and builder state | public constructor, environment reads, raw HTTP parsing |
| `src/context/merge.ts` | shared `mergeAthenaRequestContexts` (deep header merge) used by core views and Next façades | client construction, transports |
| `src/config/errors.ts` | structured `AthenaConfigurationError` codes and service tags | transport/auth/gateway error types |
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
| `src/runtime/ownership.ts` | `AthenaRootRuntime` / `AthenaRequestRuntime` (`ownership: "root" \| "request"`), `AthenaRuntimeOwnershipError` | public client identity, second factories |
| `src/runtime/client-internals.ts` | WeakMap internals (`createRootClientInternals` / `createViewClientInternals`), `requireAthenaRootClientInternals`, `getAthenaRuntimeDiagnostics` | treating a request view as a root |
| `src/next/data-handlers.ts` | derive Local Runtime HTTP from the root client | rematerializing `pg` / Auth keyring per request |
| `src/auth/**`, `src/chat/**`, `src/storage/**`, `src/db/**` | domain modules and their route contracts | replacement client materializers |
| `src/cloudflare/**` | Worker D1/R2 execution transport + `createCloudflareClient` (ADR 0015) | browser bundles, second fluent builder tree |

`client-result.ts`, `client-sql.ts`, and `client-request.ts` are internal implementation modules. Their public types remain re-exported from the existing root client contract where applicable; consumers must not deep-import these files.

## Dependency direction

```text
index.ts (Node) / server.ts
  -> v3-client.ts          (plan pipeline + assemble + close)
       -> runtime/plan/** + runtime/materializers/**
       -> v3-client-core.ts

browser.ts / next/client.ts / react-native
  -> src/client/create-client.ts
       -> v3-client-assembly.ts     browser-safe construction
       -> src/client/context.ts     InternalAthenaClientCore factories
       -> client-fluent.ts           fluent builders (via context view)

src/client.ts
  -> src/client/create-client.ts    universal construction entry
  -> src/client/context.ts          re-export types/factories
  -> src/client-fluent.ts           re-export builder types

src/query/** and src/schema/**
  --X--> client.ts, v3-client-core.ts, v3-client.ts

auth / storage / chat / billing / db / admin
  --X--> public façade (client.ts / v3-client*.ts)
  --X--> unrelated feature internals
```

`query/read-query.ts` uses `AthenaReadQueryClient` (narrow `.db`), not `AthenaClient`.

Feature modules may depend on shared gateway/context/result types. They must not import the public constructor to manufacture nested clients. `src/client/**` may compose modules. Browser entries must not import `v3-client.ts`, `pg`, `node:fs`, or `server-only`.

Architecture tests: `test/sdd/athena-client-decomposition.target.test.ts` (technical ADR 0029 / package 0028); `test/sdd/athena-js-runtime-plan.target.test.ts` (technical ADR 0049 / package 0029).

## Core and view lifecycle

1. Node `createClient(config)` runs `normalizeUniversalConfig` → `resolveRuntimePlan` → `validateRuntimePlan` → `materializeRuntimePlan` → `assembleAthenaClient`. Conflicting `storage.provider: "local"` + `storage.url` / `storage.r2` throws `ATHENA_RUNTIME_CONFIG_INVALID`. Apps do not pass a plan object.
2. The Node `/server` materializer attaches **root** internals (`ownership: "root"`). Only the root may own PostgreSQL pools, embedded Auth, migrate, `close()`, and HTTP handler mounts.
3. `withContext(context)` and `createAthenaServerClient` attach **request** internals (`ownership: "request"`, `runtimeOwnership: "borrowed"`). They borrow transport / pools / Auth stores and carry request context.
4. Every operation resolves configured context and view context immediately before dispatch.
5. HTTP chat resolves context per operation. WebSocket chat snapshots context when connecting and resolves it again for reconnect.

Request-view misuse of a root API throws `ATHENA_RUNTIME_OWNERSHIP_INVALID` (`AthenaRuntimeOwnershipError`). Missing / foreign internals stay `ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH`. Cast `close()` on a request view throws; it does not no-op. `getAthenaRuntimeDiagnostics` is root-only.

The architecture deliberately separates immutable process-level configuration from request-level identity and credentials. See [ADR 0021](../../../docs/adr/technical/0021-athena-js-root-request-runtime-ownership.md).

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

Phases 3–8 remain backlog (query execution pipeline, result formatter remainder, transactions, gateway/pg/d1 adapters, `auxiliaries.ts`, compatibility isolation). Extract a concern from `client-fluent.ts` / remaining view assembly when all of the following are true:

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

## Validation gates

For internal refactors that should not change the public API, run:

```powershell
pnpm --dir packages/athena-js typecheck
pnpm --dir packages/athena-js test
pnpm --dir packages/athena-js build
pnpm --dir packages/athena-js docs:methods
pnpm --dir packages/athena-js pack --dry-run
```

Also inspect root and browser declaration output and search for removed v2 identities. A refactor is incomplete when source passes but generated declarations or documentation reintroduce a removed constructor/type.

## Related decisions

- [ADR 0006: immutable client core and context views](./adr/0006-immutable-client-core-and-context-views.md)
- [ADR 0010: module ownership and artifact governance](./adr/0010-client-module-ownership-and-artifact-governance.md)
- [v2.16.0 to v3.0.0 migration guide](./migration-v2-to-v3.md)
- [single-client consolidation report](./client-v3-consolidation-report.md)
