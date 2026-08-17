# ADR 0022 ? Canonical Athena application project layout (Architecture 4.0)

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Athena JS platform
- **Depends on:** 0001, 0010, 0014
- **SHA pin (authoring):** `7f49588d62cbafb21b8e7cd54e7a7c60d2b89f77`

## Context

Athena applications, examples, and scaffolds used multiple infrastructure layouts
(root `athena/*`, `app/lib/athena-*`, partial `src/lib/athena/*`). That dual-core
ownership (OWN-001) blocked consistent documentation, doctor enforcement, and migration.

## Decision

There is exactly one canonical application infrastructure layout:

```text
athena.config.ts
src/lib/athena/
  client.ts              # export athena only
  server.ts              # export createAthenaServer (factory) only
  session.ts             # export athenaSession only (auth)
  public-config.ts       # optional
  generated/             # generator-owned only
    registry.ts
    models/{schema}/...
    schema/...
    relations.ts
.athena/generated-manifest.json
.athena/scaffold-manifest.json
```

### Architectural invariants (bind after scaffold SSOT)

| ID | Invariant |
| -- | --------- |
| A | Exactly one browser Athena client construction |
| B | Exactly one server Athena client factory |
| C | Exactly one configured session resolver |
| D | Generated files only under `src/lib/athena/generated/` |
| E | Business code never imports tooling |
| F | Runtime never imports `athena.config.ts` |
| G | No runtime Athena files outside `src/lib/athena/` |
| H | Doctor fails closed if A?G false |

### Package boundaries

| Package | Owns | Must never |
| ------- | ---- | ---------- |
| `@xylex-group/athena` | Runtime + generator emit | Mutate application projects |
| `create-athena-app` | Scaffold, doctor, migrate, manifests | Own runtime SDK implementation |

### Generated surface

Generator owns only paths under `src/lib/athena/generated/` plus
`.athena/generated-manifest.json`. Canonical model home is the **`models/` directory**.
Every generated file carries the Athena generated banner.

### Compatibility

- **N** = this layout (generator default `athena-direct` preset).
- **N-1** = root `athena/*` (generator `legacy` preset) + `app/lib/athena-*`.
- Generator emits **N only** by default. Doctor warns on N-1. Migrate upgrades to N.
- `defineAthenaConfig` is preferred; `defineGeneratorConfig` is an alias until 5.0 (AD-003).

### Dependency graph

Edges not shown are forbidden:

```text
athena.config.ts ? generator ? generated/**
client.ts ? generated/** , public-config?
server.ts ? generated/**
session.ts ? server.ts
features/* ? client | server | session
```

## Consequences

- create-athena-app scaffolds and docs must emit only this layout.
- Official examples must converge.
- Architecture Conformance Suite (ACT-001?012) gates releases.
- Residual debt AD-001?004 tracked until 5.0 / 4.0 GA.

## References

- Session plan: Athena Architecture 4.0 Implementation Specification
- Doctor: `packages/create-athena-app/src/doctor/architecture.ts`
- Generator defaults: `packages/athena-js/src/generator/config.ts`
