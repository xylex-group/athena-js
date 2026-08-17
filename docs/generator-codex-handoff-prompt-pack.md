# Codex Handoff Prompt Pack: Athena JS Typed Schema Generator

Use this document as a copy/paste prompt starter for another Codex session when you want that session to continue, expand, or rewrite documentation around the generator.

## 1) Prompt: Canonical Handoff

```text
You are documenting the Athena JS typed schema generator. Treat this as a production docs task.

Goals:
1. Keep docs accurate with current implementation.
2. Explain both PostgreSQL introspection modes:
   - direct pg_url (`provider.mode = "direct"`)
   - gateway-only query path (`provider.mode = "gateway"`, using Athena `/gateway/query`)
3. Preserve backward compatibility messaging for existing createClient/from<T> users.
4. Document naming, placeholders, feature flags, and edge cases.
5. Include migration and troubleshooting sections.
6. Keep all examples runnable and consistent with current exports.

Current implementation facts (must reflect):
- Generator config discovery supports:
  athena.config.ts/js, athena-js.config.ts/js, .athena.config.ts/js
- CLI commands are:
  athena-js init [--mode direct|gateway|auto] [--force] [--dry-run] [--no-discover-schemas]
  athena-js generate [--config <path>] [--dry-run] [--no-write-config] [--no-discover-schemas]
- `init` / `ensureGeneratorConfigFile` create modern athena-direct configs and surgically update provider.schemas only when discovery finds new schemas (skip write when unchanged).
- `generate` discovers non-system schemas (direct + gateway), expands the effective schema list, and ensures athena.config.ts by default unless --no-write-config.
- Direct mode uses pg connection string and catalog introspection.
- Gateway mode introspects by executing SQL catalog queries through Athena query endpoint (schema discovery included).
- Output artifacts are model/schema/database/registry.
- Output registry emission can be disabled with features.emitRegistry=false.
- Relation metadata emission can be disabled with features.emitRelations=false.
- Postgres type mapping handles numeric/text/boolean/binary/uuid/json/jsonb/temporal/network/geometric/bit/xml/full-text/enum/domain/range/multirange/composite/arrays.
- Unsafe/reserved identifiers are emitted safely in generated TS property keys.

Deliverables:
- Update docs/generator-config.md as the primary reference.
- Add or update a quickstart section in README linking to generator docs.
- Add a troubleshooting section with concrete failure patterns and fixes.
- Add a migration section for teams moving from manual model typing to generated registry files.
- Add a "CI usage" section with direct and gateway-only examples.
- Keep wording explicit, concise, and implementation-accurate.

Validation requirements:
- No contradictions with actual config keys or exported APIs.
- Every code snippet should be self-consistent.
- Mention known limitations clearly (Scylla contract placeholder, custom SQL deferred).
```

## 2) Prompt: Troubleshooting-Focused Expansion

```text
Expand Athena JS generator troubleshooting docs only.

Required sections:
1. Config discovery failures (file name and location mismatch)
2. Gateway auth/header/backend mismatches
3. Empty snapshot / missing schema results
4. Duplicate output path collisions from placeholder templates
5. Unsafe identifier rendering expectations
6. Type mapping surprises (e.g. bigint as string)

For each section include:
- Symptom
- Likely cause
- How to confirm
- Exact fix

Keep examples aligned with:
- provider.mode direct (pg_url)
- provider.mode gateway (Athena /gateway/query)
```

## 3) Prompt: CI/Automation-Focused Expansion

```text
Write CI/CD documentation for Athena JS generator.

Requirements:
- Include two pipeline patterns:
  1) direct pg_url introspection
  2) gateway-only introspection via Athena query endpoint
- Include secure secret mapping examples.
- Include dry-run verification step.
- Include artifact diff strategy for PR checks.
- Include failure handling strategy and retry guidance.
- Include branch policy advice for generated files.

Keep it implementation-accurate and avoid introducing non-existent CLI flags.
```

## 4) Implementation Snapshot (for Docs Accuracy)

Use these behavior facts when drafting docs:

- `defineGeneratorConfig(...)` is a typed identity helper.
- `loadGeneratorConfig(...)` loads and normalizes defaults.
- `resolveGeneratorProvider(...)` supports:
  - `postgres/direct` (implemented)
  - `postgres/gateway` (implemented using Athena query path)
  - `scylla/direct` (contract placeholder)
- `runSchemaGenerator(...)` is the end-to-end pipeline.
- `generateArtifactsFromSnapshot(...)` produces in-memory files that are written by the pipeline unless `dryRun`.

## 5) Test Evidence You Can Reference in Docs

Generator-focused test coverage exists for:

- direct `pg_url` provider resolution and introspection
- gateway-only provider resolution and `/gateway/query` transport
- pipeline write output in both direct and gateway modes
- config loading and typed helper behavior
- renderer path placeholder and feature toggle behavior
- postgres datatype mapping breadth

## 6) Suggested Output Tone

Use strict engineering documentation tone:

- concrete
- command-first
- no marketing language
- include caveats and limitations up front where relevant

## 7) Files to Prioritize

- `docs/generator-config.md`
- `README.md` (generator section)
- optional: additional docs pages if your team splits references by audience

## 8) Done Criteria for the Next Session

- Docs clearly explain when to use direct vs gateway mode.
- All sample config blocks match real keys and accepted values.
- Troubleshooting section maps to actual runtime behavior.
- CI examples are realistic and secure.
- No mention of features that do not exist yet.
