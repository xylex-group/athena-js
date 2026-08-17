# ADR 0003: Derive query typing from known models and rows

**Date:** 2026-07-15
**Status:** Accepted
**Author:** Floris
**Accepted by:** Floris
**Pinned versions:**
- `athena-monorepo-root@3.29.0` - current repository manifest.
- `@xylex-group/athena@2.16.0` - current SDK baseline.
- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- `athena-auth-ui@1.16.1` - current local dependent baseline.
- Node.js `>=18.0.0` - declared engine range.

## Context

`experimental.typecheckColumns` is documented as type-only. It does not change runtime requests, yet it introduces `TStrict extends boolean` across clients, table builders, DB modules, RPC builders, builder states, adapter overloads, typed clients, and config variants.

The SDK already knows row keys when callers use model values, a models registry, or explicit row generics. Unknown string tables remain inherently dynamic.

## Decision

**Proposition:** Column and table typing will derive from known model or row information and will not be enabled by a boolean client mode.

Known shapes are checked by default. Unknown shapes remain permissive. Dynamic callers use an explicit local escape hatch rather than weakening an entire client.

## Contract

- `experimental.typecheckColumns` is absent from v3.
- `TStrict` is absent from public client, DB, table-query, and RPC-query types where it represents column checking.
- `from(modelValue)` checks model column names.
- `from(tableName)` checks table and column names when `TModels` resolves that table.
- `from<Row>(tableName)` checks column names against `Row`.
- Calls without a known model or row continue accepting runtime strings.
- Selection aliases, relation selectors, schema qualification, RPC filters, and order clauses preserve their current grammar.
- Any unsafe escape hatch is explicit at the callsite, narrowly scoped, and documented.
- Type checking is not controlled by runtime configuration or environment variables.

## Consequences

- The boolean generic and all strictness config combinations disappear.
- Known-row consumers may receive stricter compile errors after migration.
- Type inference becomes predictable from the callsite rather than constructor history.
- Type utilities must carefully distinguish an unknown row from a known row with index signatures.
- Focused compatibility fixtures become more important than overload snapshots.

## Validation

- Type fixtures must prove known models, registry table names, explicit row generics, aliases, relations, RPC filters, and order clauses.
- Negative type fixtures must reject misspelled known columns.
- Dynamic table tests must prove unknown strings remain usable.
- `rg` must find no public `TStrict` or `typecheckColumns` contract in v3 declarations/docs.
- `pnpm typecheck` and the typed-schema test suite must pass.
- Declaration build output must show no boolean strictness generic on `AthenaClient`.
