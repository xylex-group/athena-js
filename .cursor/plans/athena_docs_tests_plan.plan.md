---
name: Athena Docs & Tests Cleanup
overview: Remove Supabase references, clarify Athena-specific docs, and add fixture-based tests that cover query builder flows.
todos:
  - id: docs-cleanup
    content: Remove Supabase references from README/docs and rewrite examples to focus on Athena semantics.
    status: pending
  - id: fixture-tests
    content: Add more fixtures/unit tests covering select filters, mutations, and options using Athena helper functions.
    status: pending
isProject: false
---

# Athena Documentation & Tests Cleanup

## Goals

- Replace all Supabase-specific language in documentation with Athena-native terminology, ensuring the README/getting-started/API reference describe Athena’s `createClient`, query builder, and options.
- Expand the test suite with fixture-based coverage that exercises the Athena query builder’s select filters, mutations (`insert`, `upsert`, `update`, `delete`), and options (range, count, defaultToNull).

## Proposed Work

- Update `README.md`, `docs/getting-started.md`, and `docs/api-reference.md` to:
  - Remove any direct mention of Supabase, emphasizing Athena’s client name `@xylex-group/athena`.
  - Provide usage examples that align with Athena’s API (filters, pagination, return semantics, etc.).
  - Highlight supported options (`count`, `head`, `defaultToNull`, `onConflict`, mutation chaining) without referencing Supabase behavior.
- Introduce new fixture-style tests (e.g., `test/athena-builder.test.ts`) that:
  - Instantiate Athena client with a mocked fetch and validate payloads for select with filters, range, and modifiers.
  - Verify insert/upsert mutations produce retriable `MutationQuery` behavior when followed by `.select()` or `.single()`.
  - Assert update/delete requests include the correct conditions/options and handle `defaultToNull`, `count`, and `head`.
  - Cover success/failure responses to ensure SDK surfaces `data`/`error` properly.

## Verification

- `npm test`
- Read updated docs to confirm no Supabase references remain and Athena usage is clear.
