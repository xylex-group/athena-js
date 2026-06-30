# Athena JS SDK Documentation

This docs set is organized for teams that need both runtime speed and long-term type safety.

Use these pages in sequence if you are onboarding a new codebase, or jump directly to the track that matches your current problem.

## Reading tracks

### Track A - Runtime-first onboarding

1. [`getting-started.md`](getting-started.md) - install, unified-root client setup, query/writes/RPC, chat, low-level request hatch, schema-targeting entrypoints, and practical guardrails
2. [`auth-session-forwarding.md`](auth-session-forwarding.md) - how gateway/query requests mirror Athena Auth session and bearer context into `X-Athena-Auth-*` headers
2b. [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md) - lean cookbook: header map, surface reference table, keys/auth/routing, per-surface examples, scoped clients, and precedence
3. [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md) - canonical `findMany(...)` AST semantics, transport mapping, base-table schema targeting, cross-schema relation examples, and server follow-up work
4. [`runtime-method-ast-models.md`](runtime-method-ast-models.md) - normalized AST/state/payload models for `select`, mutations, `rpc`, `query`, builder filters, and route selection
5. [`select-column-aliases.md`](select-column-aliases.md) - response shaping with `customName:columnName`, array form, and alias behavior across reads/writes/RPC, including schema-qualified column references
6. [`storage/index.md`](storage/index.md) - experimental `client.storage.*` setup, managed catalog/file workflows, binary proxy reads, error handling, and server OpenAPI storage route coverage
7. [`api-reference.md`](api-reference.md) - exact signatures for the runtime client, `client.request(...)`, `client.chat.*`, builders, helpers, `@xylex-group/athena/utils`, and experimental query tracing
8. [`cli-command-reference.md`](cli-command-reference.md) - CLI commands and troubleshooting
9. [`complete-method-reference.md`](complete-method-reference.md) - exhaustive, generated method-by-method reference with examples

### Track B - Typed model architecture

1. [`typed-schema-registry.md`](typed-schema-registry.md) - model contracts, registry composition, and typed client behavior
2. [`type-surface-manifest.md`](type-surface-manifest.md) - single-page manifest for the new table DSL, helper types, generated Zod schemas, strict query typing, error/operation typing, and docs routing
3. [`type-safety-playbook.md`](type-safety-playbook.md) - migration strategies, anti-patterns, and form/validation alignment
4. [`api-reference.md`](api-reference.md) - utility types and generic contracts

### Track C - Generator and CI

1. [`generator-quickstart.md`](generator-quickstart.md) - zero-config runs, minimal config files, and copy-paste examples
2. [`generator-config.md`](generator-config.md) - provider modes, output templates, naming, and feature flags
3. [`generator-cicd.md`](generator-cicd.md) - deterministic CI expectations for generated artifacts
4. [`generator-codex-handoff-prompt-pack.md`](generator-codex-handoff-prompt-pack.md) - prompt templates for large generator maintenance tasks

### Track D - Athena Auth Client

1. [`auth/index.mdx`](auth/index.mdx) - full grouped auth docs by domain (session, user, admin, api-key, organization, passkey, two-factor, callback, and `useSession`)
2. [`auth/react-email.mdx`](auth/react-email.mdx) - render `@react-email/components` payloads into admin HTML routes
3. [`auth/react-email-api.mdx`](auth/react-email-api.mdx) - helper exports and exact integration API
4. [`auth-client-bindings.md`](auth-client-bindings.md) - compact single-page route map
5. [`auth-session-forwarding.md`](auth-session-forwarding.md) - how auth session and bearer state can be mirrored onto gateway/query requests for server-side auth rollout
6. [`api-reference.md`](api-reference.md) - envelope contracts and exported auth types

## Concept map

```text
Runtime client (createClient / AthenaClient.builder)
  -> Optional typed client (createTypedClient)
    -> Registry contracts (table DSL / defineModel compatibility / defineSchema / defineDatabase / defineRegistry)
      -> Optional generator pipeline (athena-js generate)
        -> Generated model/schema/database/registry files
          -> Runtime query builders + app/domain form surfaces
```

## What changed recently (type-system focus)

- `TableQueryBuilder` now carries `Row`, `Insert`, and `Update` generics end-to-end.
- `findMany({ select, where, orderBy, limit })` is now the canonical eager read surface and compiles object AST input into the existing gateway contract.
- Filter operations (`eq`, `gt`, `order`, etc.) are now keyed to typed row columns when row keys are known.
- Gateway payload contracts now use JSON-safe primitives (`AthenaJsonValue`, `AthenaJsonObject`, `AthenaJsonArray`) instead of broad untyped records.
- Typed registry `fromModel(...)` now forwards `RowOf`, `InsertOf`, and `UpdateOf` into the table builder, preserving write-contract typing.
- `AthenaSdkClientWithAuth` now includes a first-class `chat` module plus the low-level `request(...)` escape hatch for unwrapped routes.
- Admin email-template bindings now treat snake_case as canonical while keeping camelCase request aliases for compatibility.

## Which page to open first

- If your app is mostly string-table runtime calls, schema-qualified base tables, chat routes, or raw service calls through `request(...)`: start at [`getting-started.md`](getting-started.md).
- If your issue is `findMany(...)`, nested relation selection, cross-schema relation reads, route payload shape, or Athena server compatibility: open [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md).
- If your issue is how `select(...)`, `insert(...)`, `upsert(...)`, `update(...)`, `delete(...)`, `rpc(...)`, or `query(...)` normalize into builder state and wire payloads: open [`runtime-method-ast-models.md`](runtime-method-ast-models.md).
- If your issue is response field naming or `customName:columnName` syntax: open [`select-column-aliases.md`](select-column-aliases.md).
- If your issue is Athena-managed storage, upload URLs, proxied file reads, or storage OpenAPI route coverage: open [`storage/index.md`](storage/index.md).
- If your issue is the newer type surface itself - table DSL exports, derived helper types, strict column typing, generated schema metadata, or error/operation typing - start at [`type-surface-manifest.md`](type-surface-manifest.md).
- If your issue is type drift across domains: start at [`type-safety-playbook.md`](type-safety-playbook.md).
- If your issue is generated artifacts or CI determinism: start at [`generator-quickstart.md`](generator-quickstart.md), then [`generator-config.md`](generator-config.md) and [`generator-cicd.md`](generator-cicd.md).
- If your issue is auth endpoint parity and typed auth bindings: start at [`auth/index.mdx`](auth/index.mdx).
- If your issue is getting Athena Auth session or bearer context onto `from(...)`, `rpc(...)`, or `query(...)` requests: start at [`auth-session-forwarding.md`](auth-session-forwarding.md).
- If your issue is exact method signatures: use [`api-reference.md`](api-reference.md).
- If you need a one-stop “every method + example” index: use [`complete-method-reference.md`](complete-method-reference.md).
