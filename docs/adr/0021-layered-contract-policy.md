# ADR 0021: Layered contract policy

**Date:** 2026-07-28  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0002](0002-single-athena-client-type-and-stable-namespaces.md), [0009](0009-v3-breaking-migration-and-version-contract.md), [0010](0010-client-module-ownership-and-artifact-governance.md), [0011](0011-graduate-storage-into-base-client.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range

## Context

Types in Athena JS and consumer apps are often reused across layers: a storage “record” acts as DB row, SDK response, and UI state; inserts default to `Partial<Row>`; errors are inferred from free-form messages. That creates silent contract drift between the Rust gateway, the TypeScript SDK, formations APIs, and auth UI.

The intended rule is:

```text
Persistence model ≠ Athena model ≠ domain model ≠ API DTO ≠ UI state
```

Each layer must own its types. Cross-boundary conversion must be explicit.

This policy applies to:

1. `@xylex-group/athena` (`packages/athena-js`)
2. `@xylex-group/athena-auth-ui` (`packages/athena-auth-ui`)
3. Consumer applications such as formations

Athena is the foundational contract provider and is stabilized first (Phase 1). Consumers migrate after published DTOs exist.

## Decision

**Decision:** Enforce layer-specific types, naming suffixes, named mappers, runtime validation of external input, and versioned contract modules. Do not silently change wire shapes.

### Naming suffixes

| Suffix | Meaning |
| --- | --- |
| `Row` | Database or persistence representation |
| `AthenaRequest` | Request sent to Athena |
| `AthenaResponse` | Response returned by Athena |
| `Input` | Internal application/service input |
| `View` | Public/read-facing application representation |
| `Request` | HTTP request body/query representation |
| `Response` | HTTP response representation |
| `Patch` | Partial update command |
| `Create` | Creation command |
| `Page<T>` | Paginated result |
| `Error` | Structured error contract |

Examples: `FileRow`, `AthenaFileUploadRequest`, `UploadFileInput`, `FileView`, `UploadFileRequest`, `UploadFileResponse`, `RenameFilePatch`.

Avoid ambiguous names such as `FileRecord`, bare `Form`, `Database`, `Response`, or `Input` unless the layer is obvious from the module path.

### Boundary rules

1. No database row types in UI code.
2. No Athena SDK types in public API responses of consumer apps.
3. No API request types in persistence adapters.
4. No UI state types in service functions.
5. No `Partial<Row>` as a generic insert contract.
6. Every external input receives runtime validation.
7. Every mapping between boundaries has a **named** function (`mapAToB`).
8. Public DTOs must not expose infrastructure-only fields by default (bucket names, raw storage keys, provider ids, internal row ids when not product-facing).
9. Dynamic fields must be explicit extension fields (for example `metadata: JsonObject` or `extensions`), not unrestricted top-level properties.
10. Every public DTO has contract tests (fixtures + nullability + unknown-field policy).

### Mapper convention

Use `mapAToB` (not overloaded free functions):

```ts
mapStorageFileRowToManagedFileView(row)
mapNormalizedAthenaErrorToErrorResponse(error)
mapLimitPlusOneToPage(items, limit)
```

### JSON types

Decoded JSON uses:

```ts
type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
```

Use `unknown` only when the value is not yet decoded or may not be JSON. Existing `AthenaJsonValue` / `AthenaJsonObject` remain aliases of these contracts.

### Pagination

Cursor-first for new APIs:

```ts
interface Page<T, TCursor = string> {
  items: T[]
  nextCursor: TCursor | null
  hasMore: boolean
}
```

Also support `SequencePage<T>` and `OffsetPage<T>` for sequence and legacy offset surfaces. Do not force every endpoint into the same cursor encoding; keep endpoint-specific semantics internal and expose a generic cursor type on the public page.

Align TypeScript helpers with `crates/athena-core` (limit policies, limit-plus-one pages) without inventing gateway wire fields the server does not emit.

### Insert vs patch

Replace `Insert: Partial<Row>` / `Update: Partial<Row>` with field-aware types that distinguish:

- required fields
- defaulted fields
- server-generated fields
- immutable fields
- nullable fields
- fields clearable with `null`

Prefer `*Patch` for partial updates; keep `*Update` as a deprecated alias during one major line when needed.

### Errors

Public transport envelope:

```ts
interface AthenaErrorResponse {
  error: {
    code: AthenaTransportErrorCode
    message: string
    details?: JsonObject
    requestId?: string
    retryable: boolean
  }
}
```

Stable machine-readable codes:

```ts
type AthenaTransportErrorCode =
  | "validation_error"
  | "authentication_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "transient"
  | "internal"
```

Applications must not infer semantics from free-form messages. Existing SDK `AthenaErrorCode` (`NOT_FOUND`, …) remains for client diagnostics and maps to transport codes via named mappers.

### Runtime validation

Use **Zod** (already a package dependency) consistently for:

- request bodies
- query and pagination parameters
- error envelopes
- webhook/event payloads
- response envelopes where practical (strict on errors; optional strict responses behind a client flag)

Goal: schema parity between Rust gateway schemas, Athena TypeScript SDK schemas, and consumer DTO schemas.

### Module layout (SDK)

```text
src/contracts/v1/   # versioned transport contracts
src/models/         # rows vs views when split is needed
src/mappers/        # named boundary mappers
src/runtime/        # zod schemas + parse helpers
```

Breaking contract changes create `contracts/v2/` plus adapters. Do not silently change field names, nullability, pagination semantics, error codes, response nesting, or date formats.

### Cross-repo ownership

| Layer | Owner |
| --- | --- |
| Athena transport DTOs / rows / views used by the SDK | `packages/athena-js` |
| Auth UI state and presentation models | `packages/athena-auth-ui` |
| App domain, HTTP API DTOs, UI state | consumer (formations, …) |
| Gateway wire + SQL persistence | Athena monorepo Rust / SQL |

## Consequences

### Positive

- Clear seams for generators, storage, auth, and consumers
- Safer deprecations and fewer multi-layer type aliases
- Contract tests and inventory make drift reviewable
- Cursor pagination and transport errors become first-class

### Negative / trade-offs

- More types and mappers in the short term
- Generator insert/patch emission is stricter and may require introspection metadata quality
- Dual names during deprecation windows

### Compatibility

- Additive exports first; deprecate with aliases for 1–2 minors
- No silent wire breaks; dual-read when case or nesting changes
- Formations and auth-ui adopt after Phase 1 contracts publish

## Implementation notes

- Inventory: [`../contracts/inventory.md`](../contracts/inventory.md)
- Contract source: `src/contracts/v1/`
- Mappers: `src/mappers/`
- Runtime schemas: `src/runtime/`
- Rust pagination parity: `crates/athena-core`

## Status of related work

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Policy + inventory | This ADR |
| 1 | Athena SDK contracts spine | In progress |
| 2+ | Formations + auth-ui migration | Deferred |
