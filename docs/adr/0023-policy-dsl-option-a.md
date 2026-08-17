# ADR 0023 — Policy DSL Option A (`policy(model, { select: … })`)

## Status

Accepted (Phase 1)

## Context

Athena Policy needs a TypeScript authoring API integrated with AthenaModels.
Three shapes were compared (continuation SDD §24):

| Option | Shape |
| --- | --- |
| **A** | `policy(model, { select: { to, allow } })` |
| B | Fluent `policy(model).select({…})` |
| C | Callback builder `policy(model, ({ select, row, auth }) => […])` |

## Decision

**Freeze Option A** for v1 public authoring.

## Consequences

- Single call produces one or more action-scoped `PolicyDefinition`s.
- Maps cleanly to Postgres RLS command axes (`FOR SELECT` / `INSERT` / …).
- IDE autocomplete on the config object is straightforward.
- Fluent chaining (B) deferred; can be added as sugar later without breaking A.
- Callback arrays (C) deferred — harder diagnostics and Prettier noise.

## Non-goals

- No `PolicyClient` type (ADR 0001/0002).
- No hot-path evaluation of TS callbacks (compile to IR offline).
