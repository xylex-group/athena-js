# Generator Configuration and Typed Artifact Pipeline

This page is the canonical reference for Athena JS schema generation.

The generator is optional. Existing `createClient(...).from<T>(...)` usage remains valid and supported.

## Quick start

```bash
athena-js generate [--config <path>] [--dry-run]
```

Examples:

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
```

`--dry-run` builds the snapshot and renders artifacts in memory, then prints file paths without writing files.

## Config discovery and loading

When `--config` is not provided, `loadGeneratorConfig()` scans the current working directory in this order:

1. `athena.config.ts`
2. `athena.config.js`
3. `athena-js.config.ts`
4. `athena-js.config.js`
5. `.athena.config.ts`
6. `.athena.config.js`

If none are found, the CLI throws:

- `No generator config found in <cwd>. Expected one of: ...`

Config modules must export either:

- a default config object, or
- a named `config` export

## Minimal config (direct `pg_url` style)

Use any environment variable name you prefer (`PG_URL`, `DATABASE_URL`, etc.).
The actual config key is `provider.connectionString`.

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: process.env.PG_URL!,
    database: "app_db",
    schemas: ["public"],
  },
  output: {
    targets: {
      model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
      schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      database: "src/generated/{database_kebab}/index.ts",
      registry: "src/generated/index.ts",
    },
    placeholderMap: {},
  },
});
```

## Provider modes

### `provider.mode = "direct"` (PostgreSQL socket access)

```ts
provider: {
  kind: "postgres",
  mode: "direct",
  connectionString: process.env.PG_URL!,
  database: "app_db",
  schemas: ["public", "billing"],
}
```

Behavior:

- uses `pg` catalog introspection directly against PostgreSQL
- executes catalog SQL for columns, enums, primary keys, and foreign keys
- derives relation metadata (including many-to-many bridge detection) from FK/PK layout
- defaults to `schemas: ["public"]` when omitted

### `provider.mode = "gateway"` (gateway-only introspection)

```ts
provider: {
  kind: "postgres",
  mode: "gateway",
  gatewayUrl: process.env.ATHENA_URL!,
  apiKey: process.env.ATHENA_API_KEY!,
  database: "app_db",
  schemas: ["public", "billing"],
  backend: "postgresql",
}
```

Behavior:

- sends introspection SQL through Athena `POST /gateway/query`
- runs four catalog query groups: columns, enums, primary keys, foreign keys
- does not require direct database socket/network access from CI runners
- defaults to backend `postgresql` when `backend` is not provided
- does not require `experimental.postgresGatewayIntrospection` to be `true`

### `kind = "scylla"` placeholder contract

```ts
provider: {
  kind: "scylla",
  mode: "direct",
  contactPoints: ["127.0.0.1:9042"],
  keyspace: "app",
  datacenter: "eu-west-1",
}
```

Current behavior:

- accepted by config typing when `experimental.scyllaProviderContracts` is enabled (default: `true`)
- runtime introspection is not implemented yet and throws

## Full config reference

```ts
import type {
  AthenaGeneratorConfig,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorProviderConfig,
} from "@xylex-group/athena";

export interface AthenaGeneratorConfig {
  provider: GeneratorProviderConfig;
  output: GeneratorOutputConfig;
  naming?: Partial<GeneratorNamingConfig>;
  features?: Partial<GeneratorFeatureFlags>;
  experimental?: Partial<GeneratorExperimentalFlags>;
}
```

### `output.targets` defaults

- `model`: `src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts`
- `schema`: `src/generated/{database_kebab}/{schema_kebab}/index.ts`
- `database`: `src/generated/{database_kebab}/index.ts`
- `registry`: `src/generated/index.ts`

### Placeholders

Built-ins:

- `provider`
- `kind`
- `database`, `database_camel`, `database_pascal`, `database_snake`, `database_kebab`
- `schema`, `schema_camel`, `schema_pascal`, `schema_snake`, `schema_kebab`
- `model`, `model_camel`, `model_pascal`, `model_snake`, `model_kebab`

Custom aliases:

- `output.placeholderMap` supports token composition and nested resolution
- recursion depth is internally bounded (8 passes)

Example:

```ts
output: {
  targets: {
    model: "src/{namespace}/{model_kebab}.model.ts",
    schema: "src/{namespace}/index.ts",
    database: "src/generated/{database_kebab}/index.ts",
    registry: "src/generated/index.ts",
  },
  placeholderMap: {
    namespace: "generated/{database_kebab}/{schema_kebab}",
  },
}
```

Unknown tokens fail fast:

- `Unknown placeholder token "<token>" in template "<template>"`

### Naming (`naming`)

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

### Feature flags (`features`)

```ts
interface GeneratorFeatureFlags {
  emitRelations: boolean;
  emitRegistry: boolean;
}
```

Defaults:

- `emitRelations: true`
- `emitRegistry: true`

Use cases:

- set `emitRelations: false` to omit relation metadata from generated model `meta`
- set `emitRegistry: false` to skip top-level registry artifact emission

### Experimental flags (`experimental`)

```ts
interface GeneratorExperimentalFlags {
  postgresGatewayIntrospection: boolean;
  scyllaProviderContracts: boolean;
}
```

Defaults:

- `postgresGatewayIntrospection: false`
- `scyllaProviderContracts: true`

Notes:

- `postgresGatewayIntrospection` is retained for backward-compatible config shape; gateway mode works regardless of this flag
- `scyllaProviderContracts` controls whether Scylla config contracts are allowed

## Generated artifacts

`runSchemaGenerator()` renders and writes these artifact kinds:

1. `model` - per-table interfaces/types plus `defineModel(...)`
2. `schema` - per-schema `defineSchema(...)`
3. `database` - per-database `defineDatabase(...)`
4. `registry` - `defineRegistry(...)` (unless `features.emitRegistry = false`)

The renderer validates path uniqueness and throws on collisions:

- `Generator output collision detected for path: ...`

## Type mapping details (PostgreSQL)

Resolved by `resolvePostgresColumnType(...)`.

- numeric to `number`: `int2`, `int4`, `float4`, `float8`, `smallint`, `integer`, `real`, `double precision`
- high-precision numeric to `string`: `int8`, `bigint`, `serial8`, `bigserial`, `numeric`, `decimal`, `money`
- boolean to `boolean`: `bool`, `boolean`
- binary to `Buffer`: `bytea`
- uuid/textual and scalar textual families to `string`
- json/jsonb to `Record<string, unknown>`
- temporal/network/geometric/bit/xml/full-text/jsonpath families to `string`
- enum kinds to literal unions (for example `'draft' | 'published'`)
- domain/range/multirange kinds to `string`
- composite kinds to `Record<string, unknown>`
- arrays wrap mapped scalar/kind type as `Array<...>` per dimension

## Identifier safety

Generated TypeScript stays valid for unsafe names.

- object/interface property keys are escaped when needed (reserved words, symbols, invalid identifiers)
- generated symbol names (`Row`, `Insert`, `Update`, const names) are normalized to safe identifiers
- reserved identifiers are suffixed safely (for example `_value`)

This allows source columns like `from`, `class`, `order-id`, or `123flag` to emit valid TypeScript keys/symbols.

## Migration: manual typing to generated registry

Existing apps can migrate incrementally.

### Step 1: keep current runtime path

No change required:

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);
const result = await athena.from<{ id: string; email: string }>("public.users").select("id,email");
```

### Step 2: generate typed artifacts

```bash
athena-js generate --config ./athena.config.ts
```

### Step 3: adopt `createTypedClient` where stable

```ts
import { createTypedClient } from "@xylex-group/athena";
import { registry } from "./src/generated/index";

const typed = createTypedClient(
  registry,
  process.env.ATHENA_URL!,
  process.env.ATHENA_API_KEY!,
);

await typed.fromModel("app_db", "public", "users").select("id,email");
```

### Step 4: keep mixed mode where needed

- use `fromModel(...)` for stable relational contracts
- keep `from<T>(...)` and `query(...)` for dynamic tables or ad-hoc SQL

## CI usage

Use `--dry-run` for validation and normal mode for commit-time generation.

### Direct mode CI (runner has DB network access)

```yaml
name: generate-schema-direct
on: [pull_request]
jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec athena-js generate --config ./athena.config.ts --dry-run
        env:
          PG_URL: ${{ secrets.PG_URL }}
```

### Gateway-only CI (no direct DB socket)

```yaml
name: generate-schema-gateway
on: [pull_request]
jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec athena-js generate --config ./athena.config.ts --dry-run
        env:
          ATHENA_URL: ${{ secrets.ATHENA_URL }}
          ATHENA_API_KEY: ${{ secrets.ATHENA_API_KEY }}
```

### Diff gate pattern

After generation in non-dry-run mode, fail if generated files changed unexpectedly:

```bash
pnpm exec athena-js generate --config ./athena.config.ts
git diff --exit-code
```

## Troubleshooting

### 1) Config not discovered

Symptom:

- `No generator config found in ... Expected one of: ...`

Likely cause:

- wrong file name or wrong working directory

How to confirm:

- run from repo root
- list candidates (`athena.config.ts/js`, `athena-js.config.ts/js`, `.athena.config.ts/js`)

Fix:

- rename/move config to a supported filename, or pass `--config <path>`

### 2) Config export shape rejected

Symptom:

- `Generator config file must export a config object as default export or 'config'.`

Likely cause:

- module exports helper functions only, or nested object without default/config

How to confirm:

- open the config file and verify exported value shape

Fix:

- export default `defineGeneratorConfig({...})` or `export const config = {...}`

### 3) Gateway mode fails

Symptom:

- request errors from `/gateway/query`

Likely cause:

- invalid `gatewayUrl`/`apiKey`, wrong backend routing, or gateway endpoint policy mismatch

How to confirm:

- verify endpoint accepts `POST /gateway/query`
- verify configured backend can execute PostgreSQL catalog SQL

Fix:

- correct URL/key/backend values
- confirm gateway allows introspection catalog queries in the target environment

### 4) Empty or partial snapshot

Symptom:

- generated output is missing expected schemas/tables

Likely cause:

- `schemas` filter excludes expected schema, or database permissions are restricted

How to confirm:

- set `schemas` explicitly and compare result
- run introspection in direct mode against same DB user where possible

Fix:

- include required schemas in config and grant catalog-read permissions

### 5) Placeholder token errors

Symptom:

- `Unknown placeholder token "..." in template "..."`

Likely cause:

- typo or unresolved alias chain in `placeholderMap`

How to confirm:

- inspect every `{token}` in `output.targets` and `placeholderMap`

Fix:

- correct token names and keep alias chains resolvable

### 6) Output path collisions

Symptom:

- `Generator output collision detected for path: ...`

Likely cause:

- multiple artifact contexts resolve to the same path template

How to confirm:

- inspect rendered `model`/`schema`/`database`/`registry` target patterns

Fix:

- include schema/model/database disambiguators in target patterns

### 7) Type surprises (`bigint`, `numeric`, nullable keys)

Symptom:

- generated type differs from expected runtime type

Likely cause:

- intentional mapping semantics (`bigint`/`numeric` as `string`, nullable columns as optional + `| null`)

How to confirm:

- inspect generated model file and source column metadata

Fix:

- adapt app-level parsing/coercion where needed; do not assume JS-safe integer conversion for high-precision values

### 8) Reserved or unsafe identifiers

Symptom:

- concern that names like `class`/`from`/`order-id` will break output

Likely cause:

- misunderstanding of safe-key escaping and identifier normalization

How to confirm:

- inspect generated file keys and symbol names

Fix:

- no config change required; this is handled automatically by renderer naming/escaping logic

## Known limitations

1. Scylla provider is a contract placeholder only; runtime introspection is not implemented.
2. Custom SQL introspection templates are not configurable yet; catalog SQL is fixed in the provider layer.
3. `experimental.postgresGatewayIntrospection` is compatibility-only and does not toggle current gateway support.

## Programmatic API surface

You can script generation without CLI by using exported APIs:

- `defineGeneratorConfig`
- `findGeneratorConfigPath`
- `loadGeneratorConfig`
- `normalizeGeneratorConfig`
- `resolveGeneratorProvider`
- `resolvePostgresColumnType`
- `generateArtifactsFromSnapshot`
- `runSchemaGenerator`
