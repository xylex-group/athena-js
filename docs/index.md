# Athena JS SDK Documentation

Use this as the first stop before diving into implementation details.

## Reading order

1. [`getting-started.md`](getting-started.md) - SDK setup, query basics, and migration order
2. [`cli-command-reference.md`](cli-command-reference.md) - full `athena-js` command/help/troubleshooting reference
3. [`typed-schema-registry.md`](typed-schema-registry.md) - model contracts, registry structure, tenant context
4. [`generator-config.md`](generator-config.md) - schema introspection and artifact generation
5. [`generator-cicd.md`](generator-cicd.md) - CI/CD pipelines, secret mapping, retries, and branch policy for generated artifacts
6. [`api-reference.md`](api-reference.md) - exhaustive API surface
7. [`generator-codex-handoff-prompt-pack.md`](generator-codex-handoff-prompt-pack.md) - repeatable docs handoff prompts

## Concept flow

```text
Runtime client -> Optional typed client -> Registry contracts -> Generator -> Typed registry source -> Runtime consumption
```

If your team is not ready for typed migrations, stay at step 1 and return to typed docs when schema boundaries stabilize.
