# Auth session cookie bridge (Next.js)

This document describes the **app-host session cookie bridge** shipped in
`@xylex-group/athena` under the Next adapter entrypoints.

## Why it exists

Athena Auth sessions are typically represented by a cookie on the **auth**
origin (for example `https://auth.example.com`). Next.js apps often run on a
different origin (`https://app.example.com`).

| Cookie location | Who can read it |
|-----------------|-----------------|
| Auth origin cookie | Browser → auth host only (normal cookie scope) |
| App origin httpOnly cookie (bridge) | Next middleware, Route Handlers, Server Components via `Cookie` header |

Without a bridge, after social or password login against the auth host:

1. The browser has a valid auth session on the auth origin.
2. Requests to the **app** host do not include that cookie.
3. Server-side Athena clients cannot see a session token in the app-host
   `Cookie` header until the bridge has written one.

The bridge is a small same-origin route on the **app** host:

1. Browser obtains session token (e.g. `auth.getSession()` after OAuth callback).
2. Browser `POST`s `{ token, expiresAt? }` to `/api/athena-auth/session` (or
   `/api/auth/session`).
3. Route sets `athena-auth.session-token` httpOnly on the app host.
4. Subsequent app-host server code can forward that cookie into Athena Auth /
   gateway clients.

This is complementary to—not a replacement for—`@xylex-group/athena-auth-ui`
proxy rewriting. Proxy mode can rewrite `Set-Cookie` onto the UI origin; the
bridge is for cases where you explicitly copy a bearer/session token into an
app-host cookie (common after social callback on a separate auth origin).

## Package exports

### Server / route handlers

```ts
import {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  ATHENA_AUTH_SESSION_COOKIE_NAMES,
  createAthenaAuthSessionBridgeHandlers,
  createAthenaAuthSessionBridgePathHandlers,
  handleAthenaAuthSessionBridgePost,
  handleAthenaAuthSessionBridgeDelete,
  isAthenaAuthSessionBridgePath,
  resolveSessionBridgePayload,
  persistAthenaAuthSessionOnAppHost,
  clearAthenaAuthSessionOnAppHost,
} from "@xylex-group/athena/next/server"
```

### Browser / client helpers

```ts
import {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  persistAthenaAuthSessionOnAppHost,
  clearAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
} from "@xylex-group/athena/next/client"
```

Client helpers no-op outside the browser (`window` absent).

## Default constants

| Constant | Default value |
|----------|----------------|
| `ATHENA_AUTH_SESSION_BRIDGE_ROUTE` | `/api/athena-auth/session` |
| `ATHENA_AUTH_SESSION_COOKIE_NAME` | `athena-auth.session-token` |
| `ATHENA_AUTH_SESSION_COOKIE_NAMES` | `session-token` and `session_token` variants |

`DELETE` clears every name in `ATHENA_AUTH_SESSION_COOKIE_NAMES` so it stays
aligned with `@xylex-group/athena/cookies` session token lookup (underscore and
hyphen forms).

## Mounting routes

### Option A — dedicated App Router file

```ts
// app/api/athena-auth/session/route.ts
import { createAthenaAuthSessionBridgeHandlers } from "@xylex-group/athena/next/server"

export const { POST, DELETE } = createAthenaAuthSessionBridgeHandlers()
```

Optional customization:

```ts
export const { POST, DELETE } = createAthenaAuthSessionBridgeHandlers({
  route: "/api/athena-auth/session",
  cookieName: "athena-auth.session-token",
  cookiePath: "/",
  sameSite: "lax",
  // secure: true, // force; default derives from request / x-forwarded-proto
})
```

### Option B — catch-all or dynamic segment under `/api/auth`

```ts
// app/api/auth/[...path]/route.ts
import { createAthenaAuthSessionBridgePathHandlers } from "@xylex-group/athena/next/server"

export const { POST, DELETE } = createAthenaAuthSessionBridgePathHandlers({
  route: "/api/auth/session",
  matchPaths: ["session"],
})
```

Also works with `app/api/auth/[path]/route.ts` when `path === "session"`.

**Important:** path handlers only implement the **session bridge**. They do not
proxy Athena Auth (`sign-in`, `get-session`, etc.). Unmatched paths return
`404 { "error": "Not found" }`. If you already have a full `/api/auth/[...all]`
proxy, either:

- keep the bridge on a **separate** path (`/api/athena-auth/session`), or
- compose: if path is `session` and method is POST/DELETE, call the bridge;
  otherwise proxy.

### Middleware allowlist

If middleware blocks unknown API routes, allow the bridge path:

```ts
// middleware matcher / public routes
"/api/athena-auth/session",
// or
"/api/auth/session",
```

## Client integration after login

```ts
import { createClient } from "@xylex-group/athena"
import {
  persistAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
  clearAthenaAuthSessionOnAppHost,
} from "@xylex-group/athena/next/client"

const client = createClient({
  url: process.env.NEXT_PUBLIC_ATHENA_URL!,
  key: process.env.NEXT_PUBLIC_ATHENA_KEY!,
  auth: { url: process.env.NEXT_PUBLIC_ATHENA_AUTH_URL! },
})

// After OAuth callback or password sign-in succeeds:
const { data, ok } = await client.auth.getSession()
if (ok) {
  await persistAthenaAuthSessionOnAppHost(resolveSessionBridgePayload(data))
}

// On sign-out:
await client.auth.signOut()
// Readable JS cookies (Athena/Better Auth prefixes):
import { clearAuthCookies } from "@xylex-group/athena/utils"
clearAuthCookies()
// httpOnly app-host bridge cookie (not always visible to document.cookie):
await clearAthenaAuthSessionOnAppHost()
```

Do **not** reimplement a local `clearAuthCookies` loop — use the exported helper
from `@xylex-group/athena/utils` (or `@xylex-group/athena/next/client`).

### `resolveSessionBridgePayload`

Accepts a get-session-like object:

```ts
{
  session?: { token?: string | null; expiresAt?: string | null } | null
  token?: string | null
}
```

Returns `{ token, expiresAt? }` or `null` if no non-empty token exists.

## HTTP API reference

### `POST` bridge route

**Request**

```http
POST /api/athena-auth/session
Content-Type: application/json

{
  "token": "session_…",
  "expiresAt": "2030-01-01T00:00:00.000Z"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `token` | yes | Non-empty session token string (trimmed) |
| `expiresAt` | no | ISO-8601 date string used as cookie `Expires` |

**Responses**

| Status | Body | Side effect |
|--------|------|-------------|
| `200` | `{ "ok": true, "route": "…" }` | Sets httpOnly session cookie |
| `400` | `{ "error": "Missing Athena Auth session token" }` | None |

Cookie attributes (defaults):

- `HttpOnly`
- `Path=/`
- `SameSite=Lax`
- `Secure` when the request is HTTPS or `x-forwarded-proto` starts with `https`
- `Expires` from `expiresAt` when parseable

### `DELETE` bridge route

**Request**

```http
DELETE /api/athena-auth/session
```

**Response**

| Status | Body | Side effect |
|--------|------|-------------|
| `200` | `{ "ok": true, "route": "…" }` | Expires all configured cookie name variants |

## Using the cookie on the server

```ts
import { createAthenaServerClient } from "@xylex-group/athena/next/server"

export async function loadServerClient(
  session?: { user?: { id: string }; session?: { id: string; activeOrganizationId?: string | null } } | null,
) {
  // Without explicit requestHeaders/requestCookies, the factory loads
  // next/headers on every invocation and merges cookie + Authorization.
  return createAthenaServerClient({
    url: process.env.ATHENA_URL!,
    key: process.env.ATHENA_API_KEY!,
    session,
  })
}

// Or pass explicit request inputs (tests, Route Handlers with a Request):
export async function loadServerClientFromRequest(request: Request) {
  return createAthenaServerClient({
    url: process.env.ATHENA_URL!,
    key: process.env.ATHENA_API_KEY!,
    requestHeaders: request.headers,
    requestCookies: request.headers.get("cookie"),
  })
}
```

Require either `{ url, key }` or `{ env }` — there is no zero-argument factory.
The bridge’s job is only to **populate** the app-host cookie so the resolved
request context can forward it; `createAthenaServerClient` still delegates to
`createClient` and does not cache request-scoped clients.

## Security considerations

1. **No server-side token validation in the bridge** — the route trusts the
   JSON body. Only call `persistAthenaAuthSessionOnAppHost` after a successful
   auth flow you control.
2. **httpOnly** — JavaScript on the page cannot read the bridged cookie (unlike
   some UI “pending token” cookies).
3. **CSRF** — SameSite=Lax reduces cross-site POST risks for top-level navigations;
   still avoid exposing the bridge to untrusted third-party origins.
4. **HTTPS** — use TLS in production so `Secure` is set and tokens are not sent
   in cleartext.
5. **Logout** — always pair `auth.signOut()` with `clearAthenaAuthSessionOnAppHost()`
   so the app-host cookie does not outlive the auth session.

## Source layout

```
src/next/session-bridge/
  constants.ts   # default route + cookie names
  types.ts       # options + payload types
  payload.ts     # resolveSessionBridgePayload
  cookie.ts      # Set-Cookie serialization, secure detection
  client.ts      # browser persist / clear
  handlers.ts    # POST/DELETE + factory + path matching
  index.ts       # public re-exports
  README.md      # short package-local guide
```

## Middleware: detect an existing session cookie

Use `hasAuthSessionCookie` when you only need a boolean “is there a session
cookie on this request?” check (no token extraction):

```ts
import { hasAuthSessionCookie } from "@xylex-group/athena/cookies"
// also: @xylex-group/athena/utils  and  @xylex-group/athena/next/server

export function middleware(request: Request) {
  if (!hasAuthSessionCookie(request.headers.get("cookie"))) {
    return Response.redirect(new URL("/sign-in", request.url))
  }
}
```

`SESSION_COOKIE_PATTERNS` matches (with optional `__Secure-` prefix):

| Pattern family | Cookie name forms |
|----------------|-------------------|
| Better Auth | `better-auth.session_token`, `better-auth-session_token` |
| Athena Auth | `athena-auth.session-token`, `athena-auth-session-token` |

This is a **presence** check only. Use `getSessionCookie(request)` from
`@xylex-group/athena/cookies` when you need the actual token value.

## Compatibility

- Bridge handlers are additive; they return standard Web `Response` objects
  (compatible with Next.js App Router without importing `next/server` inside
  the bridge implementation).
- Thin construction façades live beside the bridge on the same entrypoints:
  `createAthenaBrowserClient` (`next/client`) and `createAthenaServerClient`
  (`next/server`). Both always call root `createClient` (ADR 0014).
- Works with edge and Node runtimes that implement `fetch` / `Request` / `Response`.

## Related docs

- [Next.js integration](./next-js.md) — browser/server façades and context rules
- [Auth session forwarding](./auth-session-forwarding.md) — session → gateway context
- [Getting started](./getting-started.md) — first client setup
- [ADR 0014](./adr/0014-next-client-construction-facades.md) — façade contract
- Platform docs: `/docs/sdks/athena-js/auth/session-bridge`
- Auth UI proxy cookies: `/docs/sdks/athena-auth-ui/auth-proxy-routing-and-cookies`
