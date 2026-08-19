# Auth routing: proxy vs direct upstream

This page documents how Athena Auth is reached from a host app (Next.js, etc.),
which package owns which helper, and how session APIs behave in each mode.

**Canonical product routing** lives in **`@xylex-group/athena-auth-ui`**.  
**Low-level URL resolution** lives in **`@xylex-group/athena/utils`** (and is
re-exported from auth-ui `athena/base-url`).

Reference app:

- Repo: `athena-auth-ui` → `examples/next-heroui-example`
- Env: `ATHENA_AUTH_ROUTING_MODE=direct-upstream` (or `proxy`)
- Code: `src/lib/auth-routing.ts`, `src/lib/auth.ts`, providers + routing-debug overlay

---

## Why two modes exist

| Concern | Proxy mode | Direct upstream |
|---------|------------|-----------------|
| Browser talks to | Same origin (`/api/auth/*`) | Hosted Athena Auth origin |
| Session cookie domain | App host (or app-host **session bridge**) | Auth host |
| Localhost + hosted auth | Works via proxy; cookies on app | Prefer **direct-upstream** so cookies are not rejected on localhost |
| Middleware / RSC reading cookies | Easier on app host | May need bridge or server-side token forwarding |
| Extra Next route | `api/auth/[...all]` proxy required | Optional (health/version only) |

Neither mode is “wrong.” Choose based on cookie domain, CORS, and whether you
want a same-origin proxy.

**Local Runtime / embedded Auth:** do not set `auth.routing` or `ATHENA_AUTH_URL`
on the browser client. `createClient({ topology: { discover: "next" } })`
attaches same-origin `/api/auth` from the 1.1 discovery document
([ADR 0020](../../../docs/adr/technical/0020-athena-next-runtime-capability-discovery.md)).
Use `auth.url` / `auth.mode: "remote"` only when Auth is remote-direct.

---

## Mode A — Proxy (default)

```text
Browser  →  https://app.example.com/api/auth/*  →  Next route handler  →  Athena Auth upstream
```

### Configuration

```ts
// createAthenaAuthClient (auth-ui)
createAthenaAuthClient({
  baseUrl: "/api/auth",
  appendAuthPath: true, // default-ish: ensure /api/auth semantics
})

// or createClient (athena-js)
createClient({
  db: { url: gatewayUrl },
  key,
  auth: { url: "/api/auth" },
})
```

### Routing-debug shape

```ts
import {
  createDefaultAthenaAuthRoutingDebugConfig,
  resolveAthenaAuthRoutingDebugBaseUrl,
} from "@xylex-group/athena-auth-ui/auth/routing-debug"

const config = createDefaultAthenaAuthRoutingDebugConfig("/api/auth")
// { appendAuthPath: true, authUrl: "/api/auth" }

const resolvedBaseUrl = resolveAthenaAuthRoutingDebugBaseUrl(config)
// absolute URL under the app origin + /api/auth
```

### Session

| API | Notes |
|-----|--------|
| `useSession(client)` | Hits same-origin `/api/auth/get-session` (via client base) |
| `client.auth.getSession()` | Same |
| `createFreshSessionLookupUrl(appOrigin)` | `https://app…/api/auth/get-session?disableCookieCache=true` |
| Session bridge | Use when auth cookie is on another host but middleware needs app-host cookie |

### Proxy route

Use auth-ui handlers (do not reimplement Better Auth proxy):

```ts
// app/api/auth/[...all]/route.ts
import { createAthenaAuthProxyHandlers } from "@xylex-group/athena-auth-ui/athena/proxy"
// or package equivalent export used by next-heroui-example
```

---

## Mode B — Direct upstream

```text
Browser  →  https://auth.example.com/…  (Athena Auth)
App origin  →  only for UI, gateway, optional bridge
```

### Configuration

```ts
import { createAthenaAuthClient } from "@xylex-group/athena-auth-ui/athena/client"
import { resolveAthenaAuthClientBaseUrl } from "@xylex-group/athena-auth-ui/athena/base-url"
// also: @xylex-group/athena/utils

const authBaseUrl = resolveAthenaAuthClientBaseUrl(
  process.env.NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL,
  // or absolute "https://auth.example.com"
  undefined,
  { appendAuthPath: false },
)

const authClient = createAthenaAuthClient({
  baseUrl: authBaseUrl,
  appendAuthPath: false,
})
```

Absolute upstream URLs do **not** need a forced `/api/auth` suffix when
`appendAuthPath: false`. If the hosted service already serves at `/api/auth`,
include that in the upstream URL yourself; the helper will not invent a second path
when append is disabled.

### Env (next-heroui-example)

```bash
ATHENA_AUTH_ROUTING_MODE=direct-upstream
# or NEXT_PUBLIC_ATHENA_AUTH_ROUTING_MODE=direct-upstream

ATHENA_AUTH_UPSTREAM_URL=https://auth.example.com
# / NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL=...
```

Example logic (simplified from `examples/next-heroui-example/src/lib/auth-routing.ts`):

```ts
if (mode === "direct-upstream" && publicUpstreamUrl) {
  return {
    appendAuthPath: false,
    authUrl: publicUpstreamUrl,
  }
}
// else proxy defaults: appendAuthPath true, authUrl "/api/auth"
```

### Session

| API | Notes |
|-----|--------|
| `useSession(authClient)` | Calls **upstream** `get-session` (credentials / CORS as configured) |
| `authClient.getSession()` | Same |
| `createFreshSessionLookupUrl(appOrigin)` | **Not** the right default — that targets app `/api/auth`. Prefer client `getSession` against the resolved upstream base |
| Cookies | On **auth** domain; app middleware may not see them without bridge / token headers |

### Server client against upstream

```ts
// next-heroui-example pattern
createAthenaAuthClient({
  appendAuthPath: config.appendAuthPath,
  baseUrl: resolveExampleServerAuthBaseUrl(config, requestOrigin),
})
```

Server often uses the absolute upstream even when the browser uses proxy, or
mirrors the same routing-debug config for both.

---

## Package ownership

| Concern | Package | Entry |
|---------|---------|--------|
| URL normalize / env keys / `appendAuthPath` | **athena-js** | `@xylex-group/athena/utils` |
| Same helpers re-export | **athena-auth-ui** | `@xylex-group/athena-auth-ui/athena/base-url` |
| Browser/server auth client factory | **athena-auth-ui** | `@xylex-group/athena-auth-ui/athena/client` |
| Proxy handlers | **athena-auth-ui** | `athena/proxy` |
| Routing debug config + overlay | **athena-auth-ui** | `auth/routing-debug`, experimental overlay |
| `useSession` / `auth.getSession` | **athena-js** | `/react`, `createClient(config).auth` |
| App-host session bridge | **athena-js** | `@xylex-group/athena/next/server` |
| Env mode switch + branding | **App** | thin `auth-routing.ts` like the example |

### Do not reimplement

- Local `*Primitive` base-url stacks  
- Hardcoded “always `/api/auth`” in every sample when direct-upstream is supported  
- Custom Better Auth proxy when auth-ui already provides handlers  

### App residual (keep thin)

```ts
// app: map env → AthenaAuthRoutingDebugConfig
type Mode = "proxy" | "direct-upstream"
// then createAthenaAuthClient({ appendAuthPath, baseUrl: resolved })
```

Product defaults (e.g. formations upstream host) stay in app env / `DEFAULT_*`,
not a second resolver.

---

## `useSession` and `createClient` under both modes

`useSession` accepts:

1. `createClient(config)` → `client.auth.getSession`
2. `createClient(config).auth`
3. Auth UI's compatibility client → top-level `getSession`

Full examples: [`auth/use-session.mdx`](auth/use-session.mdx).

```tsx
// Works for proxy or direct-upstream — only the configured auth URL changes
const { data, isPending } = useSession(authClient)
// or useSession(athena) when athena = createClient({ key, auth: { url } })
```

Configure `baseUrl` / `appendAuthPath` for the mode; do not fork the hook.

---

## Routing debug shell (auth-ui)

Import:

```ts
import {
  ATHENA_AUTH_ROUTING_DEBUG_COOKIE_NAME,
  ATHENA_AUTH_ROUTING_DEBUG_STORAGE_KEY,
  type AthenaAuthRoutingDebugConfig,
  createDefaultAthenaAuthRoutingDebugConfig,
  createAthenaAuthRoutingDebugState,
  normalizeAthenaAuthRoutingDebugConfig,
  parseAthenaAuthRoutingDebugConfig,
  resolveAthenaAuthRoutingDebugBaseUrl,
  // + overlay component from auth-ui experimental / root exports
} from "@xylex-group/athena-auth-ui/auth/routing-debug"
```

Config:

```ts
interface AthenaAuthRoutingDebugConfig {
  appendAuthPath: boolean
  authUrl: string
}
```

- **Proxy UI default:** `{ appendAuthPath: true, authUrl: "/api/auth" }`  
- **Direct upstream UI:** `{ appendAuthPath: false, authUrl: "https://auth.…" }`  

`createAthenaAuthRoutingDebugState(config)` → `{ config, resolvedBaseUrl }`.

The **next-heroui-example** wires this into providers, cookies/localStorage
persistence, and the debug overlay so developers can switch modes without
redeploying.

---

## Decision guide

```text
Hosted Athena Auth + developing on localhost?
  → direct-upstream (cookies on auth host)
     ATHENA_AUTH_ROUTING_MODE=direct-upstream
     createAthenaAuthClient({ appendAuthPath: false, baseUrl: upstream })

Need middleware to read session on app host?
  → proxy and/or session bridge
     /api/auth proxy + optional createAthenaAuthSessionBridgeHandlers

Single public site, same-site cookies OK?
  → either mode; proxy is simpler for first-party cookies
```

---

## Related docs

| Doc | Topic |
|-----|--------|
| [`athena-auth-url.md`](athena-auth-url.md) | Env keys, normalize, resolve helpers |
| [`auth/use-session.mdx`](auth/use-session.mdx) | React session hook inputs |
| [`auth-session-bridge.md`](auth-session-bridge.md) | App-host httpOnly bridge |
| [`utils-and-helpers.md`](utils-and-helpers.md) | Anti-duplication map |
| auth-ui README | Direct upstream snippet + package map |
| `examples/next-heroui-example` | End-to-end proxy + direct-upstream |

---

## Checklist for consumers (demo / speedrun)

1. Prefer **auth-ui** `createAthenaAuthClient` + routing-debug for browser auth base.  
2. Support **both** modes via env (`ATHENA_AUTH_ROUTING_MODE`), not hardcoding only proxy.  
3. Re-export app `base-url` / `fresh-session` from SDK; do not reimplement.  
4. `useSession` from `@xylex-group/athena/react` (not `@better-auth-ui/react`).  
5. `createFreshSessionLookupUrl` only in **proxy** paths; direct-upstream uses client `getSession`.  
6. Keep product-only policy (formations org select) outside the routing helpers.
