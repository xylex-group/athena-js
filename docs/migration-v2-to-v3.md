# Migrate Athena JS 2.16.0 to 3.0.0

Target package: `@xylex-group/athena@3.0.0`.  
(athena-rs / monorepo OpenAPI is versioned separately at 4.x.)

Athena JS 3.0.0 is a deliberate breaking release. It replaces the multiple v2 client constructors, capability-specific return types, builder states, and environment-specific wrappers with one runtime-neutral factory:

```ts
import { createClient, type AthenaClient } from '@xylex-group/athena'

const athena: AthenaClient = createClient({
  url: 'https://athena.example.com',
  key: process.env.ATHENA_API_KEY,
})
```

There is no compatibility layer for the removed client identities. Migrate the construction boundary first, then fix configuration names, request context, and type annotations.

## Version pins

Use the coordinated release set when the application also consumes Athena Auth packages:

```json
{
  "dependencies": {
    "@xylex-group/athena": "3.0.0",
    "@xylex-group/athena-auth-ui": "2.0.0",
    "@xylex-group/better-auth-athena": "2.0.0"
  }
}
```

Do not use a caret during the initial migration. An exact pin makes declaration and runtime failures reproducible while the application is being converted.

## The migration in one table

| Athena JS 2.16.0 | Athena JS 3.0.0 |
| --- | --- |
| `createClient(url, key, options)` | `createClient({ url, key, ...options })` |
| `AthenaClient.builder()...build()` | `createClient(config)` |
| `AthenaClient.fromEnvironment()` | `createClient({ env })` |
| `createTypedClient(...)` | `createClient({ models })` |
| `createAuthClient(...)` | `createClient(config).auth` |
| `createAthenaBrowserClient(...)` | `@xylex-group/athena/next/client` `createAthenaBrowserClient` (thin façade over `createClient`) or root `createClient(config)` |
| `createAthenaServerClient(...)` | `@xylex-group/athena/next/server` `createAthenaServerClient` (async request-scoped façade) or root `createClient` + `withContext` |
| `AthenaSdkClient*`, `TypedAthenaClient` | `AthenaClient<TModels>` |
| storage-enabled/capability client types | one `AthenaClient<TModels>` with stable namespaces |
| `withSession(...)`, `withOptions(...)` | `withContext(...)` |
| `experimental.athenaStorageBackend` | no flag; use `client.storage` |
| `experimental.typecheckColumns` | removed; typing derives from models or explicit row types |
| flat service URL aliases | structured `db`, `auth`, `chat`, and `storage` objects |
| implicit `process.env` reads | explicit `env: process.env` |

## Step 1: replace every client constructor

### Positional construction

```ts
// 2.16.0
const athena = createClient(athenaUrl, athenaKey, {
  headers: { 'X-Application': 'formations' },
})

// 3.0.0
const athena = createClient({
  url: athenaUrl,
  key: athenaKey,
  headers: { 'X-Application': 'formations' },
})
```

### Builder construction

```ts
// 2.16.0
const athena = AthenaClient.builder()
  .url(athenaUrl)
  .key(athenaKey)
  .client('formations')
  .build()

// 3.0.0
const athena = createClient({
  url: athenaUrl,
  key: athenaKey,
  client: 'formations',
})
```

### Typed construction

```ts
// 2.16.0
const athena = createTypedClient({
  url: athenaUrl,
  key: athenaKey,
  models,
})

// 3.0.0
const athena = createClient({
  url: athenaUrl,
  key: athenaKey,
  models,
})
```

### Auth construction

```ts
// 2.16.0
const auth = createAuthClient({ baseUrl: authUrl, apiKey: athenaKey })

// 3.0.0
const athena = createClient({
  key: athenaKey,
  auth: { url: authUrl },
})
const auth = athena.auth
```

`athenaAuth(...)` remains public. It constructs the server auth plugin rather than a competing SDK client.

### Next.js browser and server

v3 first removed framework constructors, then [ADR 0014](./adr/0014-next-client-construction-facades.md)
restored **thin façades** that always call `createClient` (no caches, no second core).

```ts
// 2.16.0 — browser (often cached inside the SDK)
const athena = createAthenaBrowserClient({ /* env discovery, cache */ })

// 3.0.0 — browser façade (app owns singleton)
import { createAthenaBrowserClient } from '@xylex-group/athena/next/client'
export const athena = createAthenaBrowserClient({
  url: process.env.NEXT_PUBLIC_ATHENA_URL!,
  key: process.env.NEXT_PUBLIC_ATHENA_PUBLISHABLE_KEY!,
})
```

```ts
// 2.16.0 — server constructors varied by options shape
const athena = await createAthenaServerClient({ /* … */ })

// 3.0.0 — async request-scoped façade
import { createAthenaServerClient } from '@xylex-group/athena/next/server'
export function createServerAthena() {
  return createAthenaServerClient({
    url: process.env.ATHENA_URL!,
    key: process.env.ATHENA_API_KEY!,
  })
}
const athena = await createServerAthena()
```

Rules for the 3.0 façades:

- Browser: required `url` + `key`; no `env` bag; no SDK module cache.
- Server: required `{ url, key }` **or** `{ env }`; no zero-arg factory.
- Prefer [next-js.md](./next-js.md) for full patterns (session, bridge, resolvers).

## Step 2: convert configuration to the structured contract

The canonical 3.0 configuration is:

```ts
const athena = createClient({
  url: 'https://athena.example.com',
  key: process.env.ATHENA_API_KEY,
  client: 'formations',
  backend: 'supabase',
  headers: { 'X-Application': 'formations' },
  models,
  env: process.env,
  context: requestContextProvider,

  db: {
    url: process.env.ATHENA_DB_URL,
    pgUri: process.env.DATABASE_URL,
    jdbcUrl: process.env.ATHENA_JDBC_URL,
  },
  auth: {
    url: process.env.ATHENA_AUTH_URL,
    credentials: 'include',
  },
  chat: {
    url: process.env.ATHENA_CHAT_URL,
    wsUrl: process.env.ATHENA_CHAT_WS_URL,
    webSocketFactory,
  },
  storage: {
    url: process.env.ATHENA_STORAGE_URL,
    directUpload,
    hooks,
  },

  retryReads: true,
  traceQueries: true,
  debugAst: true,
  findManyAst: true,
})
```

The explicit unified `url` is used to derive canonical service routes. A structured service URL overrides the derived route. Values from the explicit `env` object are fallback inputs only.

### URL replacements

| Removed v2 option | 3.0 replacement |
| --- | --- |
| `gateway`, `gatewayUrl`, `dbUrl` | `db.url` |
| `authUrl`, `auth.baseUrl` | `auth.url` |
| `chatUrl` | `chat.url` |
| `chatWsUrl` | `chat.wsUrl` |
| `storageUrl` | `storage.url` |
| top-level storage upload options | `storage.directUpload`, `storage.onError`, and file options |

### Removed flags

Delete these options instead of renaming them:

- `experimental`
- `athenaStorageBackend`
- `typecheckColumns`
- `enableErrorNormalization`
- `directStorageUpload`

Storage and normalized errors are normal client behavior in 3.0. Column typing is determined from the model registry or an explicit row type; it is not a runtime switch.

## Step 3: make environment resolution explicit

Athena JS 3 never reads global `process.env` by itself.

```ts
// Server runtime
export const athena = createClient({ env: process.env })

// Browser runtime: pass only values intentionally exposed to the browser
export const athena = createClient({
  env: {
    NEXT_PUBLIC_ATHENA_URL: process.env.NEXT_PUBLIC_ATHENA_URL,
    NEXT_PUBLIC_ATHENA_API_KEY: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  },
})
```

Recognized aliases include the unified `ATHENA_URL` / `NEXT_PUBLIC_ATHENA_URL`, service-specific Athena URL variables, and `ATHENA_API_KEY` / `NEXT_PUBLIC_ATHENA_API_KEY`. Explicit `key` and structured service values win over environment aliases.

Construction fails when the key is absent or no service can be routed. Do not put a private server API key into a public environment variable.

## Step 4: keep one shared core in server and browser code

The root package import is the constructor in Node.js, browsers, Next.js, Workers, and other supported runtimes. Framework helpers resolve request context; they do not create another client.

### Shared client module

```ts
// src/lib/athena.ts
import { createClient } from '@xylex-group/athena'
import { models } from '@/athena/models'

export const athena = createClient({
  env: process.env,
  models,
})
```

### Next.js server request view

```ts
// src/lib/athena-server.ts
import { resolveNextRequestContext } from '@xylex-group/athena/next/server'
import { athena } from './athena'

export async function athenaForRequest() {
  const context = await resolveNextRequestContext()
  return athena.withContext(context)
}
```

`withContext` returns a lightweight immutable view. It shares the underlying transports, model registry, retry policy, tracing configuration, and service modules. It does not create another transport client.

Do not cache a request-scoped view globally. Create it inside the request boundary.

### Custom scope headers

```ts
const scoped = athena.withContext({
  userId: session.user.id,
  organizationId: session.activeOrganizationId,
  cookie: request.headers.get('cookie'),
  bearerToken: request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''),
  headers: {
    'X-Company-Id': companyId,
  },
  forceNoCache: true,
})
```

Context precedence is client headers, configured static/provider context, explicit `withContext` scope, then per-operation headers. Later layers win.

## Step 5: replace legacy client types

```ts
// 2.16.0
function loadUsers(client: AthenaSdkClientWithStorage) {}
function loadSession(client: AthenaSdkClientWithAuth) {}
function loadTyped(client: TypedAthenaClient<typeof models>) {}

// 3.0.0
function loadUsers(client: AthenaClient<typeof models>) {}
function loadSession(client: AthenaClient<typeof models>) {}
function loadTyped(client: AthenaClient<typeof models>) {}
```

Remove:

- `AthenaSdkClient`
- `AthenaSdkClientWithAuth`
- `AthenaSdkClientWithStorage`
- `TypedAthenaClient`
- capability client types
- environment-specific client types
- strictness generics such as `TStrict`

Every client exposes `db`, `auth`, `chat`, and `storage`. A namespace whose service is not routable throws `AthenaConfigurationError` when invoked:

```ts
try {
  await athena.storage.file.list({ catalogId: 'documents' })
} catch (error) {
  if (
    error instanceof AthenaConfigurationError &&
    error.code === 'ATHENA_SERVICE_NOT_CONFIGURED'
  ) {
    console.error(error.service)
  }
}
```

## Step 6: migrate typing without strictness flags

Pass generated models through `models`:

```ts
const athena = createClient({ url, key, models })

await athena.from(models.app.schemas.public.models.users).select('id,email')
await athena.from('users').findMany({
  select: { id: true, email: true },
  where: { status: { eq: 'active' } },
})
```

For runtime table names that are intentionally not in the registry, provide the row contract explicitly:

```ts
type AuditRow = {
  id: string
  action: string
  created_at: string
}

const audit = await athena.from<AuditRow>('runtime_audit').select('id,action')
```

There is no `typecheckColumns: false` escape hatch. Dynamic tables remain string-based when no model information is available.

## Step 7: move storage into the stable namespace

```ts
// 2.16.0
const athena = createClient({
  url,
  key,
  experimental: {
    athenaStorageBackend: true,
  },
})

// 3.0.0
const athena = createClient({
  url,
  key,
  storage: {
    url: storageUrl,
    directUpload,
  },
})

const files = await athena.storage.file.list({ catalogId: 'documents' })
```

The return type no longer changes when storage is configured. The namespace is stable and routing is validated at operation time.

## Step 8: preserve raw request behavior

Use `client.request(...)` for routes not covered by a domain module:

```ts
const result = await athena.request<{ ok: boolean }>({
  service: 'storage',
  path: '/custom/storage-operation',
  method: 'POST',
  body: { resource_id: 'file-123' },
})
```

Raw requests use the same API key, backend, client, context, cookie, token, and header precedence as the stable namespaces.

## Automated migration searches

Run these searches across source, tests, examples, and docs:

```powershell
rg -n "AthenaClient\.builder|fromEnvironment|createTypedClient|createAuthClient|createAthenaBrowserClient|createAthenaServerClient" .
rg -n "AthenaSdkClient|TypedAthenaClient|WithStorage|WithAuth|TStrict" .
rg -n "withOptions|withSession|experimental|athenaStorageBackend|typecheckColumns" .
rg -n "gatewayUrl|dbUrl|authUrl|chatUrl|chatWsUrl|storageUrl|auth:\s*\{[^}]*baseUrl" .
```

Expected remaining matches should be historical ADRs or migration documentation only.

## Validation checklist

- There is exactly one application-level `createClient(...)` call per immutable configuration/key set.
- Browser and server modules import `createClient` from `@xylex-group/athena`.
- Request code uses `withContext(...)` instead of constructing a new client.
- Custom scope headers, cookie, bearer token, session token, and no-cache state are represented in `AthenaRequestContext`.
- Storage, chat, auth, DB, and raw request operations receive the same request scope.
- Generated models are passed through `models` where compile-time table typing is expected.
- No removed constructor, type, option, or strictness symbol remains in emitted declarations.
- The application passes typecheck, runtime tests, build, and its package-manager lockfile is regenerated against the exact release pins.

## Common migration failures

### `ATHENA_SERVICE_NOT_CONFIGURED`

The namespace exists, but its URL cannot be derived. Set the unified `url`, the relevant structured service URL, or an explicit environment fallback.

### Requests are authenticated but unscoped

Confirm that the request view includes `userId`, `organizationId`, cookies/tokens, and any application-specific headers such as `X-Company-Id`. Do not rebuild a bare client inside the route.

### Column names widened to `string`

Confirm that `models` is passed to `createClient` and that the client variable has not been annotated as an unparameterized legacy type.

### Browser bundle includes server secrets

Do not pass the complete server `process.env` object through a client component. Construct browser configuration from intentionally public values only.

### A dependency still requests Athena 2.x

Upgrade the coordinated Auth UI and Better Auth Athena packages, inspect the lockfile, and remove stale overrides or workspace links before validating declarations.

## Related contracts

- [Single-client consolidation report](./client-v3-consolidation-report.md)
- [Client internal architecture](./client-internal-architecture.md)
- [Accepted ADR catalog](./adr/README.md)
- [Athena JS API reference](./api-reference.md)
- [Request headers and auth examples](./request-headers-and-auth-examples.md)
