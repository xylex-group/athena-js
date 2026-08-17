# Next.js integration

Athena JS ships dedicated Next entrypoints so browser and server code stay
separated without a second client implementation.

| Import | Role |
| --- | --- |
| `@xylex-group/athena/next/client` | Browser-safe construction + session-bridge helpers for Client Components |
| `@xylex-group/athena/next/server` | Request-scoped construction + context resolvers + bridge handlers + table schema handlers (`server-only`) |
| `@xylex-group/athena` | Root SDK (includes `createAthenaTableSchemaHandlers` for `/api/tables/schema`) |

**Invariant (ADR 0014):** only `createClient` materializes the client core.
Next helpers are thin façades. They do not cache request-bound clients.

See also: [getting started](./getting-started.md), [auth session forwarding](./auth-session-forwarding.md), [auth session bridge](./auth-session-bridge.md), [ADR 0014](./adr/0014-next-client-construction-facades.md).

---

## Construction matrix (golden paths)

Use one path per surface. All data paths still call `createClient` under the hood.

| Surface | Import | Constructor | Notes |
| --- | --- | --- | --- |
| Browser data client | `@xylex-group/athena/next/client` | `createAthenaBrowserClient({ url, key, client? })` | Explicit credentials only; app owns singleton. `key`/`client` set gateway headers — no `buildAthenaGatewayHeaders` |
| Server data client (preferred) | `@xylex-group/athena/next/server` | `createAthenaServerClient({ client: athena, session?, scope? })` | **Per request** view via `withContext`; reuses one static core |
| Server data client (standalone) | `@xylex-group/athena/next/server` | `createAthenaServerClient({ url, key, session?, scope? })` | **Per request**; materializes through `createClient` |
| Server data client (local Postgres) | `@xylex-group/athena/next/server` | `createAthenaServerClient({ databaseUrl, session?, scope? })` | Same `databaseUrl` as Node `createClient` |
| Root / non-Next | `@xylex-group/athena` | `createClient({ url, key })` or `createClient({ databaseUrl })` | Runtime-neutral |
| Auth UI | `@xylex-group/athena-auth-ui` | `<AuthProvider client={athena}>` | Consumes `athena.auth`; `createAthenaAuthClient` is legacy |

### Do not

- Cache `createAthenaServerClient` results at module scope (cookies/identity leak across users).
- Call `withContext({})` after the server factory expecting org/user headers — use `session` and/or `scope` instead.
- Treat alternate constructors as different client implementations; they are façades only.

### Identity headers (server)

Gateway identity comes from request context:

| Context field | Typical header |
| --- | --- |
| `userId` | `X-User-Id` |
| `organizationId` | `X-Organization-Id` |

**Resolution order** for `createAthenaServerClient` / `resolveAthenaServerContext`:

1. Cookies, bearer, custom `headers`, `forceNoCache` from the request (or explicit inputs).
2. Session map: `session.user.id` → `userId`, `session.session.activeOrganizationId` → `organizationId`.
3. Explicit `scope`: any field present on `scope` **overrides** the session value for that field (including `null` to clear).
4. Application `context` (static or async) merges first; resolved request/session/scope wins on identity fields when merged last by the factory.

Empty `scope: {}` keeps session identity and logs a development warning.
Empty `withContext({})` logs a development warning (no production throw).

---

## Browser client (Architecture 4.0)

Canonical path: `src/lib/athena/client.ts` (optional `public-config.ts` when justified).

```ts
// src/lib/athena/public-config.ts (optional)
import type { AthenaBrowserClientConfig } from '@xylex-group/athena/next/client'

export const athenaPublicConfig = {
  url: process.env.NEXT_PUBLIC_ATHENA_URL!,
  key: process.env.NEXT_PUBLIC_ATHENA_PUBLISHABLE_KEY!,
  client: process.env.NEXT_PUBLIC_ATHENA_CLIENT,
} satisfies AthenaBrowserClientConfig
```

```ts
// src/lib/athena/client.ts
'use client'

import { createAthenaBrowserClient } from '@xylex-group/athena/next/client'
import { registry } from './generated/registry'
import { athenaPublicConfig } from './public-config'

export const athena = createAthenaBrowserClient({
  ...athenaPublicConfig,
  models: registry,
})
```

### Rules

| Do | Do not |
| --- | --- |
| Pass explicit `url` and `key` | Pass `env: process.env` |
| Own singleton lifetime in a module export | Expect the SDK to cache clients |
| Import from `next/client` in Client Components | Import `next/server` into client graphs |

`AthenaBrowserClientConfig` is `AthenaClientConfig` without `env` or `context`,
with required `url` and `key`.

---

## Server client (Architecture 4.0)

Canonical path: `src/lib/athena/server.ts`. Export name: **`createAthenaServer`**.

**Preferred:** one static `createClient` / browser façade, then per-request
`createAthenaServerClient({ client: athena, session })` so cookies/identity
layer through `withContext` without rebuilding transports.

```ts
// src/lib/athena/server.ts
import 'server-only'
import { createAthenaServerClient } from '@xylex-group/athena/next/server'
import { athena } from './client' // static core (no request identity)

export function createAthenaServer(session?: {
  user?: { id: string }
  session?: { id: string; activeOrganizationId?: string | null }
} | null) {
  return createAthenaServerClient({
    client: athena,
    session,
  })
}
```

Standalone (still valid) when you are not sharing a module-level core:

```ts
return createAthenaServerClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
  client: process.env.ATHENA_CLIENT, // string identity name, not AthenaClient
  models: registry,
  session,
})
```

```ts
// Server Component / Server Action / Route Handler
const athena = await createAthenaServer()
const result = await athena.from('customers').select('*')
```

Session resolver (when auth): `src/lib/athena/session.ts` exports **`athenaSession`** only.

### Scoped server client (org / user headers)

When you already resolved identity (middleware, `get-session`, product org policy),
pass it as `scope` so `X-User-Id` / `X-Organization-Id` are applied without a
second `withContext` hop:

```ts
const athena = await createAthenaServerClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
  session, // optional: fills identity from auth session
  scope: {
    userId: session?.user?.id ?? null,
    organizationId: resolvedProductOrganizationId,
  },
})
```

`scope` fields override session-derived identity when present. Prefer this over
app helpers that call `withContext({})` and drop scope.

### Configuration shapes

Require **one** of `{ url, key }`, `{ env }`, `{ databaseUrl }`, or `{ client }`
(no zero-arg factory):

```ts
// Explicit hosted
await createAthenaServerClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
})

// Local PostgreSQL (same alias as createClient)
await createAthenaServerClient({
  databaseUrl: process.env.DATABASE_URL!,
})

// Or env aliases (server-only)
await createAthenaServerClient({
  env: process.env,
})
```

### Request context

On every invocation the factory:

1. Resolves cookies, `Authorization` bearer, custom headers, and `forceNoCache`
   (from explicit inputs, or automatically via `next/headers`).
2. Maps optional `session.user.id` → `userId` and
   `session.session.activeOrganizationId` → `organizationId`.
3. Applies optional `scope` (field-level override of session identity).
4. Merges that with any application-level `config.context` (static or async).
5. Calls `createClient({ ...config, context })`.

Explicit inputs skip `next/headers` (useful in tests and some Route Handlers):

```ts
await createAthenaServerClient({
  url,
  key,
  requestHeaders: request.headers,
  requestCookies: request.headers.get('cookie'),
  forceNoCache: true,
  headers: { 'X-Company-Id': companyId },
  scope: { userId, organizationId },
})
```

### Rules

| Do | Do not |
| --- | --- |
| Call the factory once per request | Cache the returned client across requests |
| Import `next/server` only on the server | Import server entry from Client Components |
| Pass `{ url, key }`, `{ env }`, `{ databaseUrl }`, or `{ client }` | Call `createAthenaServerClient()` with no config |
| Pass `session` and/or `scope` for identity | Use empty `withContext({})` expecting org headers |

---

## Advanced: shared root + resolvers

When one long-lived root client is preferred:

```ts
import { createClient } from '@xylex-group/athena'
import {
  resolveNextRequestContext,
  resolveAthenaServerContext,
} from '@xylex-group/athena/next/server'

export const athena = createClient({ env: process.env })

export async function athenaForRequest() {
  return athena.withContext(await resolveNextRequestContext())
}

export async function athenaForSession(session: {
  user?: { id: string }
  session?: { id: string; activeOrganizationId?: string | null }
} | null) {
  const resolved = await resolveAthenaServerContext({ session })
  return athena.withContext(resolved.request)
}
```

Context views share the same immutable transport core as the root client.
Pass the **root** into handlers — `withContext` views do not carry handler internals.

---

## Local Runtime handlers (App Router)

Mount Auth + Gateway from one Node root. Do not rematerialize `pg` or Auth per request.

```ts
// src/lib/athena/root.ts
import { createClient } from '@xylex-group/athena'

export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
})
```

```ts
// app/api/athena/[...path]/route.ts
import { createAthenaNextHandlers } from '@xylex-group/athena/next/server'
import { athena } from '@/lib/athena/root'

export const { auth, data } = createAthenaNextHandlers({ client: athena })
export const { GET, POST, PATCH, DELETE } = data
```

```ts
// app/api/auth/[...all]/route.ts
import { createAthenaNextHandlers } from '@xylex-group/athena/next/server'
import { athena } from '@/lib/athena/root'

export const { GET, POST } = createAthenaNextHandlers({ client: athena }).auth
```

`createAthenaDataHandlers({ client })` is the data-only form. Policies on the
root become `security.mode: "policy"`. Embedded Auth becomes
`authenticated` + `athena-session` against the same stores. Trusted HTTP still
requires `unsafeAllowUnauthenticated: true`.

Browser discovery (`topology.discover: "next"`) honors `prefer` and
`probe.cache`. `prefer: "hosted"` never probes `/api/athena` when `url` +
`key` exist. `probe.cache: "session"` shares one probe in the realm (and
`sessionStorage` when present). After local is selected, later 500s do not
fail over to hosted.

---

## Admin permission (short path)

```ts
import { resolveAdminPermission } from '@xylex-group/athena/admin'
import { createAthenaServerClient } from '@xylex-group/athena/next/server'

const athena = await createAthenaServerClient({ url, key, session })
const gate = await resolveAdminPermission(athena, {
  session,
  permissions: { users: ['manage'] },
  credentials: {
    cookie: request.headers.get('cookie'),
  },
})
if (!gate.ok) {
  return Response.json({ error: gate.error }, { status: gate.status })
}
```

No need to scan cookie names for `athena-auth` / `better-auth` prefixes — pass the raw header via `credentials`.

## Sign-out lifecycle

```ts
import { signOutAndClearAthenaSession } from '@xylex-group/athena/utils'
import { clearAthenaAuthSessionOnAppHost } from '@xylex-group/athena/next/client'

await signOutAndClearAthenaSession({
  signOut: () => authClient.signOut({ fetchOptions: { throw: true } }),
  clearBridge: () => clearAthenaAuthSessionOnAppHost(),
  redirectTo: '/sign-in',
})
```

## Server session (`getServerSession`)

Composable session loader for RSC / route handlers. Prefer this over a thick
app-local `get-session` module; keep only product org policy in the app.

Full contract: [auth-session-runtime-contract.md](./auth-session-runtime-contract.md)
Migration: [migration-session-api-v4.md](./migration-session-api-v4.md)

```ts
import {
  createAthenaServerClient,
  createServerSessionResolver,
  requireServerSession,
} from '@xylex-group/athena/next/server'

// App binding (preferred)
export const session = createServerSessionResolver({
  client: () => getAthenaAuthClient(),
  appOrigin: process.env.NEXT_PUBLIC_APP_URL!,
  cache: 'request', // optional React cache() when available
  resolveActiveOrganizationId: async ({
    userId,
    rawActiveOrganizationId,
    session: transport,
  }) => resolveProductOrganizationId(userId, rawActiveOrganizationId, transport),
})

// In a Server Component / protected action:
const data = await session.requireSession()
// data: AthenaSessionData — organization.activeId / rawActiveId

const athena = await createAthenaServerClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
  session: data,
  scope: {
    userId: data.user.id,
    organizationId: data.organization.activeId,
  },
})

// Low-level discriminated result still available:
// const result = await getServerSession({ ... })
// result.ok / result.authenticated / result.data / result.error / result.meta
```

### Pipeline

1. Middleware header `x-session-data` (`ATHENA_SESSION_DATA_HEADER`) when present
2. Else `GET /api/auth/get-session?disableCookieCache=true` with request cookies/bearer
3. Optional `resolveActiveOrganizationId` (product hook)
4. Optional `organization.ensureActive` / `ensureActiveOrganization` injectables (`list` / `setActive`, `persist`, `onEmpty`)

Upstream/protocol failures are `ok: false` (not logged-out). Prefer
`createServerSessionResolver` + `requireSession` / `getSessionOrNull` in apps.

---

## Session bridge (cross-origin apps)

When the app origin differs from the Athena Auth origin, use the app-host
httpOnly cookie bridge so Server Components see a session cookie.

- Browser helpers: `@xylex-group/athena/next/client`
- Route handlers: `@xylex-group/athena/next/server`

Full guide: [auth-session-bridge.md](./auth-session-bridge.md).

---

## Table schema catalog route

Drop-in App Router handler for gateway table introspection (columns, primary
keys, relations). Used by Athena Auth UI table builder and similar UIs.

```ts
// app/api/tables/schema/route.ts
import { createAthenaTableSchemaHandlers } from '@xylex-group/athena'
// or: import { createAthenaTableSchemaHandlers } from '@xylex-group/athena/next/server'

export const dynamic = 'force-dynamic'
export const { POST } = createAthenaTableSchemaHandlers()
```

**Request body**

```json
{
  "config": {
    "gatewayUrl": "https://gateway.example.com",
    "gatewayKey": "…",
    "gatewayDatabase": "app_db",
    "schemaScope": "public,athena",
    "clientName": "my-client"
  }
}
```

Also available: `fetchAthenaTableCatalog(config)`, `handleAthenaTableSchemaPost`,
and `ATHENA_TABLE_SCHEMA_ROUTE` (`/api/tables/schema`).

---

## Package surface

| Subpath | Typical use |
| --- | --- |
| `@xylex-group/athena` | Universal `createClient` (root/browser conditions) |
| `@xylex-group/athena/next/client` | Client Components, public config typing, browser bridge + auth URL / cookie / route helpers |
| `@xylex-group/athena/next/server` | RSC, Server Actions, Route Handlers, bridge handlers, origin/env/header helpers, `ensureActiveOrganization` |
| `@xylex-group/athena/react` | `useSession`, query hooks |
| `@xylex-group/athena/cookies` | Cookie read/write helpers |
| `@xylex-group/athena/utils` | Full utils surface (also re-exported selectively on Next entries) |

Both Next entries re-export the newer shared helpers apps commonly need (`createFreshSessionLookupUrl`, `buildAthenaGatewayHeaders`, `asNonEmptyString`, auth route maps, and on the server also `requireEnv` / `getOriginFromHeaders` / `proxyRequestHeaders` / `ensureActiveOrganization`) so Client and Server Components can import from one place.

---

## Errors

| Code | When |
| --- | --- |
| `ATHENA_API_KEY_REQUIRED` | Missing/blank key at construction |
| `ATHENA_NO_SERVICE_CONFIGURED` | No routable service URL |
| `ATHENA_NEXT_SERVER_RUNTIME_REQUIRED` | Server helpers need Next runtime or explicit request inputs |

---

## Related

- [API reference](./api-reference.md)
- [Complete method reference](./complete-method-reference.md) — Next helpers table
- [Client internal architecture](./client-internal-architecture.md)
- Fixture under `test/fixtures/next-app/` for compile/graph checks
