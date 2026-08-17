# Request headers and authentication examples

Athena JS 3 has one client-level and request-level context model.

## Header map

| Input | Request behavior |
|---|---|
| `key` | Authoritative Athena API-key header |
| `client` | Athena client-routing header |
| `context.userId` | User-scope header |
| `context.organizationId` | Organization-scope header |
| `context.headers` | Custom headers, including company scope |
| `context.cookie` | Cookie/session forwarding |
| `context.bearerToken` | Authorization and service-specific bearer forwarding |
| `context.sessionToken` | Athena session-token forwarding |
| `context.forceNoCache` | No-cache behavior |
| `db.pgUri` / `db.jdbcUrl` | Database connection routing |

## Shared client

```ts
import { createClient } from "@xylex-group/athena"

export const athena = createClient({
  key: process.env.ATHENA_API_KEY!,
  client: "formations",
  db: {
    url: process.env.ATHENA_DB_URL!,
    pgUri: process.env.DATABASE_URL,
  },
  auth: { url: process.env.ATHENA_AUTH_URL! },
  chat: { url: process.env.ATHENA_CHAT_URL! },
  storage: { url: process.env.ATHENA_STORAGE_URL! },
})
```

## Request-scoped server view

```ts
export function forRequest(request: Request, session: Session) {
  return athena.withContext({
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId,
    cookie: request.headers.get("cookie"),
    bearerToken: session.session.token,
    sessionToken: session.session.token,
    forceNoCache: true,
  })
}
```

## Custom organization/company scope

```ts
const scoped = athena.withContext({
  organizationId,
  headers: { "X-Company-Id": companyId },
})

await scoped.from("documents").select("id,name")
await scoped.storage.files.list()
await scoped.chat.conversations.list()
```

## Per-operation overrides

Use each operation's options argument for headers that apply to only that call. Per-operation headers override the client and context layers. Construct a new root client when the service routes or API key must change; those values are immutable core configuration.

See [`auth-session-forwarding.md`](auth-session-forwarding.md) for precedence and concurrency rules.
