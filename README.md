# @xylex-group/athena

current version: `5.1.0`

Athena JS 5 is the TypeScript SDK for Athena database, authentication, storage, chat, and billing. Application code uses one constructor. Complexity stays inside Athena.

## Install

```bash
pnpm add @xylex-group/athena
```

Trusted Node apps that talk to PostgreSQL should also install `pg` (optional peer).

## Quick start

Small Node applications can run database access and supported Auth directly against PostgreSQL. No Athena Gateway and no dedicated Rust Auth process are required.

```ts
import { createClient } from "@xylex-group/athena"

export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
})
```

That single call:

- opens a direct PostgreSQL transport
- enables supported embedded Athena Auth against the same database
- exposes `athena.db`, `athena.auth`, and the other namespaces

If you do not want Auth at all, disable it explicitly. `auth: false` wins over environment inference.

```ts
export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
  auth: false,
})
```

## Deployment modes

Dedicated Athena services use the same SDK:

```ts
export const athena = createClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
})
```

Mixed deployment — local database, remote Auth:

```ts
export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
  auth: {
    url: process.env.ATHENA_AUTH_URL!,
  },
})
```

Application code still uses `athena.auth` in every topology.

The same root import works in browser and server bundles. The package export map selects the browser-safe implementation automatically. Direct PostgreSQL and embedded Auth stay on trusted Node runtimes.

## Database

```ts
const users = await athena
  .from("users")
  .eq("active", true)
  .order("created_at", { ascending: false })
  .select("id,email")

const result = await athena.rpc("reserve_case_number", { organization_id: "org_1" })
const raw = await athena.query("select now()")
```

Compare-and-swap is the same fluent `update` plus `requireAffected`. Do not call `request({ path: "/gateway/update" })` for ordinary table writes.

```ts
import { requireAffected } from "@xylex-group/athena"

const swapped = await athena
  .from("forms", { schema: "forms" })
  .eq("id", formId)
  .eq("schema_revision", expected)
  .update({ schema_revision: expected + 1, schema: nextSchema })

requireAffected(swapped, { min: 1 })
```

Canonical mutation row-count is numeric `result.count`, else `result.affectedRows`. Missing driver/Gateway meta is `null`, never `0`. `request()` stays HTTP-only.

`databaseUrl` and `db.pgUri` are the same connection string. Use one. Browser and React Native clients must not receive a Postgres URL.

## Auth

`athena.auth` is the application namespace for embedded and remote Auth.

Canonical session owner for one root client:

```ts
const session = athena.auth.session.get()
const snapshot = athena.auth.session.getSnapshot()
const stop = athena.auth.session.subscribe((next) => {
  console.log(next.status)
})
await athena.auth.session.refresh()
athena.auth.session.invalidate()
```

One browser root client owns one session. Server applications use a process-root client plus request-scoped views (`withContext` / `createAthenaServerClient({ client })`). They must not treat `athena.auth.session` as the currently authenticated user for the whole Node process.

React `useSession(athena)` projects that owner. It is not a second store.

Auth UI:

```tsx
<AthenaProviders client={athena}>{children}</AthenaProviders>
```

`authClient={...}` remains a compatibility / deprecated path and must delegate to the same root-client semantics.

Administrative Auth is the same client — `athena.auth.admin.*` — against embedded or remote Auth. There is no `createAdminClient()`.

```ts
await athena.auth.admin.listUsers({ limit: 20 })
await athena.auth.admin.banUser({ userId, banReason: "abuse" })
await athena.auth.admin.impersonateUser({ userId })
```

## AthenaModels

```ts
import { createClient } from "@xylex-group/athena"
import { registry } from "./src/lib/athena/generated/registry"

const athena = createClient({
  url,
  key,
  models: registry,
})
const users = registry.app.schemas.public.models.users
await athena.from(users).select("id,email")
```

## Next.js

Prefer one process-root `createClient` and request views:

```ts
import { createClient } from "@xylex-group/athena"
import { createAthenaServerClient } from "@xylex-group/athena/next/server"

export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL,
  url: process.env.ATHENA_URL,
  key: process.env.ATHENA_API_KEY,
})

export function createServerAthena() {
  return createAthenaServerClient({ client: athena })
}
```

Mount Local Runtime + Auth from that root (do not pass a `withContext` view):

```ts
import { createAthenaNextHandlers } from "@xylex-group/athena/next/server"

export const { auth, data } = createAthenaNextHandlers({ client: athena })
```

Browser discovery (`topology.discover: "next"`) honors `prefer` and `probe.cache`. Browser façades on `@xylex-group/athena/next/client` still materialize through `createClient`. Full guide: [docs/next-js.md](./docs/next-js.md).

## Cloudflare

```ts
import { createAthenaFromWorkerEnv } from "@xylex-group/athena/cloudflare"

const { mode, client: athena } = createAthenaFromWorkerEnv(env)
await athena.query("SELECT 1 AS ok")
```

- Always edge: `createCloudflareClient({ d1 })`
- When both D1 and URL exist: `ATHENA_EXECUTION_PREFER=edge|gateway` (default edge)

## React

```ts
import { useSession } from "@xylex-group/athena/react"

const { data, isPending, isAuthenticated, refetch } = useSession(athena)
```

## React Native

Import `@xylex-group/athena/react-native`. That entry stays free of Node `pg` and the embedded Auth server.

## Storage / Billing / Policy

```ts
athena.storage
athena.billing
```

Service-specific URLs override unified-root routing. An unconfigured namespace stays present and throws `AthenaConfigurationError` with `ATHENA_SERVICE_NOT_CONFIGURED` when invoked.

## Runtime diagnostics

```ts
athena.system?.runtime?.()
athena.capabilities
```

## Package entrypoints

| Import | Role |
| --- | --- |
| `@xylex-group/athena` | Root Node/server client |
| `@xylex-group/athena/browser` | Browser-safe client |
| `@xylex-group/athena/react` | React hooks (session projection) |
| `@xylex-group/athena/react-native` | React Native entry |
| `@xylex-group/athena/next/client` | Next browser façade |
| `@xylex-group/athena/next/server` | Next request-scoped façade |
| `@xylex-group/athena/cloudflare` | Workers / D1 / R2 |
| `@xylex-group/athena/auth/server` | Advanced embedded Auth server |

## Documentation

- Product site: https://athena.xbp.app
- Platform docs: https://docs.athena-cluster.com
- [Getting started](./docs/getting-started.md)
- [Next.js](./docs/next-js.md)
- [API reference](./docs/api-reference.md)

## Migration notes

Athena 5 has one normal constructor: `createClient()`. Specialized factories (`createAthenaBrowserClient`, `createAthenaServerClient`, Cloudflare helpers) remain advanced façades over that root. Do not introduce `createAuthClient()` / `createEmbeddedClient()` as alternative application roots.

Historical Athena JS 3 flags (`experimental`, `typecheckColumns`) are gone. Storage and error normalization do not require enable flags.
