# ADR 0025: Athena database transactions

**Date:** 15 August 2026  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0015](0015-execution-transport-and-cloudflare-edge.md), [0017](0017-d1-sql-compiler-and-mutation-bounds.md), [0020](0020-client-capabilities-and-edge-layer-honesty.md), [0022](0022-direct-postgres-runtime-transport.md), [0024](0024-athena-query-descriptor-and-model-graph.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range
- Cloudflare D1 `batch()` — transactional sequence with rollback on statement failure

## Context

HEAD already has one DB DSL (`athena.from(Model)`), one client (`createClient` → `AthenaClient`), and one execution seam (`AthenaGatewayClient`) with three backends:

| Backend | Transport | Notes |
| --- | --- | --- |
| Gateway HTTP | `createAthenaGatewayClient` | Semantic `/gateway/fetch|insert|update|delete` |
| Direct PostgreSQL | `createPostgresDirectTransport` | Lazy `pg.Pool`; each call may use a different connection |
| Cloudflare D1 | `createCloudflareD1GatewayTransport` | Compiler + `executeD1Batch` |

There is **no** first-class transaction API. Existing raw-SQL `single_transaction` on the gateway is a driver mode for concatenated SQL, not a portable Athena operation contract. Concatenating debug SQL (`BEGIN; …; COMMIT;`) would break authorization, descriptors, D1 compilation, and result typing.

Two transaction classes are not interchangeable:

1. **Portable atomic** — a finite list of Athena operations is known before execution. Maps to one PG connection + `BEGIN`/`COMMIT`, one Gateway HTTP request, or one D1 `batch()`.
2. **Interactive** — application JavaScript runs between statements. Requires a live connection-scoped transaction. Direct PG can pin a `PoolClient`. D1 `batch()` cannot. A stateless Gateway request cannot.

D1 `batch()` is a SQL transaction: if a statement fails, the sequence is aborted or rolled back. It is **not** an interactive transaction. Sessions/bookmarks provide sequential consistency, not mid-JS transaction scope.

ADR 0015 already forbids implying D1+R2 cross-resource atomicity. Database transactions stay database-only.

## Decision

**Decision:** Athena exposes two distinct DB APIs on the existing `AthenaDbModule`. Transport adapters own backend execution. Capabilities advertise honesty. Fail closed. Never degrade atomicity to independent requests.

### Public APIs

```ts
await athena.db.transaction([opA, opB, opC] as const, options?)
await athena.db.withTransaction(async (tx) => { … }, options?)
```

- `transaction` is the **universal portable primitive** (capability `atomic`).
- `withTransaction` is **capability-gated** (`interactive`).
- Same DSL: `athena.from(Model)` and `tx.from(Model)`. No second builder, no `createTransactionalClient()`.
- `tx` is a database transaction surface only (no auth/storage/billing/chat).

### Capability matrix (v1)

| Backend | Atomic | Interactive | Savepoints |
| --- | --- | --- | --- |
| Direct PostgreSQL | Yes | Yes | Yes |
| Gateway → PostgreSQL | Yes (`POST /gateway/transaction`) | No | No |
| D1 edge-local | Yes (`D1Database.batch()`) | No | No |
| Gateway → D1 | No until one D1 batch is the whole request | No | No |
| Unconfigured / unknown | No | No | No |

Unsupported isolation, nesting, or interactive mode returns a structured `AthenaTransactionError`. Isolation requests on D1 MUST NOT be ignored.

### Internal IR

Executables compile to `AthenaTransactionOperation` (kind + semantic gateway payload + `AthenaQueryDescriptor`). Debug SQL / `AthenaQueryDebugAst` is not IR.

### Transport contract

Optional `AthenaGatewayClient.transactions?: AthenaTransactionTransport`. The DB module does not switch on postgres/d1/gateway strings. Missing adapter → fail closed.

### Context pinning

`withContext` providers resolve **once** at transaction start. The snapshot (credentials, client, organization, principal headers) is frozen for every operation.

### Cache

Athena Query reconciles mutation descriptors **only after commit**. Interactive uncommitted writes must not enter the global entity graph. Rollback discards pending effects.

### PostgreSQL

One compiler (`compilePostgres*`). Execution target is a pool **or** a pinned `PoolClient`. `BEGIN` options compile through an exhaustive mapper (`buildPostgresBeginStatement`). Savepoint names are generated internally. Nested `withTransaction` is a savepoint, never a second pool transaction. A doomed transaction (failed operation, ignored error result, `requireAffected` failure, or `tx.abort()`) always `ROLLBACK`s.

### D1

Compile each operation with the existing D1 SQL compiler. Execute **exactly one** `executeD1Batch`. Preserve session/bookmark resolution for the batch. `withTransaction` throws `ATHENA_TRANSACTION_INTERACTIVE_UNSUPPORTED`.

### Gateway

Atomic transactions are one HTTP request of semantic operations. Each operation is authorized independently under one request principal. Operations MUST NOT carry mid-transaction client/organization/credential overrides. Interactive Gateway is out of scope until a connection-held design is approved. Do not implement public transactions as raw `/gateway/query` SQL concatenation.

## Non-goals

- A second ORM, query DSL, or client constructor
- Cross-resource transactions (DB + R2/S3/HTTP/billing/email)
- Gateway interactive transactions held across arbitrary HTTP requests
- Pretending D1 sessions are interactive transactions
- Forcing RPC/raw SQL into v1 unless a backend has real parity
- Silently ignoring unsupported isolation / nesting / atomicity

## Consequences

- `client.capabilities.db.transactions` is the feature-detection surface (extends ADR 0020).
- Direct PG transport must support pinned-connection execution without duplicating compilers.
- Gateway HTTP gains `POST /gateway/transaction`; Rust execution must reuse fetch/insert/update/delete services against a sqlx transaction.
- Tests must prove fail-closed behavior (D1 interactive, isolation, context pin, doomed rollback, cache-after-commit-only).

## Validation

- Capability assertions for PG-direct, D1, gateway, and unknown.
- D1 atomic uses one `batch()`; interactive throws.
- PG atomic + interactive + savepoint + doomed rollback.
- Context provider is not re-entered per operation.
- Isolation unsupported on D1.
- Existing Gateway / D1 / PG / Athena Query suites remain green.
- No `pg` leak into browser/Worker bundles.
