# ADR 0026: Canonical Athena Query AST and resolved plan

**Date:** 16 August 2026
**Status:** Accepted
**Author:** Floris
**Depends on:** [0020](0020-client-capabilities-and-edge-layer-honesty.md), [0022-direct-postgres-runtime-transport.md](0022-direct-postgres-runtime-transport.md), [0024](0024-athena-query-descriptor-and-model-graph.md)
**SDD:** [`docs/sdd/athena-query-ast-and-resolved-plan.md`](../../../docs/sdd/athena-query-ast-and-resolved-plan.md)

## Context

Structured `findMany({ select })` semantics lived in the Rust Gateway. Direct PostgreSQL and D1 compiled only flat fetch payloads and rejected nested AST / operation envelopes (`Direct AST operation payloads are unsupported on PostgreSQL direct`).

[`AthenaQueryDescriptor`](../../src/query/descriptor.ts) is cache IR. It is not a portable SQL AST.

## Decision

Athena JS owns a backend-neutral **AthenaQueryAst** and a separate **AthenaQueryPlan**.

```text
public input → AthenaQueryAst → resolve → AthenaQueryPlan → compiler
```

1. One public client and query language (`createClient`, `from`, `findMany`).
2. Builders emit semantic state; they MUST NOT branch on engine.
3. Relation resolution happens once, before any dialect compiler.
4. PostgreSQL SQL lives in `postgres/compile-ast.ts`. D1 SQL lives in `cloudflare/d1/compile-ast.ts`. Gateway wire lives in `gateway/serialize-ast.ts`.
5. Values are bound (`$n` / `?`). Identifiers are validated and quoted.
6. Direct mode MUST NOT fall back to Gateway HTTP.
7. Nested relations compile to one relational statement (no default N+1).

`AthenaQueryDescriptor` remains the React/cache IR (ADR 0024).

## Non-goals

- A second public query syntax
- `createPostgresClient` / `createAstClient`
- Shipping many-to-many / parent-relation filters before P1
- Moving `pg` onto the browser graph

## Consequences

- Direct PostgreSQL can execute the same nested `findMany` as Gateway when the relation is uniquely resolvable.
- Capabilities: PG direct `layers.findManyAst` and `layers.relations` become true; `rpc` stays fail-closed until implemented.
- Flat `compilePostgresFetch` / `compileD1Fetch` remain for L1 payloads; structured trees go through the plan pipeline.
