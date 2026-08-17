# Athena-JS 3.7.0 — Dragunov compatibility (SDD)

| Field | Value |
| --- | --- |
| Spec status | Implemented (program baseline) |
| Package | `@xylex-group/athena` |
| Current version (pre-bump) | `3.6.4` |
| Target version | **`3.7.0`** |
| Supported Athena servers | **4.1.x** and **5.0.x — Dragunov** |
| SDK major policy | Stay on **3.x** (no artificial sync with server major) |
| Spec date | 2026-08-05 |
| Related server SSOT | `docs/sdd/athena-5.0.0-dragunov-release.md`, `docs/release/athena-5-route-manifest.json`, `docs/migrations/5.0.0.md`, `crates/athena-release` |

## 1. Current package version

`packages/athena-js/package.json` → **3.6.4** at program start.

## 2. Target package version

**3.7.0** — additive Dragunov-compatible release. Public 3.x API preserved.

## 3. Supported Athena server range

| Server | Support |
| --- | --- |
| Athena 4.1.x | Required (full structured CRUD + root `query()`) |
| Athena 5.0.x Dragunov | Required (release metadata, route deprecation awareness, preferred `admin.query()`) |
| &lt; 4.0 | Out of scope / unsupported |
| &gt; 5.x | Best-effort with warning |

## 4. Public API compatibility commitment

- Do **not** remove `createClient()`, builders, `query()`, facades, or namespaces.
- Do **not** force an Athena-JS major solely because the server is 5.0.
- Additive surfaces only: `admin.query()`, `health()`, `system.release()`, `system.compatibility()`, release types.
- Root `query()` remains callable; marked `@deprecated` in favor of `admin.query()`.

## 5. Route inventory (SDK → server)

| Public SDK API | Implementation owner | Server route / local executor | Athena 4 | Athena 5 | Action |
| --- | --- | --- | ---: | ---: | --- |
| `athena.from().select()` | `client.ts` table builder | `POST /gateway/fetch` (or D1 compile) | Required | Required | Retain |
| `athena.from().insert()` | `client.ts` | `PUT /gateway/insert` | Required | Required | Retain |
| `athena.from().update()` | `client.ts` | `POST /gateway/update` | Required | Required | Retain |
| `athena.from().delete()` | `client.ts` | `DELETE /gateway/delete` | Required | Required | Retain |
| `athena.rpc()` | `client.ts` | `POST/GET /gateway/rpc` | Where supported | Required where supported | Retain |
| `athena.query()` | `createQueryBuilder` → admin path | `POST /gateway/query` | Required | Required (deprecated) | Deprecate alias |
| `athena.admin.query()` | `admin/query.ts` | `POST /gateway/query` | Additive | Preferred raw SQL | Add |
| `athena.health()` | `compatibility/report.ts` | `GET /health` (fallback `/`) | Normalize without release | Parse release | Add |
| `athena.system.release()` | health cache | same | Synthetic | Wire object | Add |
| `athena.system.compatibility()` | health cache | same | Conservative | Full | Add |
| Auth methods | `auth/*` | auth service routes | Required | Required | Retain |
| Chat methods | `chat/*` | chat routes + WS | Required | Required | Retain |
| Storage methods | `storage/*` | `/storage/*` + R2 | Required | Required | Retain |
| Billing methods | `billing/*` | `/billing/v1/*` | Required | Required | Retain |

Canonical classification source: `docs/release/athena-5-route-manifest.json`  
SDK mirror: `src/gateway/routes.ts` (`ATHENA_ROUTE_MANIFEST`, `ATHENA_GATEWAY_ROUTES`).

### Route classification (gateway)

| Path | Classification | Status in SDK |
| --- | --- | --- |
| `/gateway/fetch` | Retain | retained |
| `/gateway/insert` | Retain | retained |
| `/gateway/update` | Retain | retained |
| `/gateway/delete` | Retain | retained |
| `/gateway/query` | Deprecate | deprecated (still used) |
| `/health` | Retain | release identity |

## 6. Constructor inventory

| Constructor / facade | Role |
| --- | --- |
| `createClient()` | Canonical root constructor (`v3-client.ts`) |
| `createAthenaBrowserClient` | Thin browser façade |
| `createAthenaServerClient` | Thin server façade |
| `createCloudflareClient` / `createAthenaRuntime*` / `createAthenaFromWorkerEnv` | Edge mapping into `createClient` |

All facades remain thin; no second client core.

## 7. Protocol inventory

| Protocol | Athena 4 default | Athena 5 |
| --- | --- | --- |
| Structured query | 1 | 1 |
| Errors | 1 | 1 |
| Health / release | 1 (no codename) | 2 (release object) |

## 8. Raw SQL decision

| Surface | Policy |
| --- | --- |
| Keep `athena.query(sql, options?)` | Yes — required compatibility |
| Add `athena.admin.query({ sql, params?, operation, expectedShape, ... })` | Yes — preferred |
| Remove root query in 3.7 | **No** |
| Dual independent implementations | **No** — root routes through admin implementation |
| Operation required on admin API | **Yes** (explicit; `unknown` allowed as escape hatch) |
| Multi-statement | Reject by default |
| Fabricate `affectedRows = 0` | **Forbidden** when meta absent → `null` |

## 9. Release identity model

Types: `AthenaReleaseIdentity`, `AthenaReleaseChannel` in `src/release/identity.ts`.

Wire → SDK:

- `display_name` → `displayName`
- Missing Athena 4 `release` → synthesize from `version`, **codename: null**

**Codename rule:** never use codename for feature gates.

## 10. Capability negotiation model

- Existing `client.capabilities` retained (gateway vs edge).
- New lazy `client.system.compatibility()` with per-client cache.
- No mandatory health call before every CRUD op.

## 11. Athena 4 fallback behavior

- Structured CRUD unchanged.
- Root `query()` payload still accepted (extra fields ignored by server).
- Missing release is not an error.
- Dragunov-only fields never required.

## 12. Athena 5 behavior

- Parse release metadata.
- Prefer structured CRUD routes.
- Surface raw query deprecation (JSDoc + optional diagnostic warning).
- `admin.query()` sends `operation` + `expectedShape`.

## 13. Cloudflare D1 behavior

- Edge binding path must not silently HTTP-proxy when mode is edge.
- Shape-aware: rows → `all`, affected-only → `run` (workers-rs / existing adapter direction).
- Honest mutation metadata.
- Fail closed on NaN/Inf (existing adapter invariants).

Parity matrix (target):

| Behavior | JS D1 adapter | workers-rs D1 | Required |
| --- | --- | --- | ---: |
| Positional binds once | Yes | Yes | Yes |
| Select rows path | Yes | Yes | Yes |
| Mutation affected path | Yes | Yes | Yes |
| NULL / BLOB | Yes | Yes | Yes |
| NaN/Inf fail closed | Yes | Yes | Yes |
| No silent HTTP fallback (edge mode) | Yes | Yes | Yes |

## 14. Error taxonomy (SDK codes)

| Code | Meaning |
| --- | --- |
| `ATHENA_RAW_SQL_COMPAT_DEPRECATED` | Root `query()` used (warning) |
| `ATHENA_ADMIN_QUERY_EMPTY_SQL` | Empty SQL |
| `ATHENA_ADMIN_QUERY_MULTI_STATEMENT` | Multi-statement rejected |
| `ATHENA_ADMIN_QUERY_INVALID_SHAPE` | Illegal operation/shape pair |
| `ATHENA_COMPAT_UNDISCOVERED` | Health not yet discovered |
| `ATHENA_SERVER_MAJOR_UNSUPPORTED` | Server major &lt; 4 |
| `ATHENA_SERVER_MAJOR_NEWER` | Server major &gt; 5 (warning) |

## 15. Test matrix

| Area | File / command |
| --- | --- |
| Release identity normalize | `test/dragunov-release-identity.test.ts` |
| Athena 4/5 health | same |
| Compatibility report | same |
| Route manifest mirror | same |
| admin.query payload | same |
| root query compatibility | same + existing `query-builder-behavior` |
| Multi-statement reject | same |
| affectedRows honesty | same |

## 16. Documentation plan

- This SDD
- `docs/migrations` consumer notes (package release notes / CHANGELOG 3.7.0)
- Prefer monorepo `docs/migrations/5.0.0.md` for server-side migration

## 17. Release gates

1. Unit tests for release/admin/compat green
2. Existing query builder tests green
3. Package typecheck / build
4. No removal of public 3.x entrypoints
5. Version `3.7.0` + CHANGELOG

## 18. Explicit non-goals

- Athena-JS major bump to 5
- Removing root `query()`
- Codename-based feature switches
- Broad Auth UI / chat UI / billing rewrites
- Speculative Athena 6 architecture

## 19. Rollback plan

- Revert 3.7.0 publish; consumers stay on 3.6.x
- Server 5 remains independently versioned
- Root `query()` path remains on `/gateway/query` if admin surface is reverted

## 20. Known limitations

- Gateway may ignore `operation` / `expectedShape` until server fully consumes them
- Deprecation warnings are once-per-client, not per-callsite stack frames
- D1 shape-aware `run` vs `all` for admin path follows transport implementation; HTTP gateway still returns row envelopes
- Full multi-runtime CI matrix (Next/browser/Workers E2E) is progressive; unit proofs land first

## Exact `admin.query()` contract

```ts
await athena.admin.query({
  sql: string,                 // required, non-empty
  params?: readonly unknown[],
  operation: AthenaRawQueryOperation, // required
  expectedShape: AthenaExpectedQueryShape, // required
  headers?: Record<string, string>,
  signal?: AbortSignal,
})
// → AthenaAdminQueryResult<T> extends AthenaResult with metadata
```

## Root `query()` strategy

```text
athena.query(sql, options)
  → deprecation warn (controlled)
  → classify operation conservatively
  → admin.query({ sql, params, operation, expectedShape: 'rows' })
  → strip metadata for legacy AthenaResult
```
