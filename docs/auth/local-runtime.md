# Athena Auth local TypeScript runtime

Athena Auth has one product contract and two server runtimes:

| Runtime | Location | When to use |
| --- | --- | --- |
| Rust | `services/athena-auth` | Dedicated auth service, large deployments |
| TypeScript | `@xylex-group/athena/auth/server` | One Next.js app + one Postgres database |

Application code should not care which runtime is serving `/api/auth/*`.

## Minimal app

```ts
import { createClient } from "@xylex-group/athena/server"

export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
})
```

`databaseUrl` / `db.pgUri` / `env.DATABASE_URL` infers `auth.mode: "local"`.
Explicit `auth.mode: "local"` is equivalent. `auth: false` and `auth.url` win.

```ts
// app/api/athena + /api/auth
import { createAthenaNextHandlers } from "@xylex-group/athena/next/server"

export const { auth, data } = createAthenaNextHandlers({ client: athena })
```

Browser: `createClient({ topology: { discover: "next" } })` from
`@xylex-group/athena/next/client` — no `auth.routing`.

```ts
// app/api/auth/[...all]/route.ts
import { createAthenaNextHandlers } from "@xylex-group/athena/next/server"
import { athena } from "@/lib/athena"

export const { GET, POST } = createAthenaNextHandlers({ client: athena }).auth
```

`DATABASE_URL` is the only required infrastructure connection. Do not set
`ATHENA_URL`, `ATHENA_AUTH_URL`, or run a Rust auth process.

An explicit secret is optional. When omitted, the runtime bootstraps a
database-backed key in `athena.runtime_key`. Never derive that secret from the
database password.

## Framework-neutral handle

```ts
import { createAthenaAuth } from "@xylex-group/athena/auth/server"

const auth = createAthenaAuth({
  database: process.env.DATABASE_URL!,
})

export default {
  fetch: (request: Request) => auth.handle(request),
}
```

## Moving to standalone Rust

Change only deployment configuration:

```ts
auth: {
  mode: "remote",
  url: "https://auth.example.com",
}
```

Users, sessions, password hashes (Argon2id PHC), organizations, and the
`athena.*` schema stay the same.

## Browser safety

`auth.mode: "local"` is Node-only. Browser, Next client, and React Native
entries throw `ATHENA_AUTH_LOCAL_NODE_REQUIRED` and never bundle `pg` or the
auth server implementation.

## Schema

Local mode uses the Athena Auth PostgreSQL schema (`athena.users`,
`athena.sessions`, `athena.accounts`, organizations, …). The TypeScript runtime
applies the same core tables the Rust service uses, plus a schema ledger and
runtime keyring. Call `athena.auth.server.migrate()` explicitly in production
if you disable auto-migrate.

## Implemented locally vs fail-closed

Implemented against the Rust HTTP contract:

- `GET /ok`, `GET /health`
- `GET|POST /get-session` (cookie, bearer, or `x-api-key` virtual session)
- `POST /sign-up/email`, `/sign-in/email`, `/sign-in/username`, `/sign-out`
- password reset / change, session list/revoke, account list
- email verify / send verification / change-email / delete-user
- API keys: create/list/get/delete/verify (SHA-256 hashed, plaintext once)
- TOTP 2FA: enable, URI, verify, disable, backup codes, email OTP
- organization create/list/get/update/delete/set-active
- members, invitations (create/accept/cancel/list)
- error envelope `{ message, version, traceId }` + `x-athena-trace-id`
- Argon2id PHC hashes (`m=1024,t=2,p=1`) stored in `users.metadata.password_hash`
- session tokens `session_<uuid>` and cookie `athena-auth.session-token`

Not yet implemented in the TypeScript runtime (unknown routes return `404`,
not a silent success):

- OAuth / social callback engine
- passkeys / WebAuthn
- admin email template CRUD
- grants / ABAC evaluator
- session intelligence / geo IP

Use the Rust server when those plugins are required, or wait for the next
parity slice. Do not treat a 404 as “feature disabled and allowed.”
