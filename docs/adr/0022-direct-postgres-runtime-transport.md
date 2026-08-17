# ADR 0022: Direct PostgreSQL runtime transport behind AthenaGatewayClient

**Date:** 2026-08-09  
**Status:** Proposed  
**Author:** SDD program athena-js-pg-direct  
**Depends on:** [0015](0015-execution-transport-and-cloudflare-edge.md), [0016](0016-drop-in-edge-bindings-on-create-client.md), [0017](0017-d1-sql-compiler-and-mutation-bounds.md), [0020](0020-client-capabilities-and-edge-layer-honesty.md)  
**SDD:** `docs/sdd/xylex/athena-js-pg-direct/`

## Context

Athena JS already supports:

1. Gateway HTTP DB via `createAthenaGatewayClient`
2. Cloudflare D1 edge-local via `createCloudflareD1GatewayTransport` implementing the same `AthenaGatewayClient` contract

`db.pgUri` exists on public config but only forwards `x-pg-uri` on Gateway HTTP requests. Tooling (generate/migrate) already uses a shared lazy `pg` pool (`src/postgres/driver.ts`). Trusted Node servers need fluent Athena DB calls against a PostgreSQL URI **without** Athena Gateway in the path.

## Decision

1. **Direct PostgreSQL is a first-class DB execution backend** materialized by `createClient({ db: { pgUri } })`.
2. **No second client constructor or fluent API.** Builders continue to call `gatewayTransport`.
3. **Implement `createPostgresDirectTransport`** returning `AthenaGatewayClient`, parallel to D1.
4. **Parameterized PG SQL compiler** owns execution SQL; debug SQL in `client-sql.ts` remains diagnostics-only.
5. **Reuse `createPostgresPool` / lazy `import("pg")`** — one driver stack with tooling.
6. **Node-only:** non-Node runtimes fail closed with a clear Athena configuration/runtime error; browser bundles must not static-import `pg`.
7. **No silent Gateway fallback** when direct transport is selected.
8. **Capabilities honesty:** `db.engine = "postgresql"`, `db.local = true`, layers reflect actual support.
9. **Bounded mutations** follow ADR 0017 safety intent with PG-appropriate identity (PK/unique CTE), fail closed if identity unknown.
10. **Security model:** trusted server; not Gateway-equivalent controls. Document explicitly.

## Non-decisions (this ADR)

- Public universal `close()` on `AthenaClient` (defer until pool lifecycle evidence requires it)
- Mapping `withContext` to PG session variables / RLS
- Full RPC parity (still fail-closed)
- Nested findMany is owned by [0026](0026-canonical-athena-query-ast.md) (AST + resolved plan + PG compiler)
- Mutation row-count / fluent CAS / legacy `.or(string)` on this transport: monorepo [ADR 0018](../../../../docs/adr/technical/0018-athena-js-canonical-mutation-row-count.md) (Accepted)
- Renaming `AthenaGatewayClient`

## Consequences

- `resolveCore` / materialization must allow PG-only clients without HTTP URL/API key while preserving HTTP service credential rules.
- Hybrid clients (PG DB + HTTP auth/storage) remain one `AthenaClient`.
- New tests: config matrix, compiler, contract suite, bounded mutations, bundle safety.
- ADR 0015 “execution backend” language generalizes beyond Cloudflare.

## Validation

- Dual-suite target tests GREEN for Phase 1+ features
- Gateway and D1 suites remain GREEN
- `audit:rn` / browser graph free of `pg`
- SDD ACT-* suite in `docs/sdd/xylex/athena-js-pg-direct/matrices/m-42-conformance-act.md`
