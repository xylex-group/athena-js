# Generator configuration and typed artifact pipeline

This page documents how to generate typed schema contracts from PostgreSQL and where the generated files go.

If you want the fastest copy-paste path first, start with [`generator-quickstart.md`](generator-quickstart.md).

For this to work end-to-end, three things must line up:

1. discoverable config file
2. valid provider mode
3. output path/naming settings

## CLI entrypoint

`athena-js` exposes generator commands:

```bash
athena-js init
athena-js init --mode gateway --dry-run
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --no-write-config
athena-js generate --no-discover-schemas
athena-js generate --help
athena-js help generate
athena-js help init
```

Output:

- `init`: creates or surgically updates `athena.config.ts` (schemas auto-fill; no rewrite when current)
- `generate` (normal): discovers schemas, ensures config, introspects, writes model/registry targets
- `generate --dry-run`: same pipeline without disk writes; prints format/targets/`[config]` lines and handwritten-seam warnings

For the full command matrix and troubleshooting, see
[`cli-command-reference.md`](cli-command-reference.md).

## Config discovery

`loadGeneratorConfig()` discovers the first file in this order when `--config` is not passed:

- `athena.config.ts`
- `athena.config.js`
- `athena-js.config.ts`
- `athena-js.config.js`
- `.athena.config.ts`
- `.athena.config.js`

### Intelligent create / update

`ensureGeneratorConfigFile()` (also used by `athena-js init` and by default during `athena-js generate`) keeps `athena.config.ts` healthy without destructive rewrites:

| Situation | Behavior |
|-----------|----------|
| Config missing | Write modern `athena-direct` + `table-builder` template with `generatorEnv` for secrets |
| Config exists, schemas already match | **No write** (unchanged — safe for typecheck/CI) |
| Config exists, discovery finds extra schemas | Surgical patch of `provider.schemas` only |
| Custom output/naming/features | Preserved — never full-rewritten unless `--force` |
| Gateway mode | Same surface as direct: `generatorEnv("ATHENA_URL")` + `generatorEnv("ATHENA_API_KEY")` |

Schema discovery lists non-system PostgreSQL schemas that contain tables, via direct `pg` or gateway `/gateway/query`. Configured schemas are never removed; new ones are appended.

Programmatic API:

```ts
import {
  ensureGeneratorConfigFile,
  renderGeneratorConfigFile,
  discoverPostgresSchemas,
} from "@xylex-group/athena";

await ensureGeneratorConfigFile({
  mode: "gateway", // or "direct" | "auto"
  discoverSchemas: true,
  dryRun: false,
  force: false,
});
```

CLI:

```bash
athena-js init
athena-js init --mode gateway --dry-run
athena-js generate              # discover schemas + ensure config by default
athena-js generate --no-write-config
```

If no config file exists, the generator now falls back to environment defaults:

- direct mode when `DATABASE_URL` / `PG_URL` / `POSTGRES_URL` is present
- gateway mode when `ATHENA_URL` and `ATHENA_API_KEY` are present
- default output targets under `athena/*`
- default schema selection of `public`

When neither a config file nor a usable env-only provider can be found, CLI throws:

- `No generator config found in <cwd>. Expected one of: ...`

Use `--config` with a relative or absolute path to avoid this in monorepos.

## Config surface at a glance

```ts
export interface AthenaGeneratorConfig {
  provider: GeneratorProviderInputConfig
  output?: GeneratorOutputConfig
  naming?: Partial<GeneratorNamingConfig>
  filter?: GeneratorFilterConfig
  features?: Partial<GeneratorFeatureFlags>
  experimental?: Partial<GeneratorExperimentalFlags>
}
```

All nested sections are validated by normal TypeScript shape and then normalized with defaults.

That means:

- `output` can be omitted entirely
- direct-mode configs can omit `connectionString` when env fallback keys are already present
- gateway-mode configs can omit `gatewayUrl` / `apiKey` / `database` when the corresponding env fallback keys are already present

### `defineAthenaConfig` helper

Use this helper to keep autocompletion and exactness in config files.
For env-backed values, pair it with `generatorEnv(...)` so config files stay typed
without manual `process.env`, non-null assertions, string splits, or boolean parsing.

`defineGeneratorConfig` remains a deprecated alias of `defineAthenaConfig` until **5.0** (AD-003).

Smallest direct-mode config:

```ts
import { defineAthenaConfig } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
});
```

Smallest gateway-mode config:

```ts
import { defineAthenaConfig } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
  },
});
```

Both examples rely on the documented env fallback keys below.

```ts
import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "app_db" }),
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
      default: ["public", "athena"],
    }),
  },
  output: {
    format: generatorEnv.oneOf(
      "ATHENA_GENERATOR_OUTPUT_FORMAT",
      ["define-model", "table-builder"] as const,
      { default: "table-builder" },
    ),
    preset: generatorEnv.oneOf(
      "ATHENA_GENERATOR_OUTPUT_PRESET",
      ["legacy", "athena-direct"] as const,
      { default: "athena-direct" },
    ),
    targets: {
      model: generatorEnv("ATHENA_GENERATOR_MODEL_TARGET", {
        default: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      }),
      schema: generatorEnv("ATHENA_GENERATOR_SCHEMA_TARGET", {
        default: "athena/schemas/{schema_kebab}.ts",
      }),
      database: generatorEnv("ATHENA_GENERATOR_DATABASE_TARGET", {
        default: "athena/relations.ts",
      }),
      registry: generatorEnv("ATHENA_GENERATOR_REGISTRY_TARGET", {
        default: "src/lib/athena/generated/registry.ts",
      }),
    },
    placeholderMap: generatorEnv.json("ATHENA_GENERATOR_PLACEHOLDER_MAP", {
      default: {},
    }),
  },
  filter: {
    includeTables: generatorEnv.list("ATHENA_GENERATOR_TABLES", { optional: true }),
    excludeTables: generatorEnv.list("ATHENA_GENERATOR_EXCLUDE_TABLES", { optional: true }),
  },
  naming: {
    modelType: generatorEnv.oneOf(
      "ATHENA_GENERATOR_MODEL_TYPE",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "pascal" },
    ),
  },
  features: {
    emitRelations: generatorEnv.boolean("ATHENA_GENERATOR_EMIT_RELATIONS", {
      default: true,
    }),
  },
});
```

### Env file loading

`loadGeneratorConfig()` loads project env files before evaluating `athena.config.*`.

Load order:

- `.env`
- `.env.local`
- `.env.<NODE_ENV>`
- `.env.<NODE_ENV>.local`

Existing shell env vars win. Project env files only fill missing keys.

That means both of these work:

- `connectionString: process.env.DATABASE_URL!`
- `connectionString: generatorEnv("DATABASE_URL")`

`generatorEnv(...)` is preferred for generator config because it preserves the
expected field type instead of widening everything to `string | undefined`.

### `generatorEnv(...)` helpers

Use the helper that matches the field type you are filling:

- `generatorEnv("KEY")` for required strings such as `connectionString`
- `generatorEnv("KEY", { default: "value" })` for string defaults
- `generatorEnv.list("KEY", { default: ["public", "athena"] })` for comma-separated string arrays
- `generatorEnv.boolean("KEY", { default: true })` for feature and experimental flags
- `generatorEnv.oneOf("KEY", ["camel", "pascal"] as const, { default: "pascal" })` for string unions such as naming styles
- `generatorEnv.json("KEY", { default: {} })` for object fields such as `output.placeholderMap`

Examples:

```ts
import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
    gatewayUrl: generatorEnv("ATHENA_URL"),
    apiKey: generatorEnv("ATHENA_API_KEY"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "app_db" }),
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
      default: ["public", "athena"],
    }),
    backend: generatorEnv.oneOf("ATHENA_GENERATOR_BACKEND", ["athena", "postgresql"] as const, {
      default: "athena",
    }),
  },
  output: {
    format: generatorEnv.oneOf(
      "ATHENA_GENERATOR_OUTPUT_FORMAT",
      ["define-model", "table-builder"] as const,
      { default: "table-builder" },
    ),
    preset: generatorEnv.oneOf(
      "ATHENA_GENERATOR_OUTPUT_PRESET",
      ["legacy", "athena-direct"] as const,
      { default: "athena-direct" },
    ),
    targets: {
      model: generatorEnv("ATHENA_GENERATOR_MODEL_TARGET", {
        default: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      }),
      schema: "athena/schemas/{schema_kebab}.ts",
      database: "athena/relations.ts",
      registry: "src/lib/athena/generated/registry.ts",
    },
    placeholderMap: generatorEnv.json("ATHENA_GENERATOR_PLACEHOLDER_MAP", {
      default: { namespace: "{database_kebab}/{schema_kebab}" },
    }),
  },
  features: {
    emitRegistry: generatorEnv.boolean("ATHENA_GENERATOR_EMIT_REGISTRY", {
      default: true,
    }),
  },
  filter: {
    includeTables: generatorEnv.list("ATHENA_GENERATOR_TABLES", { optional: true }),
    excludeTables: generatorEnv.list("ATHENA_GENERATOR_EXCLUDE_TABLES", { optional: true }),
  },
});
```

If you want a field to remain optional, pass `{ optional: true }`.

## Provider modes

`provider` is one of two implemented PostgreSQL modes and one scaffolded future-mode contract.

### Postgres direct mode

```ts
{
  kind: "postgres",
  mode: "direct",
  connectionString: "postgres://user:pass@host:5432/db",
  database: "app_db",
  schemas: ["public", "athena"],
}
```

Behavior:

- uses Node Postgres (`pg`) catalog queries
- includes primary keys, nullability, enums, and relations via direct SQL
- useful for local dev and CI jobs with direct DB access

Built-in fallback env keys for direct mode:

- `provider.connectionString`: `ATHENA_GENERATOR_PG_URL`, `DATABASE_URL`, `PG_URL`, `POSTGRES_URL`, `POSTGRESQL_URL`
- `provider.database`: `ATHENA_GENERATOR_DB`, `ATHENA_DATABASE`, `PGDATABASE`
- password backfill for passwordless URLs: `ATHENA_GENERATOR_PG_PASSWORD`, `PGPASSWORD`

Example: if `connectionString` is `postgresql://postgres@127.0.0.1:5432/app_db`
and `PGPASSWORD` is set, the loader injects that password into the final URL.

### Postgres gateway mode

```ts
{
  kind: "postgres",
  mode: "gateway",
  gatewayUrl: "https://athena.example.com",
  apiKey: process.env.ATHENA_API_KEY!,
  database: "app_db",
  schemas: ["public", "athena"],
  backend: "athena",
}
```

Behavior:

- executes catalog introspection over `POST /gateway/query`
- runs four SQL statements through Athena query path:
  - columns
  - enums
  - primary keys
  - foreign keys
- this mode is available without the experimental flag and can be used in restricted networks where DB socket access is blocked

Built-in fallback env keys for gateway mode:

- `provider.gatewayUrl`: `ATHENA_URL`, `ATHENA_GATEWAY_URL`, `ATHENA_GENERATOR_URL`
- `provider.apiKey`: `ATHENA_API_KEY`, `ATHENA_GATEWAY_API_KEY`, `ATHENA_GENERATOR_API_KEY`
- `provider.database`: `ATHENA_GENERATOR_DB`, `ATHENA_DATABASE`, `PGDATABASE`

### Scylla mode (contract placeholder)

```ts
{
  kind: "scylla",
  mode: "direct",
  contactPoints: ["127.0.0.1:9042"],
  keyspace: "app",
  datacenter: "eu-west-1",
}
```

Current behavior:

- intentionally throws `Scylla introspection provider is not implemented yet`
- controlled by `experimental.scyllaProviderContracts` (defaults to `true`), so this config is accepted but generation will fail until implemented

## Output contract

```ts
interface GeneratorOutputConfig {
  format?: "define-model" | "table-builder";
  preset?: "legacy" | "athena-direct";
  targets?: Partial<GeneratorOutputTargets>;
  placeholderMap?: Record<string, string>;
}

interface GeneratorOutputTargets {
  model: string;
  schema: string;
  database: string;
  registry: string;
}
```

### Defaults

- `format`: `"table-builder"`
- `preset`: `"athena-direct"`
- `model`: `src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts`
- `schema`: `athena/schemas/{schema_kebab}.ts`
- `database`: `athena/relations.ts`
- `registry`: `src/lib/athena/generated/registry.ts`

The defaults include the schema name in model and schema paths so `public.users`
and `athena.users` can be generated in the same run without path collisions.

Important:

- the safe direct preset is now the default
- opt into `output.preset = "legacy"` only when you intentionally want registry output on `athena/config.ts`
- current CLI dry-runs warn when registry output still points at `athena/config.ts`

### `output.preset`

Use `output.preset` to start from a known target layout before applying any
explicit `output.targets` overrides:

- `"legacy"`: compatibility mode that keeps registry output on `athena/config.ts`
- `"athena-direct"`: default safe direct layout that keeps models and schema assemblies in `athena/*` and writes registry output to `src/lib/athena/generated/registry.ts`

Recommended safe direct layout:

```ts
output: {
  preset: "athena-direct",
  format: "table-builder",
}
```

That resolves to:

- `src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts`
- `athena/schemas/{schema_kebab}.ts`
- `athena/relations.ts`
- `src/lib/athena/generated/registry.ts`

If you want flat `athena/models/*.ts` output, override `output.targets.model`
to `athena/models/{model_kebab}.ts` (or set
`ATHENA_GENERATOR_MODEL_TARGET=athena/models/{model_kebab}.ts`). When
multiple schemas still collide on the same table name, the renderer auto-scopes
the conflicting files back under schema folders.

### `output.format`

Use `output.format` to choose the model artifact style:

- `"define-model"`: emits legacy deprecated `defineModel<...>` files
- `"table-builder"`: emits Zero-style `table(...).columns(...).primaryKey(...)` files with exported Zod schemas

`"table-builder"` is now the default and is stable generator output. It does not require an
experimental flag. The runtime-only client flag `experimental.findManyAst`
controls `findMany(...)` transport behavior and is unrelated to generated model
artifacts.

Example:

```ts
output: {
  format: "table-builder",
  targets: {
    model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
    schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
    database: "src/generated/{database_kebab}/index.ts",
    registry: "src/generated/index.ts",
  },
}
```

Regardless of output format, the generated registry file now exports
`__athena_schema_meta` with internal metadata such as `schemaVersion`,
`generatedAt`, `database`, and `outputFormat`. This is intended for tooling and
debugging rather than normal application code.

### Table filters

Use `filter.includeTables` and `filter.excludeTables` to keep the generated
surface small when a schema is much larger than the subset your app actually
uses.

```ts
filter: {
  includeTables: ["users", "public.notifications"],
  excludeTables: ["public.audit_logs"],
}
```

Rules:

- values can be arrays or comma-separated strings
- bare names like `"users"` match that table name in any selected schema
- schema-qualified values like `"public.users"` target one exact table
- `includeTables` runs first, then `excludeTables`
- generation fails fast if the filter removes every table

Env equivalents:

- `ATHENA_GENERATOR_TABLES`
- `ATHENA_GENERATOR_EXCLUDE_TABLES`

### Schema selection

PostgreSQL providers accept `schemas` as either an array or a comma-separated string:

```ts
schemas: ["public", "athena"]
// or
schemas: process.env.ATHENA_GENERATOR_SCHEMAS ?? "public,athena"
// or
schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
  default: ["public", "athena"],
})
```

The generator trims whitespace, removes duplicates, and falls back to `["public"]`
when the selection is missing or empty.

### Supported placeholders

The renderer resolves the following built-ins:

- `provider`
- `kind`
- `database`, `database_camel`, `database_pascal`, `database_snake`, `database_kebab`
- `schema`, `schema_camel`, `schema_pascal`, `schema_snake`, `schema_kebab`
- `model`, `model_camel`, `model_pascal`, `model_snake`, `model_kebab`

`kind` is always set to the artifact category in the generator runtime (`model`, `schema`, `database`, `registry`).

### `placeholderMap`

You can add custom tokens that may reference built-ins and each other, up to an internal recursion depth of 8.

```ts
output: {
  targets: {
    model: "src/{namespace}/{schema_snake}/{model_snake}.ts",
  },
  placeholderMap: {
    namespace: "{database_kebab}/{schema_kebab}",
  },
}
```

If a template references an unknown token, generation fails with:

- `Unknown placeholder token "<token>" in template "<template>"`

### Naming controls

```ts
interface GeneratorNamingConfig {
  modelType: "preserve" | "camel" | "pascal" | "snake" | "kebab";
  modelConst: "preserve" | "camel" | "pascal" | "snake" | "kebab";
  schemaConst: "preserve" | "camel" | "pascal" | "snake" | "kebab";
  databaseConst: "preserve" | "camel" | "pascal" | "snake" | "kebab";
  registryConst: "preserve" | "camel" | "pascal" | "snake" | "kebab";
}
```

Defaults:

- `modelType: "pascal"`
- `modelConst: "camel"`
- `schemaConst: "camel"`
- `databaseConst: "camel"`
- `registryConst: "camel"`

### Feature flags

```ts
interface GeneratorFeatureFlags {
  emitRelations: boolean;
  emitRegistry: boolean;
}
```

Defaults:

- `emitRelations: true`
- `emitRegistry: true`

Disable registry emission in constrained workflows:

```ts
features: {
  emitRegistry: false,
},
```

### Experimental flags

```ts
interface GeneratorExperimentalFlags {
  postgresGatewayIntrospection: boolean;
  scyllaProviderContracts: boolean;
}
```

Defaults:

- `postgresGatewayIntrospection: false`
- `scyllaProviderContracts: true`

`postgresGatewayIntrospection` is currently retained for compatibility and does not gate supported behavior.

`scyllaProviderContracts` controls whether the Scylla config shape is allowed.

## What generation emits

`runSchemaGenerator()` produces:

- normalized snapshot from the provider
- generated artifacts in memory
- written paths (when `--dry-run` is not set)
- write details for created / merged / overwritten artifacts
- skipped paths for already-current, conflicted, unparseable, or policy-protected database/registry artifacts

Artifact types:

- `model`: table-builder contracts by default, or legacy row/interfaces + deprecated `defineModel` when `output.format = "define-model"`
- `schema`: `defineSchema` object
- `database`: `defineDatabase` object
- `registry`: `defineRegistry` object (`features.emitRegistry` must be true)

The generator deduplicates output paths and throws if two artifacts collide.

### Database / registry write policy (`output.artifactWrite`)

Models and schemas are always rewritten. Existing `database` and `registry`
files use a smart write policy:

| Policy | Behavior |
| --- | --- |
| `"merge"` (default) | Additive merge: append missing imports and `defineDatabase` / `defineRegistry` keys, preserve custom exports/keys, report non-generated units, skip write when already current |
| `"skip"` | Legacy protect-and-skip (never rewrite existing files) |
| `"overwrite"` | Always replace with pure generated content |

```ts
output: {
  artifactWrite: {
    database: "merge", // or "skip" | "overwrite"
    registry: "merge",
  },
}
```

Merge is **additive only** (it never deletes existing schema keys or imports).
If a key already maps to a different identifier, or the file cannot be parsed as
a generator-shaped artifact, the file is left unchanged and the CLI prints a
`[skip]` reason (`merge-conflict`, `merge-unparseable`, or `merge-lint-failed`).
Successful merges print `[merge]`; unchanged files print `[ok] … (already current)`.

## Config examples by profile

### Local development (direct DB)

```ts
import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "app_db" }),
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
      default: ["public", "athena"],
    }),
  },
  output: {
    preset: "athena-direct",
    targets: {
      model: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      schema: "athena/schemas/{schema_kebab}.ts",
      database: "athena/relations.ts",
      registry: "src/lib/athena/generated/registry.ts",
    },
    placeholderMap: generatorEnv.json("ATHENA_GENERATOR_PLACEHOLDER_MAP", {
      default: {
        namespace: "{database_kebab}/{schema_kebab}",
      },
    }),
  },
  filter: {
    includeTables: generatorEnv.list("ATHENA_GENERATOR_TABLES", { optional: true }),
  },
  naming: {
    modelType: generatorEnv.oneOf(
      "ATHENA_GENERATOR_MODEL_TYPE",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "pascal" },
    ),
    modelConst: generatorEnv.oneOf(
      "ATHENA_GENERATOR_MODEL_CONST",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "camel" },
    ),
    schemaConst: generatorEnv.oneOf(
      "ATHENA_GENERATOR_SCHEMA_CONST",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "snake" },
    ),
  },
});
```

### Gateway-only environment

```ts
import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
    gatewayUrl: generatorEnv("ATHENA_URL"),
    apiKey: generatorEnv("ATHENA_API_KEY"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "app_db" }),
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
      default: ["public", "athena"],
    }),
    backend: "athena",
  },
  output: {
    preset: "athena-direct",
    targets: {
      model: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      schema: "athena/schemas/{schema_kebab}.ts",
      database: "athena/relations.ts",
      registry: "src/lib/athena/generated/registry.ts",
    },
    placeholderMap: {},
  },
});
```

## Troubleshooting

### Config is not found

Symptom:

- `No generator config found in ... Expected one of: ...`

Fix:

- move config to repo root
- run with `--config ./path/to/config` from the expected cwd

### Unknown placeholder token

Symptom:

- `Unknown placeholder token "<token>" in template "..."`

Fix:

- check built-ins and custom entries in `placeholderMap`
- ensure no typos in token names
- avoid cyclic token references; resolution is bounded but should still fail fast if unresolved

### Generated path collision

Symptom:

- `Generator output collision detected for path: ...`

Fix:

- inspect `output.targets` and `placeholderMap`
- ensure each artifact maps to a unique path
- for multi-schema syncs, include `{schema}` or `{schema_kebab}` in `model` and `schema` targets

### Scylla config crashes

Symptom:

- `Scylla provider contracts are disabled...` or `not implemented`

Fix:

- enable placeholder contracts only if intended by setting
  `experimental.scyllaProviderContracts: true`, and be ready to implement provider logic first

### Gateway mode fails intermittently

Symptom:

- failed fetch calls to `/gateway/query`

Fix:

- verify `gatewayUrl` and `apiKey`
- verify the gateway endpoint accepts `POST /gateway/query`
- run with verbose CLI logs around request payloads and inspect SQL text in `error` payload

## Pipeline integration tips

Use dry-run first in CI:

```bash
athena-js generate --config ./athena.config.ts --dry-run
```

Useful checks:

1. verify no `Unknown placeholder token`
2. verify file count/paths are stable
3. optionally diff generated output against repo baseline

A safe commit workflow:

1. run `--dry-run` for PR check
2. run `generate`
3. review generated files only
4. keep generated artifacts deterministic across reruns

## Programmatic API usage

The full config and pipeline APIs are also exposed from JS/TS:

| API | Role |
| --- | --- |
| `defineAthenaConfig` | Typed identity helper for config files |
| `generatorEnv` | Typed env readers for strings, lists, booleans, oneOf, JSON |
| `loadGeneratorConfig` / `findGeneratorConfigPath` / `normalizeGeneratorConfig` | Load and normalize `athena.config.*` |
| `renderGeneratorConfigFile` | Render a modern config TypeScript source string |
| `ensureGeneratorConfigFile` | Intelligent create/update (surgical schema patch) |
| `detectGeneratorProviderMode` | Prefer direct vs gateway from env |
| `discoverPostgresSchemas` | List non-system schemas with tables (direct + gateway) |
| `mergeSchemaSelections` / `schemasEqual` / `normalizeDiscoveredSchemas` | Schema list helpers |
| `patchSchemasInConfigSource` | Surgical text update of `provider.schemas` |
| `resolveGeneratorProvider` | Build introspection provider from config |
| `generateArtifactsFromSnapshot` | Snapshot → artifact files |
| `runSchemaGenerator` | End-to-end: load → discover → ensure config → introspect → write |
| `resolvePostgresColumnType` | Column type mapping helper |

### `runSchemaGenerator` options

```ts
await runSchemaGenerator({
  cwd: process.cwd(),
  configPath: "./athena.config.ts", // optional
  dryRun: false,
  writeConfig: true,       // default true — set false for locked-config CI
  discoverSchemas: true,   // default true — set false to honor only configured list
  // provider: customSchemaIntrospectionProvider, // skips live discovery + config ensure
});
```

Result includes optional `configEnsure`:

```ts
{
  action: "created" | "updated" | "unchanged" | "skipped",
  path: "athena.config.ts",
  schemas: ["public", "athena"],
  changes: string[],
  reason?: string,
}
```

### `ensureGeneratorConfigFile` options

```ts
await ensureGeneratorConfigFile({
  cwd: process.cwd(),
  configPath: "./athena.config.ts",
  mode: "auto", // "direct" | "gateway" | "auto"
  discoverSchemas: true,
  dryRun: false,
  force: false, // full rewrite only when true
  schemas: ["public", "billing"], // optional explicit list
});
```

Use these to build custom scripts, schema verification steps, or local snapshot tests.

## Migrations config

Optional tooling block (does not affect runtime clients):

```ts
export default defineAthenaConfig({
  provider: { /* ... */ },
  migrations: {
    directory: "./athena/migrations", // default when omitted
  },
});
```

See [migrations.md](migrations.md).

