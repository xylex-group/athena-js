# ADR 0017: D1/SQLite SQL compiler and mutation bounds

**Date:** 2026-07-24  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0015](0015-execution-transport-and-cloudflare-edge.md), [0016](0016-drop-in-edge-bindings-on-create-client.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Cloudflare D1 / SQLite dialect as implemented by the Workers D1 binding

## Context

Gateway payloads (`AthenaFetchPayload`, `AthenaInsertPayload`, `AthenaUpdatePayload`, `AthenaDeletePayload`) were designed for the Athena HTTP gateway, which may target PostgreSQL. Edge-local mode compiles those **same flat payloads** to SQLite for D1.

Several dialect and safety gaps appear if the compiler is naïve:

1. **Postgres-only SQL** in raw `query()` (casts, some functions) must be rewritten or rejected for SQLite.
2. **Multi-row sparse inserts** cannot put `DEFAULT` inside multi-value `VALUES` tuples on SQLite; they must expand to a batch of single-row statements (or NULL-coerce when requested).
3. **Empty single-row inserts** need `DEFAULT VALUES`.
4. **Bounded updates/deletes** must not silently become unbounded. Fluent `.range()` / `.limit()` store `limit` / `offset` on the builder; if the mutation payload omits them, D1 would delete/update every matching row.
5. **ORDER BY without bounds** on mutations is unsafe without a page size; the compiler must require bounds.

## Decision

**Decision:** Edge DB execution owns a dedicated **D1 SQL compiler** (`compileD1Fetch` / `Insert` / `Update` / `Delete` / `Count`) that:

1. Accepts the **existing gateway payload shapes** (no parallel fluent AST).
2. Emits **SQLite-safe** SQL and bind params.
3. Implements **bounded mutations** via `rowid IN (SELECT rowid FROM … ORDER BY … LIMIT … OFFSET …)` when pagination or sort is present.
4. Fails with structured `D1SqlCompileError` codes for unsupported or unsafe shapes.

### Payload bounds for mutations

- Fluent builders **must** copy `state.limit` / `state.offset` into update and delete payloads (in addition to `page_size` / `current_page` when used).
- `AthenaDeletePayload` includes optional `limit` / `offset` so range-based deletes are expressible end-to-end.
- `AthenaUpdatePayload` already extends fetch pagination fields (`limit` / `offset`); builders must populate them the same way as delete.
- `hasPaginationBounds` is true when any of `limit`, `offset`, `page_size`, or `current_page` is set.
- Delete/update with `sort_by` but **no** bounds → compile error (`order_without_bounds`).
- Delete/update with bounds → rowid subquery path; without bounds and without sort → single `WHERE` clause over filters only (full matching set).
- Example: `from('events').eq('pending', true).limit(1).update(...)` must compile a rowid-bounded UPDATE, not an unbounded filtered UPDATE.

### Result shape: stripNulls

- Gateway default is `strip_nulls: true` / `stripNulls: true` (omit keys whose value is JSON `null`).
- D1 transport **must** apply the same normalization on returned row objects for fetch, mutations with RETURNING, and raw query when strip is enabled.
- Explicit `strip_nulls: false` or `stripNulls: false` retains null-valued keys.

### Head-only mutations

- When `payload.head === true` on insert/upsert (and other mutations that accept `head`), **do not** emit `RETURNING` even if `columns` is set.
- Return empty row data and surface affected-row count via D1 `meta.changes` (same as sparse batch inserts without RETURNING).

### Select / RETURNING aliases

- Use shared alias-aware quoting (`quoteSelectColumnsExpression` / response alias `alias:column` and SQL-style `column as alias`).
- Do **not** quote the entire `user_id:id` token as one identifier.

### Inserts

| Case | Behavior |
| --- | --- |
| Single empty body | `INSERT INTO t DEFAULT VALUES` |
| Multi empty bodies | Reject (`empty_insert`) |
| Sparse multi-row (missing keys differ) | Batch of single-row inserts (no `DEFAULT` in VALUES) |
| `default_to_null: true` | Bind NULL for missing keys in a multi-row VALUES form when schema allows |
| Optional `RETURNING` | Append when columns requested |

### Sparse batch result counts

D1 batch statements without `RETURNING` often return **empty** `results` arrays while reporting affected rows on `meta.changes`. The transport **must** sum `meta.changes` across batch results when computing `count` for callers (including exact-count expectations after multi-row insert).

### Head / exact count

- `head: true` on fetch compiles to `SELECT COUNT(*) AS __athena_count …` and returns empty data with a count.
- Exact/planned/estimated count options on select may issue a companion count query as documented in transport tests.

### Unfiltered mutations

- Unfiltered update/delete without `resource_id` or conditions is **rejected** on edge-local (`unfiltered_update` / `unfiltered_delete`).
- Fluent delete still requires resource id or conditions at the builder layer (gateway parity).

## Contract

- Compiler lives under `src/cloudflare/d1/sql.ts`; runner under `runner.ts`; transport implements `AthenaGatewayClient`.
- Postgres → SQLite rewrite for raw queries is best-effort and documented; unsupported constructs fail clearly.
- RPC is unsupported on the D1 transport (deterministic error).
- Nested relation selects / findMany AST remain out of scope until layers are enabled (ADR 0020).
- Debug SQL builders for update/delete honor `limit` / `offset` as well as page fields.

## Consequences

- `from('events').eq('expired', true).range(0, 9).delete()` deletes **at most ten** matching rows, not all matches.
- Apps must not assume PostgreSQL SQL works unchanged on D1.
- Batch inserts report non-zero `count` without requiring `RETURNING`.
- Gateway HTTP behavior for the same fluent chains is unchanged; this ADR only constrains edge compilation and payload completeness for mutations.

## Validation

- SQL fixture tests for select/insert/update/delete, sparse batch, DEFAULT VALUES, head count.
- `delete` / `update` with `limit`/`offset` and with `page_size`/`current_page` emit rowid subqueries.
- Query-builder tests assert delete/update payloads include `limit` from `.range()` / `.limit()`.
- Transport test: sparse multi-row insert batch → `count === rowCount` via `meta.changes`.
- Transport test: unbounded delete path still requires filters; range delete includes `LIMIT`.
