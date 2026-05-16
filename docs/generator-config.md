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

## Implementation snapshot (code-backed behavior)

Use this section as the source-of-truth summary for generator runtime behavior.

- `defineGeneratorConfig(...)` is a typed identity helper for config authoring.
- `loadGeneratorConfig(...)` discovers config files, loads module exports, and normalizes defaults.
- `resolveGeneratorProvider(...)` supports:
  - `postgres/direct` (implemented)
  - `postgres/gateway` (implemented through Athena `POST /gateway/query`)
  - `scylla/direct` (contract placeholder; runtime introspection not implemented)
- `runSchemaGenerator(...)` is the end-to-end pipeline: load config, resolve provider, introspect, render artifacts, and optionally write files.
- `generateArtifactsFromSnapshot(...)` produces in-memory artifacts; `runSchemaGenerator(...)` writes those files unless `dryRun` is enabled.

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

For complete CI/CD patterns (direct `pg_url`, gateway-only `/gateway/query`, secure secret mapping, retry guidance, and branch policy), see [`generator-cicd.md`](./generator-cicd.md).

## Troubleshooting

### 1) Config discovery failures (file name and location mismatch)

Symptom:

- `No generator config found in <cwd>. Expected one of: ...`

Likely cause:

- config file name is unsupported
- CLI is executed from the wrong directory

How to confirm:

- run the command from the intended project root
- check that one of these files exists in that exact directory:
  `athena.config.ts/js`, `athena-js.config.ts/js`, `.athena.config.ts/js`

Exact fix:

- move/rename config to a supported file name in the working directory
- or pass an explicit path:
  `athena-js generate --config ./path/to/athena.config.ts`

Direct mode example:

```ts
export default {
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: process.env.PG_URL!,
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
};
```

Gateway mode example:

```ts
export default {
  provider: {
    kind: "postgres",
    mode: "gateway",
    gatewayUrl: process.env.ATHENA_URL!,
    apiKey: process.env.ATHENA_API_KEY!,
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
};
```

### 2) Gateway auth/header/backend mismatches

Symptom:

- gateway mode fails with 401/403/4xx errors from `/gateway/query`
- direct mode works, but gateway mode fails with the same schema/output settings

Likely cause:

- invalid `gatewayUrl` or `apiKey`
- wrong backend override for introspection SQL
- proxy/gateway strips required request headers before Athena receives the call

How to confirm:

- run: `athena-js generate --config ./athena.config.ts --dry-run`
- verify `/gateway/query` works with the same URL/key pair
- if `provider.backend` is set, confirm it resolves to PostgreSQL

```bash
curl -X POST "$ATHENA_URL/gateway/query" \
  -H "content-type: application/json" \
  -H "x-api-key: $ATHENA_API_KEY" \
  -H "X-Backend-Type: postgresql" \
  -d '{"query":"select 1"}'
```

Exact fix:

- set a valid `gatewayUrl` and `apiKey`
- remove a bad backend override or set `backend: "postgresql"`
- ensure upstream preserves auth/backend headers (`apikey`, `x-api-key`, `X-Backend-Type`)

Gateway fix example:

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

### 3) Empty snapshot / missing schema results

Symptom:

- generation succeeds, but expected tables/schemas are missing in emitted artifacts

Likely cause:

- `provider.schemas` excludes target schemas
- direct mode `connectionString` points to the wrong database
- gateway/database role lacks visibility for catalog metadata in requested schemas

How to confirm:

- run with `--dry-run` and compare expected vs emitted files
- make `schemas` explicit (for example `["public", "billing"]`)
- compare output between direct mode and gateway mode against the same database

Exact fix:

- set explicit `schemas` in config
- ensure direct mode `connectionString` points to the correct DB
- ensure gateway credentials have catalog-read access for those schemas

Direct mode example:

```ts
provider: {
  kind: "postgres",
  mode: "direct",
  connectionString: process.env.PG_URL!,
  database: "app_db",
  schemas: ["public", "billing"],
}
```

Gateway mode example:

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

### 4) Duplicate output path collisions from placeholder templates

Symptom:

- generation fails with: `Generator output collision detected for path: ...`

Likely cause:

- path templates collapse multiple models/schemas into one file path
- `placeholderMap` aliases remove uniqueness dimensions

How to confirm:

- inspect `output.targets` and ensure model/schema/database templates are distinct
- verify model targets include schema and model tokens

Exact fix:

- include `{database_*}`, `{schema_*}`, and `{model_*}` where needed to guarantee unique model paths
- keep schema/database index files separate from model file templates

Collision-prone example:

```ts
targets: {
  model: "src/generated/model.ts",
  schema: "src/generated/schema.ts",
  database: "src/generated/db.ts",
  registry: "src/generated/index.ts",
}
```

Stable example:

```ts
targets: {
  model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
  schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
  database: "src/generated/{database_kebab}/index.ts",
  registry: "src/generated/index.ts",
}
```

### 5) Unsafe identifier rendering expectations

Symptom:

- concern that names like `class`, `from`, `order-id`, or `123flag` will generate invalid TypeScript

Likely cause:

- expectation that column names and symbol names are emitted raw

How to confirm:

- introspect a table with unsafe names in either mode (direct or gateway)
- inspect generated interfaces and model metadata keys

Exact fix:

- no config workaround is required
- generator already escapes unsafe property keys and normalizes symbol identifiers
- use `naming.*` only when you want different symbol style, not for safety

Expected output shape:

```ts
export interface PublicUsersRow {
  "order-id"?: string | null;
  from: string;
  class_value: string;
}
```

### 6) Type mapping surprises (e.g. bigint as string)

Symptom:

- generated types are broader/different than expected (for example `bigint` -> `string`)

Likely cause:

- high-precision numeric mapping is intentionally loss-safe (`int8`/`numeric`/`decimal` -> `string`)
- nullable columns intentionally emit as optional property plus `| null`

How to confirm:

- inspect generated model types and compare with source column types
- compare direct and gateway output (both pass through the same PostgreSQL type mapper)

Exact fix:

- keep precision-sensitive values as strings at boundaries and parse explicitly where needed (`BigInt`, decimal library)
- keep explicit nullable handling in app code
- avoid implicit JS number coercion for `bigint`/`numeric`

## Known limitations

1. Scylla provider is a contract placeholder only; runtime introspection is not implemented.
2. Custom SQL introspection templates are not configurable yet; catalog SQL is fixed in the provider layer.
3. `experimental.postgresGatewayIntrospection` is compatibility-only and does not toggle current gateway support.

## Test evidence (generator-focused)

Coverage in this repo includes:

- direct `pg_url` provider resolution and introspection:
  - `test/generator-provider.test.ts`
- gateway-only provider resolution and `/gateway/query` transport:
  - `test/generator-provider.test.ts`
- pipeline write output in both direct and gateway modes:
  - `test/generator-pipeline.test.ts`
- config loading and typed helper behavior:
  - `test/generator-config.test.ts`
- renderer path placeholder and feature toggle behavior:
  - `test/generator-renderer.test.ts`
- PostgreSQL datatype mapping breadth:
  - `test/postgres-type-mapping.test.ts`

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
