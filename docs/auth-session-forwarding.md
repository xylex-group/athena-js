# Auth and request-context forwarding

Athena JS 3 uses one request-context contract for database, auth, chat, storage,
billing, and raw requests. Authentication is not a separate client class.

Package version: `@xylex-group/athena@3.0.0`.

Related: [next-js.md](./next-js.md) · [auth-session-bridge.md](./auth-session-bridge.md) · [request-headers-and-auth-examples.md](./request-headers-and-auth-examples.md)

---

## Next.js (preferred)

On the server, use the request-scoped façade so cookies, bearer, and optional
session identity are resolved every time:

```ts
import { createAthenaServerClient } from "@xylex-group/athena/next/server"

export async function loadAthenaForRequest(session?: {
  user?: { id: string }
  session?: { id: string; activeOrganizationId?: string | null }
} | null) {
  return createAthenaServerClient({
    url: process.env.ATHENA_URL!,
    key: process.env.ATHENA_API_KEY!,
    session,
  })
}

const athena = await loadAthenaForRequest(session)
await athena.from("customers").select("id")
```

See [Next.js integration](./next-js.md) for browser façades, env unions, and
explicit `requestHeaders` / `requestCookies`.

---

## Configure a context provider (any runtime)

```ts
import { createClient } from "@xylex-group/athena"

export const athena = createClient({
  key: process.env.ATHENA_API_KEY!,
  db: { url: process.env.ATHENA_DB_URL! },
  auth: { url: process.env.ATHENA_AUTH_URL! },
  storage: { url: process.env.ATHENA_STORAGE_URL! },
  context: async () => {
    const session = await resolveCurrentSession()
    if (!session) return undefined

    return {
      userId: session.user.id,
      organizationId: session.session.activeOrganizationId,
      bearerToken: session.session.token,
      sessionToken: session.session.token,
      cookie: session.cookie,
    }
  },
})
```

The provider runs before every operation and is not cached across requests by
the SDK.

---

## Add request scope with `withContext`

```ts
const scoped = athena.withContext({
  userId: session.user.id,
  organizationId,
  headers: {
    "X-Company-Id": companyId,
  },
  cookie: request.headers.get("cookie"),
  forceNoCache: true,
})
```

The returned object is a lightweight view over the same immutable client core.
Create per request; do not cache a request-scoped view globally.

### Shared root + Next resolvers

```ts
import { createClient } from "@xylex-group/athena"
import {
  resolveNextRequestContext,
  resolveAthenaServerContext,
} from "@xylex-group/athena/next/server"

export const athena = createClient({ env: process.env })

export async function athenaForRequest() {
  return athena.withContext(await resolveNextRequestContext())
}

export async function athenaForSession(session: {
  user?: { id: string }
  session?: { id: string; activeOrganizationId?: string | null }
} | null) {
  const resolved = await resolveAthenaServerContext({ session })
  return athena.withContext(resolved.request)
}
```

---

## Precedence

Headers and credentials merge in this order (later wins):

1. Client-level `headers`
2. Static or provider `context`
3. `withContext(...)` / server-façade request context
4. Per-operation headers

Nested `headers` objects are deep-merged.

---

## Service behavior

- HTTP database, auth, chat, storage, billing, and raw-request operations
  resolve context for every operation.
- WebSocket chat snapshots context when connecting and resolves again on
  reconnect.
- `forceNoCache` sets no-cache request behavior without a special client type.
- Secrets are redacted from configuration errors, trace output, and debug output.

---

## Cross-origin session cookies

If the app host is not the auth host, populate the app-host httpOnly cookie with
the [session bridge](./auth-session-bridge.md) so server factories can forward
`Cookie` / bearer into Athena.
