# Athena Auth URL helpers

Shared URL resolution for Athena Auth base and upstream hosts, exported from
`@xylex-group/athena/utils`.

Aligned with Athena Auth UI (`base-url.ts`) so apps, the SDK, and UI packages
share the same env key order and normalization rules.

## One implementation only

These helpers are the **canonical** implementation for apps, Auth UI, and the
SDK. Do **not** keep a local `*Primitive` reimplementation or thin wrapper that
re-exports the same logic under different names — import from
`@xylex-group/athena/utils` (or the re-export at
`@xylex-group/athena-auth-ui/athena/base-url`) directly.

See also the migration map in [`utils-and-helpers.md`](utils-and-helpers.md).

## Two routing modes (proxy vs direct upstream)

Athena Auth does **not** always need a same-origin `baseUrl` of `/api/auth`.

| Mode | Browser talks to | Typical config |
|------|------------------|----------------|
| **Proxy** (default) | App origin `/api/auth/*` → your Next route proxies upstream | `appendAuthPath: true`, `authUrl: "/api/auth"` |
| **Direct upstream** | Hosted Athena Auth origin (cookies on auth domain) | `appendAuthPath: false`, absolute `ATHENA_AUTH_UPSTREAM_URL` / public upstream |

`@xylex-group/athena-auth-ui` already owns the product seam for this:

- `createAthenaAuthClient({ baseUrl, appendAuthPath, upstreamUrl })`
- `resolveAthenaAuthClientBaseUrl(url, upstream, { appendAuthPath: false })`
- `@xylex-group/athena-auth-ui/auth/routing-debug` + **Auth routing debug overlay**
- Reference app: `athena-auth-ui/examples/next-heroui-example`
  - env: `ATHENA_AUTH_ROUTING_MODE=direct-upstream`
  - `src/lib/auth-routing.ts` switches proxy vs direct for browser + server clients

### Direct upstream (auth-ui)

```ts
import { createAthenaAuthClient } from "@xylex-group/athena-auth-ui/athena/client"
import { resolveAthenaAuthClientBaseUrl } from "@xylex-group/athena-auth-ui/athena/base-url"

// Absolute upstream — no forced /api/auth append
const authBaseUrl = resolveAthenaAuthClientBaseUrl(
  "https://auth.example.com", // or env upstream
  undefined,
  { appendAuthPath: false },
)

const authClient = createAthenaAuthClient({
  baseUrl: authBaseUrl,
  appendAuthPath: false,
  // or pass upstreamUrl and let the client resolve
})
```

When the host is **localhost** and auth is hosted, direct-upstream avoids
setting session cookies on localhost that the auth host would reject. Prefer
the example app’s `ATHENA_AUTH_ROUTING_MODE` + routing-debug shell rather than
hardcoding only `/api/auth` in every sample.

**Full guide:** [`auth-routing-proxy-and-direct-upstream.md`](auth-routing-proxy-and-direct-upstream.md)
(tables, session checklist, package ownership, decision tree, next-heroui-example).

### Proxy mode (still valid)

Same-origin `/api/auth` + Next `createAthenaAuthProxyHandlers` is still the
default for many apps (and for middleware that reads app-host cookies / session
bridge).

## Import

```ts
import {
  ATHENA_AUTH_PATH,
  ATHENA_AUTH_UPSTREAM_ENV_KEYS,
  ATHENA_AUTH_GET_SESSION_PATH,
  ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH,
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
  ATHENA_SESSION_DATA_HEADER,
  DEFAULT_ATHENA_AUTH_ORIGIN,
  createFreshSessionLookupUrl,
  isAbsoluteUrl,
  normalizeAthenaAuthBaseUrl,
  readAthenaAuthUpstreamUrlFromEnv,
  readEnv,
  requireEnv,
  resolveAthenaAuthClientBaseUrl,
  resolveAthenaAuthRequestUrl,
  resolveAthenaAuthUpstreamUrl,
  resolveEmailVerificationCallbackUrl,
} from "@xylex-group/athena/utils"
```

## `requireEnv` / `readEnv`

Generic “first non-empty env key wins” helpers (any keys, not only auth):

```ts
const databaseUrl = requireEnv(["DATABASE_URL", "PG_URL"])

const authUrl = requireEnv([
  "ATHENA_AUTH_UPSTREAM_URL",
  "ATHENA_AUTH_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_URL",
])

// soft variant — undefined when missing
const maybeKey = readEnv(["ATHENA_API_KEY", "NEXT_PUBLIC_ATHENA_API_KEY"])
```

| Function | Missing keys |
|----------|----------------|
| `requireEnv(names, env?)` | throws `Missing required environment variable. Expected one of: …` |
| `readEnv(names, env?)` | returns `undefined` |

Optional second argument is an env map (defaults to `process.env`); useful in tests.

## Env keys (precedence)

```ts
export const ATHENA_AUTH_UPSTREAM_ENV_KEYS = [
  "ATHENA_AUTH_UPSTREAM_URL",
  "ATHENA_AUTH_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_URL",
] as const

// Auth UI naming alias (same array):
// ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES
```

Server-only keys are preferred over `NEXT_PUBLIC_*`.

## Functions

| Function | Role |
|----------|------|
| `readAthenaAuthUpstreamUrlFromEnv(env)` | First non-empty env value |
| `isAbsoluteUrl(value)` | `http://` or `https://` |
| `normalizeAthenaAuthBaseUrl(urlOrPath)` | Ensure `/api/auth` on path |
| `resolveAthenaAuthUpstreamUrl(input?)` | Server origin **without** `/api/auth` |
| `resolveAthenaAuthClientBaseUrl(base?, upstream?, opts?)` | Browser/client base (default appends `/api/auth`) |
| `resolveAthenaAuthRequestUrl(path, base?)` | Absolute URL for a relative auth path |
| `resolveEmailVerificationCallbackUrl(base?)` | Absolute `…/api/auth/verify-email` for `callbackURL` |
| `ATHENA_AUTH_VERIFY_EMAIL_PATH` | `"verify-email"` |

### Email verification callback

Replace local wrappers like:

```ts
// ❌ app-local (and avoid caching at module load if env can change)
import { resolveAthenaAuthRequestUrl } from "./athena-auth-ui/base-url"
const verifyEmailCallbackUrl = resolveAthenaAuthRequestUrl("verify-email")
export function resolveEmailVerificationCallbackUrl() {
  return verifyEmailCallbackUrl
}
```

with the SDK export (resolved at **call time**):

```ts
import { resolveEmailVerificationCallbackUrl } from "@xylex-group/athena/utils"

export function resolveEmailVerificationCallbackUrlApp() {
  return resolveEmailVerificationCallbackUrl()
  // or pass env explicitly:
  // return resolveEmailVerificationCallbackUrl(process.env)
}

// sign-up / resend verification
await client.auth.signUp.email({
  email,
  password,
  name,
  callbackURL: resolveEmailVerificationCallbackUrl(),
})
```

### Examples

```ts
resolveAthenaAuthUpstreamUrl("https://auth.example.com/api/auth")
// => "https://auth.example.com"

resolveAthenaAuthClientBaseUrl("https://auth.example.com")
// => "https://auth.example.com/api/auth"

resolveAthenaAuthClientBaseUrl("https://auth.example.com/direct", undefined, {
  appendAuthPath: false,
})
// => "https://auth.example.com/direct"

resolveAthenaAuthRequestUrl("get-session", "https://auth.example.com")
// => "https://auth.example.com/api/auth/get-session"

resolveAthenaAuthUpstreamUrl({
  ATHENA_AUTH_UPSTREAM_URL: "https://primary.example.com/api/auth",
  ATHENA_AUTH_URL: "https://legacy.example.com",
})
// => "https://primary.example.com"
```

### Fresh session lookup (middleware / RSC)

When the app proxies auth under `/api/auth/*` and you need a **cache-busted**
`get-session` URL on the **app origin**:

```ts
import {
  ATHENA_SESSION_DATA_HEADER,
  createFreshSessionLookupUrl,
} from "@xylex-group/athena/utils";

createFreshSessionLookupUrl("https://app.example.com");
// => https://app.example.com/api/auth/get-session?disableCookieCache=true

// Optional app convention for passing session JSON between edge and server:
// ATHENA_SESSION_DATA_HEADER === "x-session-data"
```

Constants: `ATHENA_AUTH_GET_SESSION_PATH` (`get-session`),
`ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH` (`/api/auth/get-session`),
`ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM` / `_VALUE`,
`ATHENA_SESSION_DATA_HEADER`.

Default when nothing is configured: `DEFAULT_ATHENA_AUTH_ORIGIN`
(`https://auth.athena-auth.com`).

## Related

- Session cookie bridge: `docs/auth-session-bridge.md`
- Auth UI proxy docs: platform `/docs/sdks/athena-auth-ui/auth-proxy-routing-and-cookies`
- Provider id types: `AuthSocialProvider` / `AuthOAuthProvider` from `@xylex-group/athena` or
  `@xylex-group/athena/social-providers` (auth API); `SocialProvider` for OAuth factories
