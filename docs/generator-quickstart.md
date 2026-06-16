# Generator quickstart

This page is the fastest path to generated Athena model/registry files.

If you only remember one thing: `athena-js generate` now works in the common case without an `athena.config.*` file, as long as the expected env vars already exist.

## Zero-config direct mode

If your project already has `DATABASE_URL`, you can generate immediately:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db \
athena-js generate --dry-run
```

Default output paths:

- `athena/models/{schema}/{table}.ts`
- `athena/schemas/{schema}.ts`
- `athena/relations.ts`
- `athena/config.ts`

The default schema selection is `public`.

Useful zero-config env overrides:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db
ATHENA_GENERATOR_SCHEMAS=public,athena
ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder
ATHENA_GENERATOR_MODEL_TARGET=src/generated/{schema_kebab}/{model_kebab}.ts

athena-js generate --dry-run
```

## Zero-config gateway mode

If your environment already has Athena gateway credentials, you can generate without a config file here too:

```bash
ATHENA_URL=https://athena-db.com
ATHENA_API_KEY=secret
ATHENA_GENERATOR_DB=app_db
ATHENA_GENERATOR_SCHEMAS=public,athena

athena-js generate --dry-run
```

Optional backend override:

```bash
ATHENA_GENERATOR_BACKEND=postgresql
```

## Minimal direct config file

If you want the repo to declare intent but still keep config tiny, this is enough:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
});
```

With that config, the loader still resolves:

- `provider.connectionString` from `ATHENA_GENERATOR_PG_URL`, `DATABASE_URL`, `PG_URL`, `POSTGRES_URL`, or `POSTGRESQL_URL`
- `provider.database` from `ATHENA_GENERATOR_DB`, `ATHENA_DATABASE`, or `PGDATABASE`
- `provider.schemas` from `ATHENA_GENERATOR_SCHEMAS`
- output/naming/feature overrides from their documented env vars

## Minimal gateway config file

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
  },
});
```

That picks up:

- `provider.gatewayUrl` from `ATHENA_URL`, `ATHENA_GATEWAY_URL`, or `ATHENA_GENERATOR_URL`
- `provider.apiKey` from `ATHENA_API_KEY`, `ATHENA_GATEWAY_API_KEY`, or `ATHENA_GENERATOR_API_KEY`
- `provider.database` from `ATHENA_GENERATOR_DB`, `ATHENA_DATABASE`, or `PGDATABASE`

## Minimal table-builder output

If you want the new Zero-style surface and nothing else:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
  output: {
    format: "table-builder",
  },
});
```

That yields files shaped like:

```ts
import { table, string } from "@xylex-group/athena";
import type { FormValuesOf, InsertOf, RowOf, UpdateOf } from "@xylex-group/athena";

export const users = table("users")
  .schema("public")
  .columns({
    id: string(),
    email: string(),
  })
  .primaryKey("id");

export type PublicUsersRow = RowOf<typeof users>;
export type PublicUsersInsert = InsertOf<typeof users>;
export type PublicUsersUpdate = UpdateOf<typeof users>;
export type PublicUsersFormValues = FormValuesOf<typeof users>;

export const users_row_schema = users.schemas.row;
export const users_insert_schema = users.schemas.insert;
export const users_update_schema = users.schemas.update;
export const users_form_schema = users.schemas.form;
```

Generated registry files also export an internal metadata block:

```ts
import { __athena_schema_meta, registry } from "./athena/config";

__athena_schema_meta.schemaVersion; // 1
__athena_schema_meta.outputFormat; // "table-builder"
```

This is intended for tooling/debugging, not normal query code.

## Minimal gateway table-builder output

If code generation only runs against Athena gateway access in CI, keep the file just as small:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
  },
  output: {
    format: "table-builder",
  },
});
```

With env:

```bash
ATHENA_URL=https://athena-db.com
ATHENA_API_KEY=secret
ATHENA_GENERATOR_DB=app_db

athena-js generate --dry-run
```

## Custom output targets

You only need to specify the paths you want to override:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
  output: {
    targets: {
      model: "src/generated/models/{schema_kebab}/{model_kebab}.ts",
      registry: "src/generated/registry.ts",
    },
  },
});
```

The unspecified targets keep their defaults.

## Common env-only tweaks

Switch formats:

```bash
ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder
```

Target multiple schemas:

```bash
ATHENA_GENERATOR_SCHEMAS=public,athena,analytics
```

Override output paths:

```bash
ATHENA_GENERATOR_MODEL_TARGET=src/generated/{schema_kebab}/{model_kebab}.ts
ATHENA_GENERATOR_SCHEMA_TARGET=src/generated/{schema_kebab}.ts
ATHENA_GENERATOR_DATABASE_TARGET=src/generated/database.ts
ATHENA_GENERATOR_REGISTRY_TARGET=src/generated/registry.ts
```

Tune naming:

```bash
ATHENA_GENERATOR_MODEL_TYPE=pascal
ATHENA_GENERATOR_MODEL_CONST=camel
ATHENA_GENERATOR_SCHEMA_CONST=camel
```

## Env-helper config example

If you want a committed config file but still prefer env-owned secrets and toggles:

```ts
import { defineGeneratorConfig, generatorEnv } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    schemas: generatorEnv("ATHENA_GENERATOR_SCHEMAS"),
  },
  output: {
    format: generatorEnv("ATHENA_GENERATOR_OUTPUT_FORMAT", ["define-model", "table-builder"] as const),
  },
});
```

## Boot the generated registry immediately

Generated files are meant to be used directly, not wrapped again:

```ts
import { createTypedClient } from "@xylex-group/athena";
import { registry } from "./athena/config";

const athena = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);

const { data } = await athena.fromModel("primary", "public", "users").select("id,email");
```

## What the define-model output still looks like

The legacy format remains the default:

```ts
import { defineModel } from "@xylex-group/athena";

export interface PublicUsersRow {
  id: string
  email: string
}

export type PublicUsersInsert = Partial<PublicUsersRow>;
export type PublicUsersUpdate = Partial<PublicUsersInsert>;

export const publicUsers = defineModel<PublicUsersRow, PublicUsersInsert, PublicUsersUpdate>({
  meta: {
    database: "app_db",
    schema: "public",
    model: "users",
    tableName: "public.users",
    primaryKey: ["id"],
    nullable: {
      id: false,
      email: false,
    },
  },
});
```

## Recommended first commands

Direct DB:

```bash
athena-js generate --dry-run
athena-js generate
```

Gateway-only CI:

```bash
ATHENA_URL=https://athena-db.com ATHENA_API_KEY=secret ATHENA_GENERATOR_DB=app_db athena-js generate --dry-run
```

For the full option matrix, output placeholders, env fallback rules, and CI patterns, continue to:

- [`generator-config.md`](generator-config.md)
- [`cli-command-reference.md`](cli-command-reference.md)
- [`generator-cicd.md`](generator-cicd.md)
