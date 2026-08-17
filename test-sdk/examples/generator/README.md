# Generator Full Utilization Examples

This folder demonstrates full usage of Athena JS typed schema generator features inside `test-sdk`.

## Covered Features

- Direct PostgreSQL mode (`provider.mode = "direct"`, `connectionString` / `pg_url`)
- Gateway-only PostgreSQL mode (`provider.mode = "gateway"`, Athena `/gateway/query`)
- Config discovery and loading (`athena.config.ts`)
- Config normalization and defaulting
- Multi-schema sync for app data plus Athena-owned schemas
- Dry-run generation vs file-writing generation
- Placeholder and naming strategy behavior
- Feature flags (`emitRelations`, `emitRegistry`)
- Programmatic artifact rendering from snapshots
- Postgres datatype mapping (`resolvePostgresColumnType`)

## Main Example Module

- `full-utilization.ts`

Exported helpers include:

- `createDirectGeneratorConfig(...)`
- `createGatewayOnlyGeneratorConfig(...)`
- `createFullFeatureSnapshot()`
- `writeGeneratorConfigFile(...)`
- `loadResolvedExampleConfig(...)`
- `runGeneratorDryRunWithSnapshot(...)`
- `runGeneratorWriteWithSnapshot(...)`
- `renderArtifactsFromExampleSnapshot(...)`
- `runDirectProviderInspect(...)`
- `runGatewayProviderInspect(...)`
- `collectTypeMappingShowcase()`

## Validation

These examples are exercised by:

- `test-sdk/test/generator-full-utilization.e2e.test.ts`
- `test-sdk/test/generator-feature-matrix.e2e.test.ts`

Run from `test-sdk`:

```bash
pnpm test:e2e
```
