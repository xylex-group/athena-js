# Getting started with Athena JS 3

Package version: `@xylex-group/athena@3.0.0`.

## Install

```bash
pnpm add @xylex-group/athena
```

## Create the client

`createClient` is the only **primitive** materializer. It is synchronous and
runtime-neutral.

```ts
import { createClient } from '@xylex-group/athena'

export const athena = createClient({
  url: process.env.ATHENA_URL,
  key: process.env.ATHENA_API_KEY,
  client: 'web',
  diagnostics: 'auto', // quiet in production / OpenNext build
})
```

Prefer `models: registry` when you generate Athena models (registry-strict typing). See [typed schema registry](./typed-schema-registry.md).

Pass `env` explicitly when you want alias resolution (no implicit global reads):

```ts
export const athena = createClient({ env: process.env })
```

Recognized aliases include unified/service Athena URLs, `ATHENA_API_KEY`,
`NEXT_PUBLIC_ATHENA_API_KEY`, `ATHENA_GATEWAY_API_KEY`, `X_API_KEY`,
`ATHENA_CLIENT`, and `NEXT_PUBLIC_ATHENA_CLIENT`.

### Next.js apps

Prefer the dedicated façades so browser and server stay separated:

| Environment | Import | Factory |
| --- | --- | --- |
| Process root (Node) | `@xylex-group/athena/server` | `createClient({ databaseUrl })` — infers embedded Auth |
| Client Components | `@xylex-group/athena/next/client` | `createClient({ topology: { discover: "next" } })` |
| Server Components / Actions / Route Handlers | `@xylex-group/athena/next/server` | `createAthenaServerClient({ client })` (async request view) |

Full patterns (config typing, session, `next/headers`, bridge): **[Next.js integration](./next-js.md)**.

### Cloudflare Workers (D1 / R2, or remote server)

```ts
import { createAthenaFromWorkerEnv } from '@xylex-group/athena/cloudflare'

// Edge if env.DB, gateway if ATHENA_URL — or force with ATHENA_EXECUTION_MODE
const { mode, client: athena } = createAthenaFromWorkerEnv(env)
await athena.from('users').select('id,email')
```

Always-edge: `createCloudflareClient({ d1 })`.  
Guide: **[Cloudflare edge-local](./cloudflare-edge-local.md)** · demo **[examples/cloudflare/app.ts](../examples/cloudflare/app.ts)**.

## Query data

```ts
const result = await athena
  .from('organizations')
  .eq('active', true)
  .range(0, 24)
  .select('id,name')

if (result.error) throw new Error(result.error.message)
```

The `db` namespace exposes the same query engine plus convenience methods:

```ts
await athena.db.from('users').eq('id', userId).single()
await athena.db.insert('events', { name: 'created' })
await athena.db.rpc('reserve_number', { organization_id: organizationId })
```

Trusted Node can use the same fluent API against PostgreSQL (`databaseUrl` / `db.pgUri`) with no Gateway hop. CAS is conjunctive `.eq()` on `update` plus `requireAffected` (numeric `count`, else `affectedRows`). `.single()` / `.maybeSingle()` return the first row or `null`. `request()` is HTTP-only.

## Auth, chat, storage, and billing

Every client exposes stable namespaces (no capability flags):

```ts
const session = await athena.auth.getSession()
const rooms = await athena.chat.rooms.list()
const files = await athena.storage.file.list({ catalogId: 'documents' })
// billing is present when a billing-capable base URL is configured
```

Configure service overrides through `auth`, `chat`, `storage`, `db`, or
`billing` objects on `createClient` config.

## Generated models (Architecture 4.0)

Canonical app layout places the registry under `src/lib/athena/generated/`:

```ts
// src/lib/athena/client.ts
import { createClient } from '@xylex-group/athena'
import { registry } from './generated/registry'

export const athena = createClient({
  url,
  key,
  models: registry,
})

await athena.from(registry.app.schemas.public.models.users).select('id,email')
```

Model metadata drives table and column inference. See
[typed schema registry](./typed-schema-registry.md) and
[ADR 0022](./adr/0022-canonical-app-project-layout.md).

## Request scope with `withContext`

Application-specific scope creates a lightweight view over the same core
(no second transport):

```ts
const scoped = athena.withContext({
  userId,
  organizationId,
  headers: { 'X-Company-Id': companyId },
  forceNoCache: true,
})
```

On Next, prefer [createAthenaServerClient](./next-js.md#server-client) when the
scope is “current request + session”.

## Diagnostics and retries

```ts
const athena = createClient({
  url,
  key,
  retryReads: true,
  traceQueries: { logger: event => telemetry.emit(event) },
  debugAst: true,
  findManyAst: true,
})
```

Read retries never convert mutations into retryable operations. Diagnostic
payloads must not include credentials.

## Next steps

| Goal | Doc |
| --- | --- |
| Next.js browser/server construction | [next-js.md](./next-js.md) |
| Auth session → gateway headers | [auth-session-forwarding.md](./auth-session-forwarding.md) |
| Exact signatures | [api-reference.md](./api-reference.md) |
| Every method + example | [complete-method-reference.md](./complete-method-reference.md) |
| v2 → v3 hard cut | [migration-v2-to-v3.md](./migration-v2-to-v3.md) |
| Storage | [storage/index.md](./storage/index.md) |
| Generator (`init` + `generate`, schema auto-fill) | [generator-quickstart.md](./generator-quickstart.md) · [cli-command-reference.md](./cli-command-reference.md) |
