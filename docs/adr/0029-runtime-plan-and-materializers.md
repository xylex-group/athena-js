# ADR 0029: Internal Runtime Plan + domain materializers (Phases 0–4)

**Date:** 2026-08-25
**Status:** Accepted (Phases 0–4)
**Author:** Floris
**Depends on:** 0001, 0002, 0010, 0014, 0015, 0020, 0027, 0028
**Monorepo pair:** [docs/adr/technical/0049-athena-js-runtime-plan.md](../../../../docs/adr/technical/0049-athena-js-runtime-plan.md)
**Spec:** [docs/sdd/xylex/athena-js-runtime-plan/SPEC.md](../../../../docs/sdd/xylex/athena-js-runtime-plan/SPEC.md)

This file is **Accepted** for SDD Phases 0–4. It does not claim Phases 5–24 (ObjectStore / Storage Nucleus). It does not reopen package 0027 (embedded storage runtime) or 0028 (client runtime context façade).

Package index **0029** pairs with monorepo technical **0049** the same way package **0028** pairs with technical **0029**. Do not conflate those indexes.

## Context

Package ADR 0001 / 0014 already require a single `createClient`. Package 0028 / monorepo 0029 extracted `src/client/context.ts` and a façade. Node `src/v3-client.ts` still **implemented** PostgreSQL transport, local ObjectStore, billing providers, and chat local DB in the constructor file. `src/runtime/resolve.ts` was a diagnostic snapshot, not a plan pipeline.

## Decision

**Proposition:** Node/browser construction composes an internal `AthenaRuntimePlan`. Domain materializers own backend handles. The public constructor stays `createClient`. The plan is not a public config object.

## Contract (landed)

- `src/runtime/plan/{types,normalize,resolve,validate,materialize}.ts` exist.
- Pipeline: `createClient` → `normalizeUniversalConfig` → `resolveRuntimePlan` → `validateRuntimePlan` → `materializeRuntimePlan` → `assembleAthenaClient`.
- `src/runtime/materializers/{database,storage,auth,chat,billing}.ts` own Node backend imports.
- `src/v3-client.ts` must not import `storage/local.ts`, `postgres/transport.ts`, billing provider modules, or `chat/local/database.ts`.
- `src/v3-client-core.ts` remains the browser-safe spine and must not import those materializers.
- `AthenaRuntimePlan` is not added to package `exports`.
- Canonical `AthenaResourceIdentity` kinds live with schema-owned resource identity (`src/schema/resource.ts`); Policy binds against them via `PolicyResourceBinding`; Schema IR does not gain storage-object structure.
- Conflicting local/remote storage intent fails at `validateRuntimePlan` (`ATHENA_RUNTIME_CONFIG_INVALID`). `db.d1` + `db.pgUri` fails closed through the same validator (`ATHENA_NO_SERVICE_CONFIGURED`).
- No `createStorageClient` / `createPolicyClient`.

## Consequences

- ADR 0010 “constructor file is not a second monolith” is actionable for Node backends without a second public client.
- Dual-suite `athena-js-runtime-plan.target.test.ts` is the gate for 0–4 (**17/17 GREEN**). Characterization baseline is archived under `test/sdd/superseded/`.

## Non-goals (this slice)

Storage Nucleus, dropping `s3_id`, `lifecycle.storage`, splitting `storage/module.ts`, public plan config. Direct S3 `StorageObjectProvider` is monorepo [ADR 0057](../../../../docs/adr/technical/0057-athena-js-direct-s3-storage-provider.md) (not this slice).
