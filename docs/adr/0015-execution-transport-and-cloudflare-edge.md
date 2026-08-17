# ADR 0015: Execution transport injection and Cloudflare edge-local mode

**Date:** 2026-07-24  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0001](0001-single-create-client-constructor.md), [0002](0002-single-athena-client-type-and-stable-namespaces.md), [0006](0006-immutable-client-core-and-context-views.md), [0011](0011-graduate-storage-into-base-client.md), [0012](0012-stable-service-namespaces-and-options.md), [0014](0014-next-client-construction-facades.md)  
**Extended by:** [0016](0016-drop-in-edge-bindings-on-create-client.md), [0017](0017-d1-sql-compiler-and-mutation-bounds.md), [0018](0018-hybrid-edge-remote-service-routing.md), [0019](0019-execution-mode-resolution-and-runtime-facades.md), [0020](0020-client-capabilities-and-edge-layer-honesty.md), [0025](0025-athena-database-transactions.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range
- Cloudflare Workers / D1 / R2 — structural binding types only (no hard runtime dependency on `@cloudflare/workers-types`)

## Context

ADR 0014 keeps a single client materializer (`createClient`) and forbids framework façades from owning a second transport core. Apps that already run on a Cloudflare Worker with **D1** and **R2** bindings still need a way to execute DB and object I/O **without** an HTTP hop through `athena_rs` and `apps/cloudflare-d1-proxy`.

That is not a framework context adapter. It is an **execution backend**.

Three complementary topologies exist:

| Topology | Path |
| --- | --- |
| Gateway HTTP | app → `athena_rs` → (optional) D1 proxy → D1 |
| Edge-local | Worker + Athena JS → D1/R2 bindings in-process |
| Hybrid | Edge D1/R2 for data plane + remote Athena root for auth/billing/HTTP storage |

Edge-local is **app-owned isolation**, not a drop-in multi-tenant Athena client registry.

## Decision

1. **`AthenaGatewayClient` remains the DB execution surface.** Fluent builders, result normalization, result helpers, and query planning stay on the existing path. Only the object behind `InternalAthenaClientCore.gatewayTransport` may change.
2. **`createInternalClientCore` accepts an optional prebuilt `gatewayTransport`.** When omitted, behavior is unchanged (`createAthenaGatewayClient` HTTP).
3. **Cloudflare edge-local mode is a first-class execution backend** for Workers that own D1/R2 bindings. It must not reimplement fluent builders or invent a second client identity.
4. **The public materializer is still `createClient`** (ADR 0001 / 0014). Binding-shaped configuration and façades are defined in ADR 0016 and ADR 0019.
5. **SQL dialect honesty:** D1 is SQLite. Unsupported gateway features (RPC, nested relations, catalogs, backups) fail deterministically; see ADR 0017 and ADR 0020.
6. **The dedicated D1 proxy Worker remains** the path for **server-side** Athena (`athena_rs`) talking to D1; edge-local is complementary when the **app Worker** owns the binding.
7. **Framework façades (Next, etc.) still must not own transports.** They may only resolve context and call `createClient`.

## Contract

- Unit tests and edge mode may inject a fake or D1-backed `AthenaGatewayClient` without mocking `fetch` for DB operations.
- Edge apps reuse the same `from` / `query` / `insert` / `update` / `delete` / `AthenaResult` contracts as gateway mode.
- Structural types (`D1DatabaseLike`, `R2BucketLike`) live under the SDK; no hard dependency on Cloudflare worker type packages is required for typechecking the monorepo.
- Package export `@xylex-group/athena/cloudflare` may host façades, runtime helpers, and advanced types; it is not required for the drop-in binding path on root `createClient` (ADR 0016).
- Browser root/conditional bundles must remain usable for gateway HTTP without requiring D1/R2 bindings at call sites.
- D1 and R2 are **not** cross-resource transactional; applications own ordering and compensation.

## Consequences

- Transport injection unblocks both unit tests and edge-local Workers without forking the fluent API.
- Consumers can feature-detect via `client.capabilities` (ADR 0020) instead of parsing error strings.
- Hybrid routing must not leak the local D1 sentinel URL into remote services (ADR 0018).
- Documentation must distinguish edge-local from the multi-tenant gateway + D1-proxy path.

## Validation

- Default HTTP gateway suite remains green after transport injection.
- Cloudflare package export exists; browser entry does not require Workers bindings at import time.
- D1 runner + L0/L1 tests (mock bindings + SQL fixtures) cover raw SQL and flat CRUD.
- `createClient({ db: { d1 } })` and façade paths round-trip against mock D1 (ADR 0016).
