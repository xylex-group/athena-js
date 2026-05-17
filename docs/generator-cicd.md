# Athena JS Generator CI/CD Guide

This guide is for teams running the Athena JS typed schema generator in CI/CD.

All commands in this document use the current CLI surface only:

```bash
athena-js generate [--config <path>] [--dry-run]
```

## Preconditions

1. Node and package manager are available in CI.
2. Generator config exists and is loadable (`athena.config.ts/js`, `athena-js.config.ts/js`, or `.athena.config.ts/js`, or pass `--config`).
3. CI has access to required secrets for the selected provider mode.

## Pipeline pattern 1: direct `pg_url` introspection

Use this when CI runners can connect directly to PostgreSQL.

Config shape (excerpt):

```ts
export default {
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: process.env.PG_URL!,
    database: "app_db",
    schemas: ["public"],
  },
  output: {
    targets: {
      model: "athena/models/{model_kebab}.ts",
      schema: "athena/schema.ts",
      database: "athena/relations.ts",
      registry: "athena/config.ts",
    },
    placeholderMap: {},
  },
};
```

GitHub Actions example:

```yaml
name: generator-direct
on:
  pull_request:
    branches: [main]

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile

      # dry-run verification (no files written)
      - name: Verify generator (dry-run)
        env:
          PG_URL: ${{ secrets.GENERATOR_PG_URL }}
        run: pnpm exec athena-js generate --config ./athena.config.ts --dry-run

      # optional write + diff gate for PRs that include generated artifacts
      - name: Enforce generated artifacts are committed
        env:
          PG_URL: ${{ secrets.GENERATOR_PG_URL }}
        run: |
          pnpm exec athena-js generate --config ./athena.config.ts
          git diff --exit-code
```

## Pipeline pattern 2: gateway-only introspection via Athena `/gateway/query`

Use this when CI cannot open direct PostgreSQL sockets.

Config shape (excerpt):

```ts
export default {
  provider: {
    kind: "postgres",
    mode: "gateway",
    gatewayUrl: process.env.ATHENA_URL!,
    apiKey: process.env.ATHENA_API_KEY!,
    database: "app_db",
    schemas: ["public"],
    backend: "postgresql",
  },
  output: {
    targets: {
      model: "athena/models/{model_kebab}.ts",
      schema: "athena/schema.ts",
      database: "athena/relations.ts",
      registry: "athena/config.ts",
    },
    placeholderMap: {},
  },
};
```

GitHub Actions example:

```yaml
name: generator-gateway
on:
  pull_request:
    branches: [main]

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile

      # dry-run verification (no files written)
      - name: Verify generator (dry-run)
        env:
          ATHENA_URL: ${{ secrets.ATHENA_GENERATOR_URL }}
          ATHENA_API_KEY: ${{ secrets.ATHENA_GENERATOR_API_KEY }}
        run: pnpm exec athena-js generate --config ./athena.config.ts --dry-run

      # optional write + diff gate for PRs that include generated artifacts
      - name: Enforce generated artifacts are committed
        env:
          ATHENA_URL: ${{ secrets.ATHENA_GENERATOR_URL }}
          ATHENA_API_KEY: ${{ secrets.ATHENA_GENERATOR_API_KEY }}
        run: |
          pnpm exec athena-js generate --config ./athena.config.ts
          git diff --exit-code
```

## Secure secret mapping examples

Use scoped CI secrets, not inline values.

Direct mode mapping example:

- `secrets.GENERATOR_PG_URL` -> `PG_URL`

Gateway mode mapping example:

- `secrets.ATHENA_GENERATOR_URL` -> `ATHENA_URL`
- `secrets.ATHENA_GENERATOR_API_KEY` -> `ATHENA_API_KEY`

Security guidance:

1. Use environment-scoped secrets for production branches.
2. Use least-privilege DB/API credentials limited to schema introspection.
3. Never print secret values in logs.
4. Do not hardcode URLs or keys in `athena.config.*`.

## Dry-run verification strategy

`--dry-run` should be the first gate in PR CI:

```bash
pnpm exec athena-js generate --config ./athena.config.ts --dry-run
```

This validates:

- config discovery/loading
- provider connectivity/auth
- snapshot read
- template rendering
- output-path collision detection

without writing files.

## Artifact diff strategy for PR checks

If generated files are committed to the repo, enforce deterministic output:

```bash
pnpm exec athena-js generate --config ./athena.config.ts
git diff --exit-code
```

Recommended PR failure message:

- `Generated artifacts are out of date. Run 'athena-js generate --config ./athena.config.ts' and commit the result.`

## Failure handling and retry guidance

Treat failures in two categories.

Deterministic failures (do not retry):

- config discovery errors (`No generator config found ...`)
- bad config export shape
- placeholder/path collisions

Transient failures (safe to retry with backoff):

- gateway/network transport failures
- temporary 5xx/timeout conditions

Example retry wrapper for gateway dry-run:

```bash
#!/usr/bin/env bash
set -euo pipefail

for attempt in 1 2 3; do
  if pnpm exec athena-js generate --config ./athena.config.ts --dry-run; then
    exit 0
  fi

  # deterministic failures should fail immediately
  if [[ $attempt -eq 1 ]]; then
    # If your CI captures stderr, pattern-match known deterministic messages here.
    # Keep this conservative to avoid masking real config problems.
    :
  fi

  if [[ $attempt -lt 3 ]]; then
    sleep $((attempt * 5))
  fi
done

exit 1
```

Operational guidance:

1. Keep retries low (2-3 attempts max).
2. Apply retries to dry-run verification, not to every subsequent step.
3. Alert after final failure with captured logs.

## Branch policy advice for generated files

Pick one policy and enforce it consistently.

Policy A (recommended for typed contract repos): commit generated files.

1. PR CI runs dry-run first.
2. PR CI runs full generate + diff gate.
3. Protected branches reject PRs with stale generated output.

Policy B: do not commit generated files.

1. PR CI runs dry-run only.
2. Release/build pipeline runs full generation before packaging.
3. Runtime/build must not rely on missing committed generated artifacts.

If you choose Policy A, prefer a dedicated update branch pattern for bulk refreshes:

- `schema-sync/<date-or-ticket>`

This keeps generated-only changes easy to review and isolate.

## Minimal CI checklist

1. Run `athena-js generate --config ... --dry-run`.
2. Use scoped secrets per environment.
3. Retry transient gateway failures with short backoff.
4. Enforce deterministic diff behavior if generated files are committed.
5. Keep branch policy explicit and documented.

