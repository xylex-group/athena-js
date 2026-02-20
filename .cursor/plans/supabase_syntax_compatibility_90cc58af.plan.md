---
name: Supabase Syntax Compatibility
overview: Implement strict Supabase-style backward compatibility in Athena’s query builder, including chainable mutation flows, broader filters/modifiers, and expanded documentation with parity examples.
todos:
  - id: builder-core-refactor
    content: Refactor query builder execution model for strict chainable Supabase-style syntax.
    status: completed
  - id: add-filters-modifiers
    content: Implement full filter/operator set plus range() and upsert() support.
    status: completed
  - id: gateway-contract-update
    content: Extend gateway payload/types to encode operators and mutation-return options.
    status: completed
  - id: compat-tests
    content: Add/expand tests for select/insert/upsert/update/delete parity and chaining.
    status: completed
  - id: docs-parity
    content: Update README, getting-started, and API reference with Supabase-compatible examples and option docs.
    status: completed
isProject: false
---

# Supabase-Compatible Athena SDK Plan

## Goals

- Make Athena query syntax closely match Supabase behavior for reads, inserts, updates, deletes, and upserts.
- Preserve existing Athena usage while adding strict chainable compatibility.
- Expand docs with parity-focused examples and option semantics.

## Planned Changes

- Update query builder internals in `[c:/Users/floris/Documents/GitHub/athena-js/src/supabase.ts](c:/Users/floris/Documents/GitHub/athena-js/src/supabase.ts)`:
  - Convert builder execution model to support Supabase-style chaining:
    - `from(...).select(...).eq(...).range(...)`
    - `from(...).insert(...).select(...).single()`
    - `from(...).update(...).eq(...).select()`
    - `from(...).delete().eq(...)`
  - Add missing filters/modifiers and compatibility methods:
    - `range(from, to)`
    - `gt`, `gte`, `lt`, `lte`, `neq`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`, `not`, `or`
    - `upsert(values, options?)`
  - Preserve existing methods (`eq`, `match`, `limit`, `offset`, `single`, `maybeSingle`, `reset`) with backward-safe behavior.
- Extend gateway payload contracts in `[c:/Users/floris/Documents/GitHub/athena-js/src/gateway/types.ts](c:/Users/floris/Documents/GitHub/athena-js/src/gateway/types.ts)`:
  - Generalize condition representation beyond `eq_column/eq_value` so all supported operators can be encoded.
  - Add operation metadata needed for mutation+select and upsert parity.
  - Add typed options support for Supabase-compatible options (`count`, `head`, `defaultToNull`, and upsert-specific options as needed).
- Wire request handling in `[c:/Users/floris/Documents/GitHub/athena-js/src/gateway/client.ts](c:/Users/floris/Documents/GitHub/athena-js/src/gateway/client.ts)` and `[c:/Users/floris/Documents/GitHub/athena-js/src/gateway/use-athena-gateway.ts](c:/Users/floris/Documents/GitHub/athena-js/src/gateway/use-athena-gateway.ts)`:
  - Ensure new payload fields are passed through correctly.
  - Keep normalization/headers behavior stable while supporting new query semantics.
- Add/expand tests:
  - Update `[c:/Users/floris/Documents/GitHub/athena-js/test/gateway.test.ts](c:/Users/floris/Documents/GitHub/athena-js/test/gateway.test.ts)` with new payload shape/unit assertions.
  - Add integration-style builder behavior tests (new file, e.g. `test/supabase-compat.test.ts`) to cover:
    - `select` forms (all rows/specific columns/referenced table strings)
    - pagination via `range`
    - all added filters
    - `insert` single/bulk + `.select()`
    - `upsert(...).select()`
    - `update(...).eq(...).select()`
    - `delete().eq(...)`
- Expand docs for parity and migration:
  - Update `[c:/Users/floris/Documents/GitHub/athena-js/docs/api-reference.md](c:/Users/floris/Documents/GitHub/athena-js/docs/api-reference.md)` with signatures, options tables, and compatibility notes.
  - Update `[c:/Users/floris/Documents/GitHub/athena-js/docs/getting-started.md](c:/Users/floris/Documents/GitHub/athena-js/docs/getting-started.md)` with end-to-end Supabase-like examples.
  - Update `[c:/Users/floris/Documents/GitHub/athena-js/README.md](c:/Users/floris/Documents/GitHub/athena-js/README.md)` with concise compatibility examples.

## Behavior Compatibility Notes

- Maintain backward compatibility for current Athena calls while introducing strict Supabase-like chains.
- Implement option behavior as real functionality (not no-op), including `count/head/defaultToNull` and mutation-return semantics via `.select()`.
- If backend gateway capabilities are externally constrained, reflect exact supported/unsupported behavior clearly in docs and test expectations.

## Verification

- Run tests and ensure all new compatibility scenarios pass.
- Validate TypeScript builder ergonomics and chaining inference.
- Confirm docs examples match implemented behavior exactly.

