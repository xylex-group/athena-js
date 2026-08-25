# ADR 0028: Realize ADR 0010 client modules as a runtime-context façade

**Date:** 2026-08-19  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Amends:** [0010](0010-client-module-ownership-and-artifact-governance.md)  
**Depends on:** 0001, 0002, 0005, 0006, 0010, 0014  
**Monorepo pair:** [docs/adr/technical/0029-athena-js-client-runtime-context-decomposition.md](../../../../docs/adr/technical/0029-athena-js-client-runtime-context-decomposition.md)  
**Spec:** [docs/sdd/xylex/athena-js-client-decomposition/SPEC.md](../../../../docs/sdd/xylex/athena-js-client-decomposition/SPEC.md)

This file is **Accepted** for SDD Phases 0–2. `src/client/create-client.ts` and `src/client/context.ts` exist; `src/client.ts` is the public re-export façade.

## Context

ADR 0010 decided that client responsibilities split into explicit ownership modules (`create-client.ts`, `public-types.ts`, `core.ts`, `view.ts`, …) and that `src/client.ts` shrink toward fluent orchestration only. At the 2026-08-19 freeze (`f6bd10055`) those files did not exist. `createInternalClientCore` / `createInternalClientView` lived in `src/client.ts`; public `createClient` lived in `v3-client-core.ts` / `v3-client.ts`.

ADR 0010’s named files were a **governance target**, not a live layout. This amendment realizes a **minimum** of that layout without claiming the full 0010 file set in one slice.

## Decision

**Proposition:** The composition root for Athena JS internals is `AthenaClientRuntimeContext` (`InternalAthenaClientCore`). Construction and core/view factories live under `src/client/`. `src/client.ts` is a public re-export façade. Domain modules consume context, not the public client object.

## Contract (this slice)

- `src/client/context.ts` owns `InternalAthenaClientCore`, `createInternalClientCore`, `createInternalClientView`, and `AthenaClientRuntimeContext` (type alias of the internal core).
- `src/client/create-client.ts` is the **browser-safe** `createClient` / `createClientWithNormalizer` wrapper used by the façade barrel. Universal materialization (`createClientWithNormalizer`, `createClientView`, public `AthenaClient` types) remains in `src/v3-client-core.ts`, which **composes** `src/client/context.ts`. Node `src/v3-client.ts` remains the only place that may import `pg` / local Auth / local storage / implement root `close()`.
- `src/client.ts` re-exports public types that previously originated there **and** universal `createClient` from `./client/create-client.ts`. It must not import Node-only modules and must not re-export `v3-client.ts`.
- `core.ts` / `view.ts` as named in 0010 are `context.ts` for this slice (one file is allowed). Do not optimize for file count. There is no `src/client/facade.ts`.
- Fluent builder **types and implementation** live in `src/client-fluent.ts` so `db/module.ts` and `query-tracing.ts` do not import the public barrel. That is not Phase 3 query-pipeline extraction.
- `query/read-query.ts` depends on `AthenaReadQueryClient` / `AthenaReadQueryDb`, not `AthenaClient` from the v3 façade.
- `public-types.ts` / `config.ts` / `environment.ts` / `service-urls.ts` remain optional later extractions; v3-client-core may keep those types if re-exported.
- No replacement client file may grow into a second monolith **and** no second public constructor may appear.
- Import-boundary tests enforce: `query/**` and `schema/**` ↛ façade; feature modules ↛ unrelated internals; `auth`/`storage`/`chat`/`billing`/`db`/`admin` ↛ public `AthenaClient` façade; browser ↛ `pg`.
- Package `exports` stay authoritative. Root and browser barrels remain equivalent for client contracts while preserving runtime safety (0010).

## Consequences

- ADR 0010 “`src/client.ts` must continue shrinking toward fluent builder orchestration only” is **actionable**: core/view factories left the monolith in Phase 2; fluent builders live in `client-fluent.ts` until Phase 3 extracts the execution pipeline.
- Internal import cycles are prevented: v3-core → `client/context.ts`; façade `create-client.ts` → v3-core; modules → `client-fluent.ts` / result / gateway types.
- Generated `dist/*.d.ts` must still hide `createInternalClient*` from published consumer APIs.

## Validation

- Dual-suite target GREEN: `test/sdd/athena-client-decomposition.target.test.ts`
- ADR 0010 remaining gates: `pnpm typecheck`, `pnpm build`, browser-safety, `test:finality`
- `rg` finds no exported `createAuthClient` / `createDbClient` / `createStorageClient`
