# `@xylex-group/athena/utils` and shared helpers

This page is the **single implementation map** for helpers apps often reimplement
locally. Prefer these exports over app copies of `asString`, auth URL resolution,
cookie detection, admin role checks, and request-header builders.

Related package docs:

| Topic | Page |
|-------|------|
| Auth base / request URLs | [`athena-auth-url.md`](athena-auth-url.md) |
| Auth UI routes / views | [`auth-routes.md`](auth-routes.md) |
| Browser cookie clear | [`auth-cookies.md`](auth-cookies.md) |
| Session bridge (Next) | [`auth-session-bridge.md`](auth-session-bridge.md) |
| Request headers cookbook | [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md) |
| Column / table IntelliSense | [`typecheck-columns.md`](typecheck-columns.md) |
| Org membership patterns | [`organization-membership.md`](organization-membership.md) |
| Admin role helpers | [`auth/admin.mdx`](auth/admin.mdx) |

## Import map

```ts
// Coercions
import {
  asString,
  asRecord,
  asBoolean,
  asBooleanOrNull,
  asNumber,
  asStringArray,
  asIdentifier,
  firstString,
  readTrimmedString,
  getOriginFromHeaders,
  isDynamicServerUsageError,
} from "@xylex-group/athena/utils"

// Auth URLs (one implementation — do not wrap with *Primitive locals)
import {
  resolveAthenaAuthClientBaseUrl,
  resolveAthenaAuthUpstreamUrl,
  resolveAthenaAuthRequestUrl,
  resolveEmailVerificationCallbackUrl,
  createFreshSessionLookupUrl,
  readAthenaAuthUpstreamUrlFromEnv,
  normalizeAthenaAuthBaseUrl,
  isAbsoluteUrl,
  requireEnv,
  readEnv,
  ATHENA_AUTH_PATH,
  ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH,
  ATHENA_SESSION_DATA_HEADER,
} from "@xylex-group/athena/utils"

// Cookies / session presence
import {
  clearAuthCookies,
  hasAuthSessionCookie,
  ATHENA_AUTH_COOKIE_PREFIXES,
} from "@xylex-group/athena/utils"
// or from "@xylex-group/athena/cookies" for cookie-focused APIs

// Request headers
import {
  buildAthenaGatewayHeaders,
  buildAthenaRequestHeaders,
} from "@xylex-group/athena/utils"

// Admin
import {
  hasAdminRole,
  hasAdminPermission,
  resolveAdminPermission,
} from "@xylex-group/athena/admin"

// Active organization bootstrap
import { ensureActiveOrganization } from "@xylex-group/athena/organization"
```

## Rule: one implementation

| Do | Don't |
|----|--------|
| Import from `@xylex-group/athena/utils` (or `/admin`, `/cookies`, `/next/*`) | Copy `asString` / auth URL / `hasAdminRole` into `lib/` |
| Thin app policy only (e.g. “no cookie and not dev → null”) | Re-export SDK as `*Primitive` wrappers |
| Set `client` on `createClient` for `X-Athena-Client` | Hand-roll `buildHeaders` that only sets that header |

If Auth UI and the app both need the same helper, the SDK is the shared home —
not a third copy in the monorepo app.

---

## Coercions

Safe parsers for untrusted JSON / env / gateway rows.

### `asString` / `readTrimmedString` / `asNonEmptyString`

```ts
asString("  hi  ")     // "hi"
asString("")           // null
asString(42)           // "42"  (finite number / bigint coerced)
asString(null)         // null

readTrimmedString(42)  // null  (strings only)
readTrimmedString(" x ") // "x"

asNonEmptyString("  hi  ") // "hi"
asNonEmptyString("")       // undefined
asNonEmptyString(42)       // undefined  (strings only)
```

| Helper | Coerces numbers? | Empty / missing |
|--------|------------------|-----------------|
| `asString` | yes | `null` |
| `readTrimmedString` | no | `null` |
| `asNonEmptyString` | no | `undefined` |

Use `asNonEmptyString` for optional fields and `value ?? default` style code.

### `asRecord`

```ts
asRecord({ a: 1 })     // { a: 1 }
asRecord([1, 2])       // null
asRecord(null)         // null
// → Record<string, unknown> | null
```

### Other coercions

| Helper | Behavior |
|--------|----------|
| `asBoolean` | loose truthy tokens (`true`/`1`/`yes`/…) → boolean |
| `asBooleanOrNull` | same tokens or `null` if unknown |
| `asNumber` | finite number or parseable string |
| `asStringArray` | array of non-empty trimmed strings |
| `asIdentifier` | string or finite number/bigint as string |
| `firstString(record, keys)` | first non-empty `asString` among keys |

---

## Auth URL resolution (do not duplicate)

Full reference: [`athena-auth-url.md`](athena-auth-url.md).

**Product routing (proxy vs direct upstream)** lives in
`@xylex-group/athena-auth-ui` — especially `createAthenaAuthClient`,
`appendAuthPath: false`, and `auth/routing-debug` (see next-heroui-example).
Do not hardcode “always `/api/auth`” when the app uses **direct-upstream**.

### Mental model

```text
Env keys (ordered)
  → upstream origin                    resolveAthenaAuthUpstreamUrl
  → client base                        resolveAthenaAuthClientBaseUrl
       appendAuthPath: true  → often …/api/auth (proxy)
       appendAuthPath: false → direct upstream URL as configured
  → request URL (base + path)          resolveAthenaAuthRequestUrl
  → fresh get-session (app origin)     createFreshSessionLookupUrl  (proxy-oriented)
```

### Minimal usage

```ts
// Browser-facing auth client base (reads process.env when omitted)
// Proxy default (append /api/auth when needed):
const authBase = resolveAthenaAuthClientBaseUrl()

// Direct upstream (no forced /api/auth):
const directBase = resolveAthenaAuthClientBaseUrl(
  process.env.NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL,
  undefined,
  { appendAuthPath: false },
)

// Absolute route under that base
const getSession = resolveAthenaAuthRequestUrl("get-session", authBase)

// App-origin proxy path + disableCookieCache=true (same-origin proxy mode)
const fresh = createFreshSessionLookupUrl("https://app.example.com")
// → https://app.example.com/api/auth/get-session?disableCookieCache=true
// In direct-upstream mode, prefer authClient.getSession / useSession against the
// resolved absolute auth base instead of the app-origin proxy path.
```

### Env key order

`ATHENA_AUTH_UPSTREAM_URL` → `ATHENA_AUTH_URL` → `NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL` → `NEXT_PUBLIC_ATHENA_AUTH_URL`.

### Delete local stacks like this

```ts
// ❌ App reimplementation
function resolveAthenaAuthClientBaseUrl(...) {
  return resolveAthenaAuthClientBaseUrlPrimitive(...)
}
```

Import the SDK function only.

---

## Session cookie presence

**Full write-up:** [`auth-cookies.md`](auth-cookies.md) → *Session cookie presence*.

```ts
import {
  SESSION_COOKIE_PATTERNS,
  hasAuthSessionCookie,
} from "@xylex-group/athena/cookies"
// also: @xylex-group/athena/utils , @xylex-group/athena/next/server

if (!hasAuthSessionCookie(request.headers.get("cookie"))) {
  // no session token cookie (Athena Auth or Better Auth naming)
}
```

SDK patterns (do **not** copy into the app):

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

- **Presence only** — not token validation (`getSessionCookie` for the value).
- Prefer over `cookie.includes("athena-auth")`.

### App policy example (keep thin)

```ts
function resolveAuthBaseUrl(headersList: Headers): string | null {
  const cookie = headersList.get("cookie")
  if (!(hasAuthSessionCookie(cookie) || isDev)) {
    return null
  }
  return resolveAthenaAuthClientBaseUrl(process.env)
}
```

`isDev` stays app-local. Cookie + URL resolution stay SDK.

### Re-export phase

```ts
export {
  SESSION_COOKIE_PATTERNS,
  hasAuthSessionCookie,
} from "@xylex-group/athena/cookies"
```

---

## Admin role

```ts
import { hasAdminRole } from "@xylex-group/athena/admin"

hasAdminRole(session) // true for "admin", "ADMIN", "member, admin", …
```

Same semantics as the common app helper: comma-separated `session.user.role`,
case-insensitive. For permission API checks use `hasAdminPermission` /
`resolveAdminPermission`.

---

## `X-Athena-Client` and request headers

### Prefer client config

```ts
createClient({
  url,
  key,
  client: "web-dashboard", // sets X-Athena-Client on SDK requests
})
```

### Raw fetch / non-client surfaces

```ts
import {
  buildAthenaGatewayHeaders,
  buildAthenaRequestHeaders,
} from "@xylex-group/athena/utils"

// Minimal client + API key headers (safe drop-in for app-local helpers)
const simple = buildAthenaGatewayHeaders({
  clientName: "web-dashboard",
  gatewayKey: apiKey,
  headers: { "X-Request-Id": id },
})

const headers = buildAthenaRequestHeaders({
  profile: "minimal", // or gateway | auth | chat | storage
  sdkHeaderValue: "my-app",
  client: "web-dashboard",
  callHeaders: { "X-Request-Id": id },
})
```

Delete local:

```ts
// ❌
function buildHeaders(extra?) {
  return { "X-Athena-Client": appConfig.athena.clientName, ...extra }
}
```

Full header map: [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md).

---

## Next / request helpers (SDK)

```ts
import {
  getOriginFromHeaders,
  isDynamicServerUsageError,
} from "@xylex-group/athena/utils"

if (isDynamicServerUsageError(error)) throw error // let Next mark route dynamic

const origin = getOriginFromHeaders(headersList, {
  preferHttpWhenMissingProto: process.env.NODE_ENV !== "production",
})
```

| Helper | Guidance |
|--------|----------|
| `isDynamicServerUsageError` | Catch around `headers()` / session load in RSC |
| `getOriginFromHeaders` | Origin / forwarded host+proto reconstruction |
| `proxyRequestHeaders` | **Write** forwarded headers when proxying to auth |
| `normalizeOrganizationIds` | Pure array util — fine local, not SDK |

---

## Quick migration checklist

1. Replace local `asString` / `asRecord` with `@xylex-group/athena/utils`.
2. Delete auth-url `*Primitive` wrappers; import SDK resolvers only.
3. Replace cookie `includes("athena-auth")` / local `SESSION_COOKIE_PATTERNS` with `hasAuthSessionCookie` from `@xylex-group/athena/cookies`.
4. Replace local `hasAdminRole` with `@xylex-group/athena/admin`.
5. Set `client` on `createClient`; drop `buildHeaders` for Athena traffic.
6. Use `createFreshSessionLookupUrl` for cache-busted get-session on the app origin.
7. Use `models` for automatic table/column IntelliSense — see [`typecheck-columns.md`](typecheck-columns.md).
