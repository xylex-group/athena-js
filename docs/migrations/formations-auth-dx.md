# Formations → Athena-JS auth DX migration recipe

Target consumer: `SuitsFinance/speedrun-formations` (local: `speedrun-formations`).

Goal: **one** Athena config authority, zero app-owned cookie/Authorization/session-token transport, one auth URL resolver.

## Preferred end state

```ts
// src/lib/athena/core.ts
import { createClient } from "@xylex-group/athena"
// or createAthenaBrowserClient from @xylex-group/athena/next/client
import { registry } from "@/athena/registry.generated"

export const athena = createClient({
  url: process.env.NEXT_PUBLIC_ATHENA_URL!,
  key: process.env.NEXT_PUBLIC_ATHENA_API_KEY!,
  models: registry,
  auth: {
    routing: "same-origin",
    // Required for the same-origin proxy (explicit or env). No silent hosted default.
    upstreamUrl: process.env.ATHENA_AUTH_UPSTREAM_URL,
  },
})
```


```ts
// src/lib/athena/server.ts
import "server-only"
import { createAthenaServerClient } from "@xylex-group/athena/next/server"
import { athena } from "./core"

export function createServerAthena() {
  return createAthenaServerClient({ client: athena })
}
```

```ts
// app/api/auth/[...all]/route.ts
import { createAthenaAuthProxyHandlers } from "@xylex-group/athena/next/server"
import { athena } from "@/lib/athena/core"

export const { DELETE, GET, HEAD, PATCH, POST, PUT } =
  createAthenaAuthProxyHandlers({ client: athena })
```

```ts
// session
import { createServerSessionResolver } from "@xylex-group/athena/next/server"

export const athenaSession = createServerSessionResolver({
  cache: "request",
  client: () => createServerAthena(),
  organization: { ensureActive: true },
})
```

## Acceptance metrics (before → after)

| Metric | Before (measured) | After (target) |
| --- | ---: | ---: |
| Athena/auth **transport** LOC | ~950+ (server facade, auth-routing, auth-url, proxy route glue, dual auth clients, header builders) | **~150–250** thin app surface |
| Independent auth URL resolvers | **≥4** | **1** (SDK routing) |
| Manual cookie / Authorization / session-token construction sites | **≥3** | **0** |
| `createAthenaServerClient` `as unknown` casts | **1** | **0** |
| Platform client config authorities | **2+** (browser public + server rebuild) | **1** static + request views |

Rough reduction: **~70–80%** of transport plumbing after adopting SDK phases above. Product UI, routing-debug showcase, admin policy, OpenNext env merge may remain.

## Delete / collapse list

1. **`buildRequestHeaders` + `AthenaServerAuthContext`** in `src/lib/athena/server.ts` — use `{ client }` + Next auto cookie/bearer.
2. **`src/lib/auth-url.ts`** single-key `ATHENA_AUTH_URL` gate — use SDK upstream env keys / `auth.upstreamUrl`.
3. **Most of `src/lib/auth-routing.ts`** once default path is same-origin only (keep product overrides if any).
4. **Dual auth clients** (`providers.tsx` dynamic + `athena/auth-client.ts` fixed `/api/auth`) — one factory from `athena`.
5. **Manual `X-Athena-Auth-Session-Token` / Cookie in chat-rooms** — session context via server client.
6. **Proxy route CF/accept-encoding glue** — only if still required by OpenNext; prefer SDK handlers + optional advanced hooks later.

## Keep as product (not SDK transport)

- Social flags, branding, password policy
- Admin permission matrix
- Middleware public-route allowlist
- OpenNext Cloudflare env overlay (until SDK optional `prepareRequest` lands)
- System-debug inventory UI (prefer `athena.system.inspectAuth()` for auth section)

## Verify

```bash
# after bumping @xylex-group/athena
pnpm test / typecheck for formations package scripts
# smoke: sign-in via /api/auth, RSC session, proxy Set-Cookie on app host
```

## Env naming

| Primary | Role |
| --- | --- |
| `NEXT_PUBLIC_ATHENA_URL` / `NEXT_PUBLIC_ATHENA_API_KEY` | Browser gateway |
| `ATHENA_AUTH_UPSTREAM_URL` | Same-origin proxy upstream (server) |
| Aliases retained by SDK | `ATHENA_AUTH_URL`, `NEXT_PUBLIC_ATHENA_AUTH_*` |

Do not invent a fourth resolver for upstream.
