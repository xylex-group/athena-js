# Athena JS v3+ ADR contract catalog

This directory contains the architecture contracts for the Athena JS single-client API.

## Pinned baseline

- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- Athena HTTP OpenAPI / athena-rs server line is independently versioned (currently 4.x).
- Node.js `>=18.0.0` - declared SDK engine range, not an exact resolved runtime.

## Accepted decision catalog

| ADR | Accepted decision | Depends on | Status |
| --- | --- | --- | --- |
| [0001](0001-single-create-client-constructor.md) | `createClient(config)` is the only primitive client materializer. | None | Superseded by 0014 (narrowed) |
| [0002](0002-single-athena-client-type-and-stable-namespaces.md) | Every constructed value has one `AthenaClient<TModels>` identity and stable service namespaces. | 0001 | Accepted |
| [0003](0003-model-derived-query-typing.md) | Query typing derives from known models and rows, never a boolean client mode. | 0002 | Accepted |
| [0004](0004-root-client-owns-typed-registry-behavior.md) | Root `createClient({ models })` owns all typed-registry behavior. | 0002, 0003 | Accepted |
| [0005](0005-runtime-neutral-client-and-request-context.md) | Browser/server differences are resolved through conditional bundles and per-operation request context. | 0001, 0002 | Accepted |
| [0006](0006-immutable-client-core-and-context-views.md) | Context changes create lightweight views over one immutable client core. | 0005 | Accepted |
| [0007](0007-framework-adapters-resolve-context-only.md) | Framework adapters resolve context; may compose thin façades over `createClient`. | 0005, 0006 | Superseded by 0014 (narrowed) |
| [0008](0008-configuration-routing-and-service-errors.md) | Configuration has one precedence contract and unavailable services fail with structured errors. | 0001, 0002 | Accepted |
| [0009](0009-v3-breaking-migration-and-version-contract.md) | The consolidated surface ships as v3 with a bounded migration window and no permanent legacy type aliases. | 0001-0008 | Accepted |
| [0010](0010-client-module-ownership-and-artifact-governance.md) | Client source, declarations, exports, tests, and generated docs move as one governed contract. | 0001-0009 | Accepted |
| [0011](0011-graduate-storage-into-base-client.md) | Storage graduates into `createClient().storage` and normal `storage` configuration. | 0002, 0008 | Accepted |
| [0012](0012-stable-service-namespaces-and-options.md) | DB, auth, chat, and storage are stable base-client namespaces configured by normal service options. | 0002, 0008, 0011 | Accepted |
| [0013](0013-promote-stable-experimental-options.md) | Stable experimental settings become normal options, service settings move to their owner, and obsolete flags are removed. | 0003, 0011, 0012 | Accepted |
| [0014](0014-next-client-construction-facades.md) | Thin Next façades may call `createClient` without caching or reimplementing construction. | 0001, 0005, 0006, 0007 | Accepted |
| [0015](0015-execution-transport-and-cloudflare-edge.md) | Optional `gatewayTransport` injection; Cloudflare edge-local D1/R2 as an execution backend (not a second client identity). | 0001, 0002, 0006, 0011, 0012, 0014 | Accepted |
| [0016](0016-drop-in-edge-bindings-on-create-client.md) | Edge is drop-in via `createClient({ db: { d1 }, storage: { r2 } })`; Cloudflare helpers are thin façades. | 0001, 0011, 0012, 0014, 0015 | Accepted |
| [0017](0017-d1-sql-compiler-and-mutation-bounds.md) | D1 SQL compiler: SQLite dialect, sparse insert batches, bounded delete/update via rowid + limit/offset on payloads. | 0015, 0016 | Accepted |
| [0018](0018-hybrid-edge-remote-service-routing.md) | Hybrid routing: remote root for billing/auth; D1 sentinel never used as real HTTP base; remote storage capabilities. | 0008, 0012, 0015, 0016 | Accepted |
| [0019](0019-execution-mode-resolution-and-runtime-facades.md) | `edge` \| `gateway` \| `auto` resolution, prefer rules, `createAthenaRuntime` / Worker env façades. | 0001, 0014, 0015, 0016, 0018 | Accepted |
| [0020](0020-client-capabilities-and-edge-layer-honesty.md) | Stable `client.capabilities` bag; L0–L3 honesty for edge vs gateway feature detection. | 0002, 0015, 0016, 0018 | Accepted |
| [0021](0021-layered-contract-policy.md) | Persistence ≠ Athena ≠ domain ≠ API DTO ≠ UI state; versioned contracts, named mappers, Zod validation. | 0002, 0009, 0010, 0011 | Accepted |
| [0022](0022-canonical-app-project-layout.md) | Canonical app layout `src/lib/athena/*` + `generated/`; invariants A–H; package boundaries. | 0001, 0010, 0014 | Accepted |
| [0024](0024-athena-query-descriptor-and-model-graph.md) | One DSL (`from(model)`); `AthenaQueryDescriptor` is cache IR; structured key matching; entity key = model + context + PK. | 0003, 0004, 0006, 0021 | Proposed |
| [0025](0025-athena-database-transactions.md) | Portable `db.transaction([])` vs capability-gated `db.withTransaction`; transport-owned execution; fail closed. | 0015, 0017, 0020, 0022, 0024 | Accepted |
| [0026](0026-canonical-athena-query-ast.md) | Athena JS owns `AthenaQueryAst` + resolved `AthenaQueryPlan`; Gateway/PG/D1 are compilers. | 0020, 0022-direct-postgres, 0024 | Accepted |

## Related monorepo ADRs

| ADR | Decision | Status |
| --- | --- | --- |
| [docs/adr/technical/0018](../../../../docs/adr/technical/0018-athena-js-canonical-mutation-row-count.md) | Count-preferred mutation row-count (`count` else `affectedRows`) + fluent CAS + PG `.or(string)` | Accepted |
| [docs/adr/technical/0019](../../../../docs/adr/technical/0019-athena-js-local-verification-ssot.md) | Local `test:finality` is the Athena JS release SSOT; CI mirrors it | Accepted |
| [docs/adr/technical/0020](../../../../docs/adr/technical/0020-athena-next-runtime-capability-discovery.md) | Next discovery 1.1 advertises Auth+Data from `ResolvedAthenaRuntime`; browser auto-attaches same-origin `/api/auth` | Accepted |

## Cloudflare edge / hybrid decision cluster

Read these together when implementing or reviewing Workers + D1/R2 work:

```text
0015  Execution transport (gatewayTransport + edge as backend)
  └─ 0016  Drop-in db.d1 / storage.r2 on createClient
  └─ 0017  D1 SQL compiler + mutation bounds + batch counts
  └─ 0018  Hybrid remote service routing (billing, storage caps)
  └─ 0019  Mode resolution + runtime/Worker façades
  └─ 0020  capabilities bag + layer honesty
```

Narrative guide: [`../cloudflare-edge-local.md`](../cloudflare-edge-local.md).

## Layered contracts cluster

- [0021](0021-layered-contract-policy.md) — layer suffixes, boundary rules, pagination/error/JSON contracts
- Inventory: [`../contracts/inventory.md`](../contracts/inventory.md)
- Source: `src/contracts/v1/`, `src/mappers/`, `src/runtime/`

## Implementation ownership

Records are owned by Floris for `@xylex-group/athena`.

- ADR 0014 supersedes the absolute ban on Next construction helpers while preserving the single-materializer invariant from ADR 0001 and the no-cache / no-second-core constraints from ADR 0007.
- ADR 0015–0020 allow alternate **execution** backends (HTTP gateway vs Cloudflare bindings) only at core creation — not inside framework façades. Edge bindings enter through normal `db` / `storage` options (0016) or thin façades (0019).

## Relationship to the main report

The detailed analysis, inventories, migration examples, risks, and implementation evidence live in [`../client-v3-consolidation-report.md`](../client-v3-consolidation-report.md). These ADRs contain the promises future code must preserve after the accepted decisions are implemented.
