# Auth Session Forwarding for Gateway Requests

This page documents how `@xylex-group/athena` binds Athena Auth context onto `client.auth.*` and forwards the same context onto gateway/query requests.

The short version:

- the SDK still forwards your original `Cookie` and `Authorization` headers unchanged
- the SDK now also mirrors auth context into:
  - `X-Athena-Auth-Session-Token`
  - `X-Athena-Auth-Bearer-Token`
- this is intended to let the Athena server do optional session-aware DB authentication without breaking existing header/cookie behavior
- when you configure `createClient(..., { auth: { ... } })`, the same bound auth context is also used by `client.auth.*` by default

## What this applies to

This forwarding behavior applies to the gateway request surfaces created by `createClient(...)` / `AthenaClient.builder()`:

- `client.from(...).select(...)`
- `client.from(...).insert(...)`
- `client.from(...).upsert(...)`
- `client.from(...).update(...)`
- `client.from(...).delete(...)`
- `client.findMany(...)` through the table builder
- `client.rpc(...)`
- `client.query(...)`
- `client.db.*`

This does **not** change:

- `verifyConnection(...)`
- browser cookie storage itself

`client.auth.*` still follows the existing auth client contract. The change is that `auth.cookie`, `auth.sessionToken`, and `auth.bearerToken` can now be bound once at client construction instead of being repeated on every auth call.

## Client-wide auth context binding

If you already resolved auth state in a server runtime, bind it once:

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  auth: {
    baseUrl: ATHENA_AUTH_URL,
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: session?.session?.token,
    sessionToken: session?.session?.token,
    credentials: "include",
  },
})
```

That gives you one request-scoped client where:

- `client.auth.*` sends the configured auth cookie/token defaults automatically
- gateway/query calls keep forwarding `Cookie`
- gateway/query calls also mirror `X-Athena-Auth-Session-Token` and `X-Athena-Auth-Bearer-Token` when available

If you need impersonation or another one-off credential, pass per-call overrides. Call-level `fetchOptions` and call-level headers still win over the bound defaults.

## Header contract

### Session token mirroring

If the outgoing gateway call already has a `Cookie` header and that cookie header contains an Athena Auth session cookie, the SDK forwards:

- the original `Cookie` header
- `X-Athena-Auth-Session-Token: <parsed session token>`

The cookie parser currently understands the Athena cookie naming used by the SDK helper:

- `athena-auth.session_token`
- `athena-auth-session_token`
- `__Secure-athena-auth.session_token`
- `__Secure-athena-auth-session_token`

Example:

```http
Cookie: foo=bar; athena-auth.session_token=sess_123
X-Athena-Auth-Session-Token: sess_123
```

### Bearer token mirroring

If the outgoing gateway call already has:

```http
Authorization: Bearer bearer_123
```

the SDK forwards:

```http
Authorization: Bearer bearer_123
X-Athena-Auth-Bearer-Token: bearer_123
```

### `createClient(..., { auth: { bearerToken, cookie, sessionToken } })`

If you configure the client like this:

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  auth: {
    baseUrl: ATHENA_AUTH_URL,
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: accessToken,
    sessionToken: sessionToken,
  },
})
```

then the same auth context is used on two different surfaces:

- `client.auth.*` sends `Authorization: Bearer <token>`, `Cookie`, and `X-Athena-Auth-Session-Token` when those values are configured
- gateway/query calls keep `Cookie`, send `X-Athena-Auth-Session-Token: <token>` when a session token is available, and send `X-Athena-Auth-Bearer-Token: <token>` when a bearer token is available

This is useful when you already have a bearer-token-based auth flow and want Athena server-side auth rollout to opt into the same token without requiring every query caller to set raw headers manually.

## Precedence rules

The mirroring logic is intentionally conservative.

### Session token precedence

1. `X-Athena-Auth-Session-Token` if you set it explicitly in `headers`
2. parsed Athena session token from `headers.Cookie`

If you already resolved the session token yourself on the server, set `X-Athena-Auth-Session-Token` directly and the SDK will not try to replace it from cookies.

### Bearer token precedence

1. `X-Athena-Auth-Bearer-Token` if you set it explicitly in `headers`
2. bearer token parsed from `headers.Authorization`
3. client-wide `createClient(..., { auth: { bearerToken } })` default, because that default is written into the gateway header set up front

Important consequence:

- if you set `auth.bearerToken` at client construction time and later send a different per-call `Authorization: Bearer ...`, the mirrored `X-Athena-Auth-Bearer-Token` will still stay on the client-wide value unless you also override `X-Athena-Auth-Bearer-Token` directly

If you need the mirrored bearer token to vary per request, prefer one of these:

- set `X-Athena-Auth-Bearer-Token` per call
- do not set a client-wide `auth.bearerToken`; instead pass per-call `Authorization` or per-call `X-Athena-Auth-Bearer-Token`

## Recommended usage patterns

### 1. Server runtime: bind inbound auth context once

If you are in a Node/Next/Express route handler and want both `client.auth.*` and gateway calls to share one auth context, bind it through `auth`:

```ts
import { createClient } from "@xylex-group/athena"

export async function GET(request: Request) {
  const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
    auth: {
      baseUrl: process.env.ATHENA_AUTH_URL!,
      cookie: request.headers.get("cookie") ?? "",
      credentials: "include",
    },
  })

  return Response.json(await athena.from("projects").select("*"))
}
```

The SDK will:

- send `Cookie` on `client.auth.*`
- keep `Cookie` on gateway/query calls
- parse the Athena session cookie if present
- add `X-Athena-Auth-Session-Token`

### 2. Server runtime: pass the session token explicitly

If your app already resolved the session token separately, pass it directly:

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  auth: {
    baseUrl: ATHENA_AUTH_URL,
    sessionToken,
  },
})
```

Use this when you want the Athena server auth layer to key off the session token without depending on cookie parsing at the Athena SDK layer.

### 3. Per-request bearer auth

```ts
await athena.from("orders").select("*", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
})
```

The SDK will forward both:

- `Authorization`
- `X-Athena-Auth-Bearer-Token`

### 4. Client-wide bearer auth

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  auth: {
    baseUrl: ATHENA_AUTH_URL,
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: accessToken,
  },
})
```

Use this when:

- your auth client and your gateway calls should share one bearer token
- you want stable default auth context on every gateway request

## Browser vs server behavior

This distinction matters.

### Browser callers

In browser JavaScript, you generally cannot read or set the raw `Cookie` request header manually. That means the SDK cannot derive `X-Athena-Auth-Session-Token` from the browser cookie jar by itself.

So for browser-originated gateway calls:

- same-origin cookies may still be sent by the browser network stack
- but the SDK-level session-token mirroring only happens when a `Cookie` header is explicitly present in the request options/header set

In practice:

- server runtimes and proxy routes can use cookie-to-header mirroring
- browser runtimes should use bearer-token mirroring, explicit `X-Athena-Auth-Session-Token`, or rely on the server reading cookies directly instead of expecting the SDK to synthesize the session header client-side

### Server callers

Server runtimes have the most control:

- they can forward `Cookie`
- they can set `Authorization`
- they can set `X-Athena-Auth-Session-Token` directly
- they can set `X-Athena-Auth-Bearer-Token` directly

If you are rolling out session-aware DB auth on the Athena server, server-side callers are the cleanest opt-in path.

## Security and operational notes

These mirrored headers are auth secrets. Treat them like you treat cookies or bearer tokens.

### Logging

Be careful with:

- request logging
- reverse-proxy header dumps
- error telemetry
- query tracing

`experimental.traceQueries` includes request `options`, which can include raw headers. If you pass auth headers through `headers`, redact them before writing traces to logs or telemetry sinks.

### Header trust model

If the Athena server starts honoring `X-Athena-Auth-Session-Token` or `X-Athena-Auth-Bearer-Token`, decide clearly which upstreams are trusted to set them.

Typical rollout pattern:

1. trust only requests from your controlled app/proxy tier
2. validate the token server-side
3. map it to DB/session auth context
4. leave existing API key behavior intact during rollout

### No automatic auth-mode switch

The SDK does not automatically disable API key auth when these headers are present.

Today the request can carry both:

- Athena API key / gateway routing headers
- mirrored auth context headers

That is intentional for incremental server rollout.

## Practical server rollout suggestion

If you want Athena server-side auth to be opt-in:

1. keep existing API key checks in place
2. look for `X-Athena-Auth-Session-Token` first when session auth is enabled for a route/client
3. optionally look for `X-Athena-Auth-Bearer-Token` second
4. continue accepting requests with only API-key auth until your callers are migrated

That lets you introduce DB auth based on session identity without forcing a breaking change across every SDK consumer at once.

## API key and `X-Athena-Key` examples

The SDK sends OpenAPI-aligned key headers on every authenticated request:

- `apikey`
- `x-api-key`
- `X-Api-Key`
- `X-Athena-Key`

Use `key` / `apiKey` for all three when they should match. Use `athenaKey` when only `X-Athena-Key` should differ.

```ts
const athena = createClient({
  url: ATHENA_URL,
  key: "general-key",
  athenaKey: "gateway-only-key",
  auth: {
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: accessToken,
  },
})
```

Per-call override:

```ts
await athena.from("orders").select("*", {
  apiKey: "call-key",
  athenaKey: "call-athena-key",
  headers: {
    Cookie: request.headers.get("cookie") ?? "",
  },
})
```

More examples: [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md).

## Related docs

- [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md)
- [`getting-started.md`](getting-started.md)
- [`api-reference.md`](api-reference.md)
- [`auth-client-bindings.md`](auth-client-bindings.md)
- [`complete-method-reference.md`](complete-method-reference.md)
