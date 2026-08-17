# Typed schema registry

Athena JS 3 binds registries directly to the normal root client.

```ts
import { createClient } from '@xylex-group/athena'
import { registry } from '../src/lib/athena/generated/registry'

const athena = createClient({
  url: process.env.ATHENA_URL,
  key: process.env.ATHENA_API_KEY,
  models: registry,
})
```

Use generated model values when possible:

```ts
const users = registry.app.schemas.public.models.users

await athena.from(users).select('id,email')
await athena.from(users).insert({ email: 'user@example.com' })
await athena.from(users).eq('id', userId).update({ email: nextEmail })
```

The same `AthenaClient<typeof registry>` exposes DB, auth, chat, and storage. No typed-client wrapper or strictness flag is needed.

## Authoring models

Prefer the table DSL:

```ts
const users = table('users')
  .schema('public')
  .columns({
    id: string().generated(),
    email: string(),
  })
  .primaryKey('id')
```

`defineSchema`, `defineDatabase`, and `defineRegistry` group model values. `defineModel` remains a low-level compatibility authoring helper, not another client constructor.

## D1 edge drop-in + SQL DDL

The same models work on **gateway** (Postgres) and **edge** (D1):

- Gateway wire names stay schema-qualified (`public.users`).
- Edge D1 **strips the schema** at compile time (`public.users` → `users`), so registries generated with `.schema('public')` are drop-in for D1 as long as the physical D1 table is the bare name.
- Multi-schema collisions (`public.users` vs `analytics.users`) need distinct physical names (e.g. `.from('analytics_users')`).

Emit dialect DDL from models (no migration runner — just SQL text / files):

```ts
import {
  sqlPostgres,
  sqlD1,
  modelsToSqlFiles,
  writeModelSqlFiles, // Node only
} from '@xylex-group/athena'

sqlPostgres(users) // CREATE SCHEMA + CREATE TABLE "public"."users" (...)
sqlD1(users)       // CREATE TABLE "users" (...)  — bare names for edge

// In-memory descriptors
modelsToSqlFiles(registry, { dialects: ['postgres', 'd1'] })
// → postgres/public/users.sql, d1/public/users.sql, …

// Write tree to disk (Node)
await writeModelSqlFiles(registry, { outDir: './sql', dialects: ['postgres', 'd1'] })
```

Column kinds map roughly as: `string`→TEXT, `number`→DOUBLE PRECISION / REAL, `boolean`→BOOLEAN / INTEGER, `json`→JSONB / TEXT, `enumeration`→TEXT + CHECK. Generated numeric single-column PKs become `BIGSERIAL` (Postgres) or `INTEGER PRIMARY KEY AUTOINCREMENT` (D1).

## Dynamic tables

When a runtime table is intentionally outside the registry, omit models or use an explicit row type in a client without a closed registry:

```ts
const dynamic = createClient({ url, key })
await dynamic.from<{ runtime_column: string }>('runtime_table').select('runtime_column')
```

## Strict vs permissive clients

| Mode | Config | `.from(...)` typing |
| --- | --- | --- |
| **Registry-strict** (recommended for typed domains) | `createClient({ url, key, models: registry })` | Table names and rows derive from generated models |
| **Permissive** (dynamic admin / unknown tables) | `createClient({ url, key })` without `models` | String table names; optional row generics |

Do not leave “accidental” untyped clients when you already pay for generation. Prefer:

```ts
import type { registry } from '../src/lib/athena/generated/registry'
import { createClient } from '@xylex-group/athena'

export type AppAthenaClient = ReturnType<
  typeof createClient<typeof registry>
>

export const athena = createClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
  models: registry,
})
```

Next server façades preserve the models generic:

```ts
await createAthenaServerClient({
  url,
  key,
  models: registry,
  session,
  scope: { userId, organizationId },
})
```

Migration path for large apps: keep a permissive client for legacy dynamic tables, introduce a second typed client for domain modules, then flip call sites. There is no separate `strictModels` flag — presence of `models` is the switch.

## Diagnostics

```ts
createClient({
  url,
  key,
  diagnostics: 'auto', // quiet in production / OpenNext build
  // or force: diagnostics: true
  // explicit flags always win: debugAst: true
})
```
