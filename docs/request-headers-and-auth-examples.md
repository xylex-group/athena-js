# Request Headers and Auth Examples

Cookbook for SDK-managed headers: API keys, client routing, PostgreSQL URIs, session cookies, bearer tokens, and per-call overrides.

Rollout rules and mirroring behavior: [`auth-session-forwarding.md`](auth-session-forwarding.md). Types: [`api-reference.md`](api-reference.md).

## Header map

| SDK input | HTTP headers |
|---|---|
| `key` / `apiKey` | `apikey`, `x-api-key`, `X-Athena-Key` (unless `athenaKey` overrides the last) |
| `athenaKey` | `X-Athena-Key` only |
| `client` | `X-Athena-Client` |
| `userId` / `organizationId` | `X-User-Id` / `X-Organization-Id` |
| `pgUri` / `jdbcUrl` | `x-pg-uri` / `x-athena-jdbc-url`, `x-jdbc-url` |
| `auth.cookie` / `Cookie` | `Cookie` + `X-Athena-Auth-Session-Token` |
| `auth.bearerToken` / `Authorization` | `Authorization` (auth/chat) + `X-Athena-Auth-Bearer-Token` (gateway/chat/storage) |
| `auth.sessionToken` | `X-Athena-Auth-Session-Token` |
| `forceNoCache` | `Cache-Control: no-cache` |

## Surface reference

| Surface | Options type | Override pattern |
|---|---|---|
| Gateway reads/writes | `AthenaGatewayCallOptions` | Last arg on `.select(...)`, mutation options, or chain terminator |
| `findMany(...)` | — | No per-call options; use `withOptions(...)` first |
| `rpc` / `query` | `AthenaRpcCallOptions` / `AthenaGatewayCallOptions` | Second/third arg or builder `.select(..., options)` |
| `db.*` | Same as gateway | Inherited from root client |
| `client.auth.*` | `AthenaAuthCallOptions` | Trailing `options` arg |
| `client.chat.*` | `AthenaChatCallOptions` | Trailing `options` arg (`Pick` of gateway base + `signal`) |
| `client.storage.*` | `AthenaStorageCallOptions` | Trailing `options` arg (extends gateway) |
| `client.request(...)` | `AthenaRequestOptions` | `apiKey`, `athenaKey`, `headers` on the request object |

Header profiles: `gateway` and `storage` set JSON content-type; `chat` sets `Accept`; `auth` sets `Authorization` but not bearer mirrors.

## Setup

```ts
import { createClient, AthenaClient } from "@xylex-group/athena"

// positional
const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  client: "web-dashboard",
})

// object form with split keys + auth binding
const scoped = createClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
  athenaKey: process.env.ATHENA_GATEWAY_KEY,
  client: "web-dashboard",
  pgUri: process.env.ATHENA_PG_URI,
  auth: {
    baseUrl: process.env.ATHENA_AUTH_URL,
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: session?.session?.token,
    credentials: "include",
  },
})

// builder
const built = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .athenaKey(process.env.ATHENA_GATEWAY_KEY)
  .pgUri(process.env.ATHENA_PG_URI)
  .client("web-dashboard")
  .build()
```

## Keys and routing

```ts
// client-wide split keys
createClient({ key: "mgmt-key", athenaKey: "gateway-route-key" })

// per-call (gateway)
await athena.from("orders").select("*", { apiKey: "call-key", athenaKey: "call-gateway-key" })
await athena.rpc("ping", {}, { athenaKey: "rpc-gateway-key" })
await athena.request({ service: "chat", path: "/rooms", athenaKey: "chat-gateway-key" })

// raw header wins over athenaKey
await athena.from("users").select("id", { headers: { "X-Athena-Key": "header-wins" } })

// PostgreSQL URI (client or per-call)
createClient({ pgUri: "postgres://app:secret@db:5432/acme" })
await athena.query("select now()", { pgUri: "postgres://readonly@replica:5432/acme" })
```

## Auth forwarding

Bind once at construction; per-call `headers`, `bearerToken`, `cookie`, or `sessionToken` still override.

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  auth: { cookie: request.headers.get("cookie") ?? "", bearerToken: token },
})

// gateway read with inbound cookie
await athena.from("invoices").select("*", {
  headers: { Cookie: request.headers.get("cookie") ?? "" },
})

// chat with bearer
await athena.chat.room.list(undefined, { bearerToken: token })

// explicit session (skip cookie parse)
createClient({ auth: { sessionToken: "sess_explicit" } })

// scoped helpers
const requestAthena = base.withSession(session, { requestHeaders: request.headers, forceNoCache: true })
const impersonated = base.withOptions({ athenaKey: "admin-gateway-key" }).withContext({
  userId: "user_99",
  organizationId: "org_2",
  auth: { bearerToken: elevatedToken },
})
```

## By surface (one example each)

### Gateway

```ts
await athena.from("users").eq("id", id).single("id, email", { organizationId: "org_1" })
await athena.from("docs").insert({ title: "Q1" }).select("id", { athenaKey: "write-gateway-key" })
await athena.from("settings").upsert({ key: "theme", value: "dark" }, { onConflict: "key" }).select("key")
const readAthena = athena.withOptions({ athenaKey: "read-gateway-key" })
await readAthena.from("projects").findMany({ select: { id: true }, limit: 25 })
```

### Auth

```ts
const session = await athena.auth.getSession()
await athena.auth.signIn.email({ email, password }, { cookie: inboundCookie })
await athena.auth.admin.user.list({ query: { limit: 50 } }, {
  headers: { "X-Athena-Key": process.env.ATHENA_ADMIN_GATEWAY_KEY! },
})
```

### Chat

```ts
await athena.chat.room.create({ kind: "channel", title: "Engineering" }, { athenaKey: "chat-key" })
await athena.chat.room.message.send(roomId, { body_text: "Hello" }, { bearerToken: token })
const socket = athena.chat.realtime.connect({
  hello: { token, room_subscriptions: [roomId] },
  onMessage: console.log,
})
```

### Storage

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  client: "storage_app",
  experimental: { athenaStorageBackend: true },
  headers: { Cookie: cookie, Authorization: `Bearer ${token}` },
})
await athena.storage.listStorageCatalogs({ forceNoCache: true })
await athena.storage.file.upload({ s3Id, storageKey, fileName }, { organizationId: "org_1" })
```

### `client.request(...)`

```ts
await athena.request({ service: "db", path: "/gateway/fetch", method: "POST", body: { table_name: "users" } })
await athena.request({ service: "auth", path: "/get-session" })
await athena.request({ service: "storage", path: "/catalogs", athenaKey: "storage-key" })
await athena.request({ url: "https://mirror1.athena-cluster.com/health", responseType: "json" })
```

## Scoped client matrix

| Helper | Use when |
|---|---|
| `withSession(session, opts)` | Server handler has a session object + optional inbound headers |
| `withContext(ctx)` | You have raw `userId`, `organizationId`, auth tokens, or extra headers |
| `withOptions(opts)` | Override `url`, `key`, `athenaKey`, `pgUri`, or service URLs |
| `withTenantContext(map)` | Typed client tenant headers via `tenantKeyMap` |

`withContext` does not accept `key` / `athenaKey`; chain `withOptions` first when keys must change.

## Runtime patterns

```ts
// Next.js route handler
export async function GET(request: Request) {
  const athena = createClient({
    url: process.env.ATHENA_URL!,
    key: process.env.ATHENA_API_KEY!,
    athenaKey: process.env.ATHENA_GATEWAY_KEY,
    auth: { cookie: request.headers.get("cookie") ?? "" },
  })
  return Response.json(await athena.from("metrics").select("*").limit(50))
}

// Browser (cookies automatic)
import { createAthenaBrowserClient } from "@xylex-group/athena/next/client"
const browser = createAthenaBrowserClient({ auth: { credentials: "include" } })

// Proxy inbound headers
import { proxyRequestHeaders } from "@xylex-group/athena/utils"
await athena.request({
  service: "auth",
  path: "/get-session",
  headers: Object.fromEntries(proxyRequestHeaders(request).entries()),
})

// Split service URLs
createClient({
  gatewayUrl: "https://gateway/rest/v1",
  authUrl: "https://auth/auth/v1",
  chatUrl: "https://chat/chat/v1",
  storageUrl: "https://storage/storage/v1",
  athenaKey: "internal-gateway-key",
})
```

## Low-level helpers

```ts
import {
  buildAthenaRequestHeaders,
  buildServiceRequestHeaders,
  resolveRequestHeaderOverrides,
} from "@xylex-group/athena/utils"

const headers = buildServiceRequestHeaders("gateway", sdkMarker, clientConfig, callOptions, {
  client: "web-dashboard",
  stripNulls: true,
})

const overrides = resolveRequestHeaderOverrides(config, options)
const custom = buildAthenaRequestHeaders({ profile: "minimal", sdkHeaderValue: sdkMarker, ...overrides })
```

## Precedence

**`X-Athena-Key`:** `headers["X-Athena-Key"]` → per-call `athenaKey` → client `athenaKey` → per-call `apiKey` → client `key`

**`X-Athena-Auth-Session-Token`:** explicit header → `sessionToken` → parsed from `Cookie`

**`X-Athena-Auth-Bearer-Token`:** explicit header → configured `bearerToken` → parsed from `Authorization`

## Edge cases

- `publishEvent` on gateway calls sets `X-Publish-Event`
- `backend` on client or per-call sets `X-Backend-Type`
- `findMany(...)` has no options arg; scope keys via `withOptions(...)`
- `verifyConnection()` does not apply gateway auth mirroring
- `experimental.traceQueries` may log raw headers — redact secrets in custom loggers

## Related

- [`auth-session-forwarding.md`](auth-session-forwarding.md)
- [`getting-started.md`](getting-started.md)
- [`storage/index.md`](storage/index.md)