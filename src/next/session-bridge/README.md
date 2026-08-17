# Session cookie bridge (`@xylex-group/athena/next/*`)

HttpOnly **app-host** cookie bridge for Athena Auth session tokens.

When the browser signs in against an auth origin that differs from your Next.js
app origin, middleware and Server Components on the **app** host cannot read
the auth host’s session cookie. This bridge lets the browser POST the session
token to a same-origin route; the route sets an httpOnly cookie on the app host.

## Import map

| Surface | Package path |
|---------|----------------|
| Route handlers | `@xylex-group/athena/next/server` |
| Browser client helpers | `@xylex-group/athena/next/client` |

## Quick start

### Dedicated route

```ts
// app/api/athena-auth/session/route.ts
import { createAthenaAuthSessionBridgeHandlers } from "@xylex-group/athena/next/server"

export const { POST, DELETE } = createAthenaAuthSessionBridgeHandlers()
```

### Catch-all under `/api/auth/[...path]`

```ts
// app/api/auth/[...path]/route.ts
import { createAthenaAuthSessionBridgePathHandlers } from "@xylex-group/athena/next/server"

export const { POST, DELETE } = createAthenaAuthSessionBridgePathHandlers({
  route: "/api/auth/session",
})
```

Only paths whose final segment is `session` (configurable) are handled; other
paths return `404`.

### After login (browser)

```ts
import {
  persistAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
  clearAthenaAuthSessionOnAppHost,
} from "@xylex-group/athena/next/client"

const session = await auth.getSession()
await persistAthenaAuthSessionOnAppHost(resolveSessionBridgePayload(session.data))

// on sign-out
await clearAthenaAuthSessionOnAppHost()
```

## HTTP contract

### `POST`

**Body:** `{ "token": string, "expiresAt"?: string }`

**Success:** `200` `{ "ok": true, "route": "<configured route>" }`  
Sets httpOnly cookie `athena-auth.session-token` (name configurable).

**Error:** `400` when `token` is missing or blank.

### `DELETE`

**Success:** `200` `{ "ok": true, "route": "..." }`  
Clears both `athena-auth.session-token` and `athena-auth.session_token`.

## Middleware presence check

```ts
import { hasAuthSessionCookie } from "@xylex-group/athena/cookies"

if (!hasAuthSessionCookie(request.headers.get("cookie"))) {
  // redirect to sign-in
}
```

Also exported from `@xylex-group/athena/utils` and `@xylex-group/athena/next/server`.

## Security notes

- Cookie is **httpOnly**, **SameSite=Lax**, **Secure** on HTTPS (and when
  `x-forwarded-proto` is `https`).
- The bridge does **not** validate the token with Athena Auth; it only mirrors
  a token the client already obtained. Prefer calling it only after a trusted
  `get-session` / sign-in success on your app.
- Use HTTPS in production so the Secure flag is active.

## Related

- Full docs: `docs/auth-session-bridge.md` in this package
- Platform docs app: `/docs/sdks/athena-js/auth/session-bridge`
- Cookie helpers: `@xylex-group/athena/cookies`
- Session API: `createClient(...).auth.getSession()`
