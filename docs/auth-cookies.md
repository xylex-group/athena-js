# Auth browser cookies (`clearAuthCookies`)

Browser helpers for detecting and clearing Athena Auth / Better Auth cookies
on the **current document origin**.

| Import | Package path |
|--------|----------------|
| Clear + prefixes | `@xylex-group/athena/utils` |
| Same (Next client) | `@xylex-group/athena/next/client` |
| Presence check | `@xylex-group/athena/cookies` (`hasAuthSessionCookie`) |
| Read token from request | `@xylex-group/athena/cookies` (`getSessionCookie`) |
| httpOnly app-host bridge | `@xylex-group/athena/next/client` (`clearAthenaAuthSessionOnAppHost`) |

**Do not reimplement** a local `document.cookie` loop. Use the exported helpers.

---

## Why this exists

After sign-in, the browser may hold several cookies:

1. **Auth-origin session cookie** — set by Athena Auth / Better Auth on the
   auth host (or rewritten onto the UI host via a proxy).
2. **JS-readable leftovers** — some flows leave non-httpOnly cookies or
   legacy names that `document.cookie` can still see.
3. **App-host bridge cookie** — optional httpOnly cookie written by
   [`auth-session-bridge.md`](./auth-session-bridge.md) (`athena-auth.session-token`).

A correct **sign-out** usually needs:

1. Server-side session revoke (`authClient.signOut()` / `client.auth.signOut()`).
2. **`clearAuthCookies()`** — wipe JS-visible Athena/Better Auth cookies.
3. Optionally **`clearAthenaAuthSessionOnAppHost()`** — DELETE the bridge route
   so the httpOnly app-host cookie dies (not always visible to `document.cookie`).

---

## Auth namespace type (React / UI)

```ts
import type { AthenaClient } from "@xylex-group/athena"

function readSession(client: AthenaClient) {
  return client.auth.getSession()
}
```

`AthenaClient["auth"]` is the stable auth surface.

## Import

```ts
import {
  ATHENA_AUTH_COOKIE_PREFIXES,
  clearAuthCookies,
  type ClearAuthCookiesOptions,
} from "@xylex-group/athena/utils"

// Convenience re-export for Next client apps:
import {
  ATHENA_AUTH_COOKIE_PREFIXES,
  clearAuthCookies,
} from "@xylex-group/athena/next/client"
```

---

## Constants

### `ATHENA_AUTH_COOKIE_PREFIXES`

```ts
export const ATHENA_AUTH_COOKIE_PREFIXES = [
  "athena-auth",
  "__Secure-athena-auth",
  "better-auth",
  "__Secure-better-auth",
] as const
```

Any cookie name that **starts with** one of these prefixes is eligible for
clearing (for example `athena-auth.session_token`,
`athena-auth.session-token`, `__Secure-athena-auth.session_token`,
`better-auth.session_token`, chunked names like `athena-auth.session_data.0`).

`DEFAULT_AUTH_COOKIE_PREFIXES` is a deprecated alias of the same array.

---

## Session cookie **presence** (`hasAuthSessionCookie`)

Middleware / edge guards often only need to know whether a request **looks**
like it carries a session token cookie — without parsing the full cookie map
or validating the token.

**Do not reimplement** local regex lists. Use the SDK export (same patterns as
the snippet apps often copy).

### Import

```ts
import {
  SESSION_COOKIE_PATTERNS,
  hasAuthSessionCookie,
} from "@xylex-group/athena/cookies"

// Also re-exported from:
import { hasAuthSessionCookie, SESSION_COOKIE_PATTERNS } from "@xylex-group/athena/utils"
import { hasAuthSessionCookie } from "@xylex-group/athena/next/server"
```

### `SESSION_COOKIE_PATTERNS`

```ts
export const SESSION_COOKIE_PATTERNS = [
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/,
  /(?:^|;\s*)(?:__Secure-)?better-auth-session_token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth\.session-token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth-session-token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth\.session_token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth-session_token=/,
] as const
```

Covers:

| Family | Cookie name forms |
|--------|-------------------|
| Better Auth | `better-auth.session_token`, `better-auth-session_token` |
| Athena Auth (hyphen) | `athena-auth.session-token`, `athena-auth-session-token` |
| Athena Auth (underscore / default helper) | `athena-auth.session_token`, `athena-auth-session_token` |
| HTTPS prefix | Optional `__Secure-` on any of the above |

Each pattern requires a cookie-header boundary (`^` or `; `) and a trailing
`=` so bare name fragments do not false-positive.

### `hasAuthSessionCookie(cookieHeader)`

```ts
function hasAuthSessionCookie(
  cookieHeader: string | null | undefined,
): boolean
```

- Returns `false` when the header is missing/empty.
- Returns `true` if **any** `SESSION_COOKIE_PATTERNS` entry matches.
- **Presence only** — does **not** validate value, signature, or expiry.
- Prefer `getSessionCookie` when you need the actual token string.

### Middleware example

```ts
import { hasAuthSessionCookie } from "@xylex-group/athena/cookies"

export function middleware(request: Request) {
  if (!hasAuthSessionCookie(request.headers.get("cookie"))) {
    return Response.redirect(new URL("/sign-in", request.url))
  }
  // continue
}
```

### Prefer over substring checks

```ts
// ❌ Too broad (matches non-session cookies / false positives)
cookie?.includes("athena-auth")

// ✅ Session-token shaped names only
hasAuthSessionCookie(cookie)
```

### App re-export phase

```ts
// app/lib/auth-session-cookie.ts — keep stable import path while migrating
export {
  SESSION_COOKIE_PATTERNS,
  hasAuthSessionCookie,
} from "@xylex-group/athena/cookies"
```

Then delete the local module once call sites import the package directly.

### Related

| Goal | API |
|------|-----|
| Clear JS-visible cookies | `clearAuthCookies()` (below) |
| Read token value | `getSessionCookie` from `@xylex-group/athena/cookies` |
| Clear httpOnly bridge cookie | `clearAthenaAuthSessionOnAppHost` |
| Resolve auth base only when cookie present | App policy + `hasAuthSessionCookie` + `resolveAthenaAuthClientBaseUrl` |

---

## `clearAuthCookies(options?)`

### Signature

```ts
function clearAuthCookies(options?: ClearAuthCookiesOptions): string[]

interface ClearAuthCookiesOptions {
  /** Name prefixes to clear. Default: ATHENA_AUTH_COOKIE_PREFIXES */
  prefixes?: string[]
  /** Hostname for domain candidates. Default: window.location.hostname */
  hostname?: string
  /** Cookie path when expiring. Default: `/` */
  path?: string
  /** Cookie header to scan (tests). Default: document.cookie */
  cookieHeader?: string
}
```

### Behavior

1. **SSR-safe** — if `document` is missing, returns `[]` and does nothing.
2. Reads `document.cookie` (or `options.cookieHeader`).
3. Collects cookie **names** that start with any configured prefix.
4. For each name, writes an expired cookie:
   - `expires=Thu, 01 Jan 1970 00:00:00 GMT`
   - `Max-Age=0`
   - `path=<path>`
5. For non-local hostnames, also expires the same name with **domain
   candidates** (exact host and parent domains, with and without a leading
   `.`) so subdomain deployments do not leave parent-domain cookies behind.
6. Returns the list of names that were targeted.

### Domain candidate examples

| `hostname` | Domain attributes attempted (in addition to host-only) |
|------------|--------------------------------------------------------|
| `localhost` | *(none — host-only clear only)* |
| `app.example.com` | `app.example.com`, `.app.example.com`, `example.com`, `.example.com` |
| `app.eu.example.com` | host + each parent segment with/without `.` |

Local / loopback hostnames use `isLocalHostname(...)` and skip domain
attributes so browsers do not reject clears with illegal `Domain=localhost`.

### Return value

Array of cookie **names** matched and expired. Empty array when:

- not in a browser
- no cookies
- no names matched the prefixes

---

## Recommended `signOut` helper

```ts
import { clearAuthCookies } from "@xylex-group/athena/utils"
import { clearAthenaAuthSessionOnAppHost } from "@xylex-group/athena/next/client"

const AUTH_ROUTES = { signIn: "/sign-in" } as const

export async function signOut(options?: { redirect?: boolean }) {
  try {
    await authClient.signOut({
      fetchOptions: {
        throw: true,
      },
    })
  } catch (error) {
    console.error("[auth] Sign out failed:", error)
  } finally {
    // 1) JS-visible Athena / Better Auth cookies
    clearAuthCookies()

    // 2) httpOnly app-host bridge cookie (if you mounted the bridge)
    try {
      await clearAthenaAuthSessionOnAppHost()
    } catch (error) {
      console.error("[auth] Session bridge clear failed:", error)
    }

    if (options?.redirect !== false && typeof window !== "undefined") {
      window.location.href = AUTH_ROUTES.signIn
    }
  }
}
```

Always clear cookies in `finally` so a failed network `signOut` still removes
local session material.

---

## What this does **not** clear

| Cookie / storage | Why | What to use instead |
|------------------|-----|---------------------|
| httpOnly cookie only on the **auth** origin | Not on this document origin | Server `signOut` / revoke on auth host |
| httpOnly **app-host bridge** cookie | Often not listed in `document.cookie` | `clearAthenaAuthSessionOnAppHost()` |
| `localStorage` / session storage keys | Not cookies | App-specific cleanup |
| Arbitrary third-party cookies | Prefix filter | Custom `prefixes` or separate logic |

---

## Related helpers (do not confuse)

### Presence check (middleware)

```ts
import { hasAuthSessionCookie } from "@xylex-group/athena/cookies"

if (!hasAuthSessionCookie(request.headers.get("cookie"))) {
  // no session-looking cookie on the request
}
```

`hasAuthSessionCookie` only tests **request** `Cookie` headers against
regexes for known session cookie **assignments**. It does not mutate cookies.

See [auth-session-bridge.md](./auth-session-bridge.md#middleware-detect-an-existing-session-cookie).

### Read token on the server

```ts
import { getSessionCookie } from "@xylex-group/athena/cookies"

const token = getSessionCookie(request)
// or getSessionCookie(request.headers)
```

### Session bridge clear (httpOnly app host)

```ts
import { clearAthenaAuthSessionOnAppHost } from "@xylex-group/athena/next/client"

await clearAthenaAuthSessionOnAppHost()
// DELETE /api/athena-auth/session by default
```

### Comparison matrix

| Goal | API |
|------|-----|
| Wipe JS cookies after sign-out | `clearAuthCookies()` |
| Wipe httpOnly bridge cookie | `clearAthenaAuthSessionOnAppHost()` |
| Middleware: “is there a session cookie?” | `hasAuthSessionCookie(header)` |
| Server: read session token from request | `getSessionCookie(request)` |
| Set bridge cookie after login | `persistAthenaAuthSessionOnAppHost(...)` |

---

## Options cookbook

### Custom prefixes only

```ts
clearAuthCookies({
  prefixes: ["athena-auth", "__Secure-athena-auth"],
})
```

### Force hostname (tests or multi-host shells)

```ts
clearAuthCookies({ hostname: "app.example.com" })
```

### Custom path (rare)

```ts
clearAuthCookies({ path: "/app" })
```

### Unit tests without a real browser

```ts
// Prefer the package tests’ document mock pattern, or pass cookieHeader
// together with a mocked document.cookie setter.
clearAuthCookies({
  cookieHeader: "athena-auth.session_token=abc; other=1",
  hostname: "localhost",
})
```

---

## Anti-patterns

```ts
// ❌ Do not copy a local loop — it drifts from domain/parent cleanup
const ATHENA_AUTH_COOKIE_PREFIXES = [/* ... */]
function clearAuthCookies() { /* document.cookie = ... */ }

// ✅
import { clearAuthCookies } from "@xylex-group/athena/utils"
clearAuthCookies()
```

```ts
// ❌ Only clearAuthCookies after bridge-based login
// leaves httpOnly athena-auth.session-token on the app host

// ✅
clearAuthCookies()
await clearAthenaAuthSessionOnAppHost()
```

---

## Source

- Implementation: `src/utils/auth-cookies.ts`
- Tests: `test/utils.test.ts` (`clearAuthCookies *`)
- Exports: `src/utils/index.ts`, re-export `src/next/client.ts`

## Related docs

- [Auth session bridge](./auth-session-bridge.md)
- [Auth session forwarding](./auth-session-forwarding.md)
- [Athena Auth URL helpers](./athena-auth-url.md)
- Platform docs: `/docs/sdks/athena-js/auth/clear-auth-cookies`
