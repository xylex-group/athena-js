---
name: Add order to table builder
overview: "Add `.order(column, { ascending })` to the table query builder chain (select/update/delete, before or after `.select()`), serialized as `sort_by: { field, direction }` in the fetch/update/delete payload, and cover it with tests and docs updates."
todos:
  - id: types
    content: Add AthenaSortBy + AthenaSortDirection and wire sort_by into AthenaFetchPayload and AthenaDeletePayload in src/gateway/types.ts
    status: completed
  - id: builder
    content: Add order() to FilterChain, track state.order, and include sort_by in select/update/delete payloads in src/client.ts
    status: completed
  - id: tests
    content: Add order() coverage for select (before/after select), update, default ascending, and absence regression
    status: completed
  - id: docs
    content: Document .order() in docs/api-reference.md, docs/getting-started.md, and README.md
    status: completed
isProject: false
---

## Why

Currently `.order()` only exists on the RPC builder ([src/client.ts:201](src/client.ts)). The table chain `SelectChain` / `TableQueryBuilder` in [src/client.ts](src/client.ts) has no `.order()`, so this fails today:

```ts
await athena
  .from("rsf_messages")
  .eq("room_id", roomId)
  .select("*", { stripNulls: false })
  .order("created_at", { ascending: false })
  .limit(100);
```

The gateway already accepts the order via a `sort_by` object on `/gateway/fetch`:

```json
{ "table_name": "rsf_messages", "sort_by": { "field": "created_at", "direction": "descending" } }
```

## Chain shape (data flow)

```mermaid
flowchart LR
  from["from(table)"] --> fc["FilterChain (eq / order / limit ...)"]
  fc --> select[".select(cols, opts)"]
  select --> sc["SelectChain (filters + order still chainable)"]
  sc --> exec["runSelect -> POST /gateway/fetch"]
  fc --> upd[".update(set)"]
  upd --> uc["UpdateChain (filters + order)"]
  uc --> execU["executeUpdate -> POST /gateway/update"]
  exec --> payload["payload includes sort_by"]
  execU --> payload
```

## Changes

### 1) Types — [src/gateway/types.ts](src/gateway/types.ts)

Add `AthenaSortDirection` + `AthenaSortBy` and wire it into fetch/update/delete payloads:

```ts
export type AthenaSortDirection = 'ascending' | 'descending'

export interface AthenaSortBy {
  field: string
  direction: AthenaSortDirection
}

export interface AthenaFetchPayload {
  // ...existing fields
  sort_by?: AthenaSortBy
}

export interface AthenaDeletePayload {
  // ...existing fields
  sort_by?: AthenaSortBy
}
// AthenaUpdatePayload already extends AthenaFetchPayload, so it inherits sort_by.
```

### 2) Builder — [src/client.ts](src/client.ts)

- Extend `TableBuilderState` with `order?: AthenaSortBy`.
- Add `order(column, options?)` to the `FilterChain<Self>` interface (line 142) so it appears on `TableQueryBuilder`, `SelectChain`, and `UpdateChain`. Reuse/export the existing `RpcOrderOptions` as the `OrderOptions` shape (or alias). Signature:
  ```ts
  order(column: string, options?: { ascending?: boolean }): Self
  ```
- In `createFilterMethods` (around line 248), add:
  ```ts
  order(column: string, options?: { ascending?: boolean }) {
    state.order = {
      field: column,
      direction: options?.ascending === false ? 'descending' : 'ascending',
    }
    return self
  }
  ```
- In `runSelect` (line 532) include `sort_by: state.order` when set.
- In `executeUpdate` (line 682) include `sort_by: state.order` when set.
- In `executeDelete` (line 710) include `sort_by: state.order` when set.

### 3) Tests — extend [test/query-builder-behavior.test.ts](test/query-builder-behavior.test.ts) (and a user-facing case in [test/athena-builder.test.ts](test/athena-builder.test.ts))

New cases:
- `select + eq + order desc + limit` produces expected payload:
  ```js
  assert.deepEqual(payload.sort_by, { field: 'created_at', direction: 'descending' })
  assert.equal(payload.limit, 100)
  ```
- order with default ascending → `direction: 'ascending'`.
- order called before `.select()` (on the base `TableQueryBuilder`) still serializes.
- order called after `.select()` on `SelectChain` serializes (the user's target case).
- `update().eq(...).order(...)` sends `sort_by` on the update payload.
- Regression: existing tests without `.order()` still have `payload.sort_by === undefined`.

### 4) Docs

- [docs/api-reference.md](docs/api-reference.md): add `.order()` to `SelectChain` / `TableQueryBuilder` section and list the `AthenaSortBy` payload field.
- [docs/getting-started.md](docs/getting-started.md) (section "4. Filter" and a new "Sort" subsection) and [README.md](README.md) (filter list around line 236): add `.order()` example:
  ```ts
  await athena
    .from("rsf_messages")
    .eq("room_id", roomId)
    .select("*", { stripNulls: false })
    .order("created_at", { ascending: false })
    .limit(100);
  ```

## Non-goals

- No changes to RPC order behavior (already works).
- No gateway/server changes — the server already supports `sort_by`.
- No new public types exported beyond `AthenaSortBy` / `AthenaSortDirection`.