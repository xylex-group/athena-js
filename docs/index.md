# Athena JS SDK Documentation

This docs set is organized for teams that need both runtime speed and long-term type safety.

Use these pages in sequence if you are onboarding a new codebase, or jump directly to the track that matches your current problem.

## Reading tracks

### Track A - Runtime-first onboarding

1. [`getting-started.md`](getting-started.md) - install, runtime client setup, query/writes/RPC, and practical guardrails
2. [`api-reference.md`](api-reference.md) - exact signatures for the runtime client, builders, payloads, and helpers
3. [`cli-command-reference.md`](cli-command-reference.md) - CLI commands and troubleshooting

### Track B - Typed model architecture

1. [`typed-schema-registry.md`](typed-schema-registry.md) - model contracts, registry composition, and typed client behavior
2. [`type-safety-playbook.md`](type-safety-playbook.md) - migration strategies, anti-patterns, and form/validation alignment
3. [`api-reference.md`](api-reference.md) - utility types and generic contracts

### Track C - Generator and CI

1. [`generator-config.md`](generator-config.md) - provider modes, output templates, naming, and feature flags
2. [`generator-cicd.md`](generator-cicd.md) - deterministic CI expectations for generated artifacts
3. [`generator-codex-handoff-prompt-pack.md`](generator-codex-handoff-prompt-pack.md) - prompt templates for large generator maintenance tasks

### Track D - Athena Auth Client

1. [`auth/index.mdx`](auth/index.mdx) - full grouped auth docs by domain (session, user, admin, api-key, organization, passkey, two-factor, callback, and `useSession`)
2. [`auth-client-bindings.md`](auth-client-bindings.md) - compact single-page route map
3. [`api-reference.md`](api-reference.md) - envelope contracts and exported auth types

## Concept map

```text
Runtime client (createClient / AthenaClient.builder)
  -> Optional typed client (createTypedClient)
    -> Registry contracts (defineModel / defineSchema / defineDatabase / defineRegistry)
      -> Optional generator pipeline (athena-js generate)
        -> Generated model/schema/database/registry files
          -> Runtime query builders + app/domain form surfaces
```

## What changed recently (type-system focus)

- `TableQueryBuilder` now carries `Row`, `Insert`, and `Update` generics end-to-end.
- Filter operations (`eq`, `gt`, `order`, etc.) are now keyed to typed row columns when row keys are known.
- Gateway payload contracts now use JSON-safe primitives (`AthenaJsonValue`, `AthenaJsonObject`, `AthenaJsonArray`) instead of broad untyped records.
- Typed registry `fromModel(...)` now forwards `RowOf`, `InsertOf`, and `UpdateOf` into the table builder, preserving write-contract typing.

## Which page to open first

- If your app is mostly string-table runtime calls: start at [`getting-started.md`](getting-started.md).
- If your issue is type drift across domains: start at [`type-safety-playbook.md`](type-safety-playbook.md).
- If your issue is generated artifacts or CI determinism: start at [`generator-config.md`](generator-config.md) and [`generator-cicd.md`](generator-cicd.md).
- If your issue is auth endpoint parity and typed auth bindings: start at [`auth/index.mdx`](auth/index.mdx).
- If your issue is exact method signatures: use [`api-reference.md`](api-reference.md).
