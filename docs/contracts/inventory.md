# Athena JS contract inventory

Policy: [ADR 0021](../adr/0021-layered-contract-policy.md).

## Columns

| Column | Meaning |
| --- | --- |
| name | Current type / shape name |
| module | Source path under `src/` |
| classification | `transport DTO` \| `domain model` \| `database row` \| `adapter-internal` \| `UI convenience` |
| layers used | Layers that currently import or return this type |
| reuse risk | `low` \| `medium` \| `high` |
| target name | Policy-aligned name (suffix rules) |
| mapper | Named mapper needed? |
| runtime schema | Zod schema planned/exists? |
| notes | Migration notes |

## Inventory

| name | module | classification | layers used | reuse risk | target name | mapper | runtime schema | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AthenaJsonValue / AthenaJsonObject | gateway/types.ts | transport DTO | SDK-wide | medium | JsonValue / JsonObject | alias | yes (z.lazy) | Alias in contracts/v1/common |
| AthenaResolvedPagination | query-transport.ts | adapter-internal | query builder | medium | Offset page params | resolvePagination → OffsetPage request | yes | Offset-only today |
| Page / OffsetPage / SequencePage | contracts/v1 | transport DTO | new | low | Page\<T\> etc. | mapLimitPlusOneToPage | yes | Canonical; align rust athena-core |
| ManagedFileRecord | storage/module.ts | transport DTO + database row | storage SDK, react hooks, consumers | **high** | StorageFileRow + ManagedFileView | mapStorageFileRowToManagedFileView | yes | Split infra vs public view |
| CreateStorageUploadUrlRequest | storage/module.ts | transport DTO | storage | medium | CreateUploadUrl AthenaRequest | dual-case normalize | yes | |
| StorageUploadUrlResponse | storage/module.ts | transport DTO | storage | medium | CreateUploadUrl AthenaResponse | — | yes | |
| StorageListFilesResponse | storage/module.ts | transport DTO | storage | high | list + Page\<ManagedFileView\> | map list rows | yes | files[] reuses ManagedFileRecord |
| PresignedFileUrlResponse | storage/module.ts | transport DTO | storage | medium | RefreshFileUrlResponse / GetUrl response | — | yes | exposes bucket + storage_key |
| AthenaStorageFileUploadInput | storage/file.ts | Input / UI convenience | storage helpers | medium | UploadFileInput | map to CreateUploadUrl request | partial | Dual camel/snake fields |
| AthenaErrorCode (UNIQUE_VIOLATION…) | auxiliaries.ts | adapter-internal | client errors | high | keep + AthenaTransportErrorCode | mapNormalizedAthenaErrorToErrorResponse | yes | Do not silently renumber |
| NormalizedAthenaError | auxiliaries.ts | adapter-internal | client | medium | keep internal | map to AthenaErrorResponse | yes | Not public HTTP envelope |
| AthenaErrorResponse | contracts/v1/errors.ts | transport DTO | new | low | AthenaErrorResponse | from NormalizedAthenaError | yes | |
| ModelDef Insert = Partial\<Row\> | schema/types.ts | domain model default | generator, client | **high** | field-aware Insert / Patch | generator emission | table-schemas Zod | Kill Partial at source |
| Generated *Insert / *Update | generator/renderer.ts | domain model | consumers models | **high** | *Insert / *Patch | — | form/insert/update bundles | Currently Partial\<Row\> |
| AthenaFetchPayload / select plans | query-transport.ts | transport DTO | gateway | medium | Query AthenaRequest | createSelectTransportPlan | partial | |
| AthenaResult.count / affectedRows | client-result.ts | transport DTO | SDK-wide | medium | keep | resolveMutationAffectedRows + formatResult | tests | Count-preferred mutation row-count (ADR 0018). `count` = SELECT exact totals **or** mutation rows when the adapter has a number. `affectedRows` = mutation-only honest meta (`pg.rowCount`, D1 `changes`, Gateway aliases); `null` if absent; never copied from SELECT totals or returned-row length. |
| Gateway insert/update/delete payloads | gateway/types.ts, client | transport DTO | gateway | medium | Mutation AthenaRequest/Response | — | partial | |
| AthenaAuth session / user shapes | auth/types* | transport DTO | auth, next bridge | high | SessionView / Auth*Response | session bridge mappers | partial | Inventory deep-dive Phase 1.6+ |
| AthenaAuthOrganization* | auth/types* | transport DTO | auth, organization | medium | Org/Member View/Response | — | partial | |
| RpcPayload / RpcFilter | gateway/types.ts | transport DTO | rpc | medium | Rpc AthenaRequest | — | partial | |
| Billing webhook / live routes | billing/* | transport DTO | billing | medium | Webhook payload contracts | — | yes later | |
| Chat message shapes | chat/* | transport DTO | chat | medium | Message View/Response | — | later | |
| AthenaRuntimeDiscoveryDocument | gateway/discovery-types.ts | transport DTO | next discovery, data handlers | medium | keep | parseAthenaRuntimeDiscoveryDocument | tests | Protocol 1.0 (`runtime: local\|gateway`, scalar `capabilities.auth`) + 1.1 (`next-local`, `{available,transport}`, `endpoints`). 1.0 never implies Auth. ADR 0020. |
| ResolvedNextAthenaTopology | next/topology.ts | adapter-internal | next/client | low | keep internal | topologyFromDiscoveryDocument | tests | Browser HTTP topology only; never PG / embedded Auth. |
| Cookie / session store blobs | cookies/* | adapter-internal | next, cookies | medium | keep internal | — | partial | Not public API DTO |
| D1 transport payloads | cloudflare/d1/* | adapter-internal | edge | medium | keep adapter-internal | edge mappers | tests | Not public consumer DTO |
| React hook state | react/* | UI convenience | react package | medium | keep UI-local | map View → hook state in UI | n/a | Must not import *Row |

## Top cross-layer reuse offenders

1. **ManagedFileRecord** — row + SDK response + upload result + list item  
2. **Partial\<Row\> insert/update** — generator + dynamic client defaults  
3. **AthenaErrorCode vs free-form messages** — consumers may match strings; need transport codes  
4. **Storage dual camel/snake fields** — implicit dual wire without documented canonical emit  
5. **Session / user objects** — auth transport reused as UI state in consumers  
6. **metadata: Record\<string, unknown\>** — unrestricted JSON bags  
7. **Presigned URL responses** — infrastructure fields on browser-facing shapes  
8. **StorageListFilesResponse.files** — no Page\<T\> / cursor contract  
9. **Organization member records** — likely mixed admin + UI  
10. **Gateway condition values** — Json primitives mixed with query domain  

## Classification legend quick guide

- **transport DTO** — wire or SDK request/response shape  
- **domain model** — registry/model typing independent of HTTP  
- **database row** — persistence shape (may match SQL columns)  
- **adapter-internal** — gateway edge, SQL rewrite, cookie crypto, not public product API  
- **UI convenience** — react/hook/form state  

## Release report (not a runtime DTO)

Publish consumes a generated machine report, not a public SDK type. Schema is normative in [release-verification.md](../release-verification.md) and ADR 0019.

| name | module | classification | notes |
| --- | --- | --- | --- |
| `athena-finality.json` | `.tmp/athena-finality.json` (generated) | release gate | Keys: `package`, `version`, `commit`, `passed`, `checks.{unit,ownership,exports,browserIsolation,tarballConsumer,postgres,embeddedAuth,nextE2E}`. `publish.js` requires SHA + version match. |

## Refresh process

When adding a public type:

1. Add a row here with classification and target name.  
2. Place the type under `src/contracts/v1/` (or `models/` if row/view).  
3. Add a named mapper if it crosses a boundary.  
4. Add a Zod schema under `src/runtime/` when the value is external input or a public envelope.  
5. Add a golden fixture under `test/fixtures/contracts/`.  
