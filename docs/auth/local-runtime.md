# Athena Auth local TypeScript runtime

Athena Auth has one product contract and two server runtimes:

| Runtime    | Location                          | When to use                               |
| ---------- | --------------------------------- | ----------------------------------------- |
| Rust       | `services/athena-auth`            | Dedicated auth service, large deployments |
| TypeScript | `@xylex-group/athena/auth/server` | One Next.js app + one Postgres database   |

Application code should not care which runtime is serving `/api/auth/*`.

## Minimal app

```ts
import { createClient } from "@xylex-group/athena/server";

export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
});
```

`databaseUrl` / `db.pgUri` / `env.DATABASE_URL` infers `auth.mode: "local"`.
Explicit `auth.mode: "local"` is equivalent. `auth: false` and `auth.url` win.

```ts
// app/api/athena + /api/auth
import { createAthenaNextHandlers } from "@xylex-group/athena/next/server";

export const { auth, billing, billingIngress, data, storage } = createAthenaNextHandlers({
  client: athena,
});
```

Browser: `createClient({ topology: { discover: "next" } })` from
`@xylex-group/athena/next/client` — no `auth.routing`.

```ts
// app/api/auth/[...all]/route.ts
import { createAthenaNextHandlers } from "@xylex-group/athena/next/server";
import { athena } from "@/lib/athena";

export const { GET, POST } = createAthenaNextHandlers({ client: athena }).auth;
```

`DATABASE_URL` is the only required infrastructure connection. Do not set
`ATHENA_URL`, `ATHENA_AUTH_URL`, or run a Rust auth process.

An explicit secret is optional. When omitted, the runtime bootstraps a
database-backed key in `athena.runtime_key`. Never derive that secret from the
database password.

## Runtime composition

`createAthenaAuthRuntime` is a composition root, not a procedure dump ([ADR 0042](../../../../docs/adr/technical/0042-athena-auth-canonical-architecture.md)):

```text
createAthenaAuthRuntime
  = createRuntimeDependencies
  + createAuthRouter          # typed route() — session | credential | user |
                              # organization | passkey | token | email | admin
  + request middleware        # tracing, origin, timings, error boundary
```

Password-reset (`/forget-password`, `/reset-password`) and organization invitation procedures live in `credential-password-routes.ts` and `organization-invitation-routes.ts`. Do not add business procedures back into `runtime.ts`.

## Framework-neutral handle

```ts
import { createAthenaAuth } from "@xylex-group/athena/auth/server";

const auth = createAthenaAuth({
  database: process.env.DATABASE_URL!,
});

export default {
  fetch: (request: Request) => auth.handle(request),
};
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
runtime keyring. The current schema generation is **48**. Generations **45–48**
add session authentication context, OIDC authorization context and refresh-token
scope provenance, OIDC signing metadata, and organization identity connections
with federated identities. Generation **28** adds durable social sign-in state
(`athena.oauth_transactions`). Call
`athena.auth.server.migrate()` explicitly in production if you disable
auto-migrate.

## Implemented locally vs fail-closed

The generated operation catalog
(`contracts/auth/routes.generated.json` / `ATHENA_AUTH_OPERATIONS`) is the
source of truth for runtime support. Embedded Auth also serves the following
local-only capabilities:

- OAuth Authorization Server and OIDC Provider: authorization code with PKCE
  S256, RS256 ID tokens, scope-limited UserInfo (`GET` and `POST`), OIDC
  discovery, and prompt / `max_age` / nonce handling. OIDC-only requests may
  omit `resource`; mixed identity and API-scope requests name one explicitly.
- `auth.admin.authorizationServer.client` and `.grant` manage the same clients
  and delegated grants used by the OAuth protocol endpoints.
- `auth.admin.connection` manages organization-owned OIDC connections and
  federated identities. Connection secrets remain in the application's secret
  store; Auth stores only `credentialRef`.

Common Auth routes include:

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

Not implemented in the TypeScript runtime (unknown routes return `404`, not a
silent success):

- Social HTTP is **served** when `auth.social.providers` is configured ([ADR 0050](../../../../docs/adr/technical/0050-athena-js-social-oauth-orchestration.md) engine + [ADR 0053](../../../../docs/adr/technical/0053-athena-js-embedded-social-http-and-hooks.md) routes). Advertised `social.providers` lists only configured served ids. Unconfigured apps stay `[]`.
- general Auth grants / ABAC evaluator
- session intelligence / geo IP

Passkey/WebAuthn implementation is present in Embedded Auth. Its capability
advertisement is operator-gated by `auth.passkey.enabled`; see [Passkeys](./passkey.mdx).

Admin email records, templates, failures, and event-type list **are** served
locally (`embedded: "supported"` in the catalog). Do not list them as a gap.

Use the Rust server when those plugins are required, or wait for the next
parity slice. Do not treat a 404 as “feature disabled and allowed.”

## Passkey relying party (identity only)

Optional `auth.passkey` on local config freezes one immutable WebAuthn RP at
Auth init (`id`, `name`, `origins`, `relatedOrigins`). Precedence: explicit
`rpId` / `rpName` / origins → unique-host `security.trustedOrigins` →
documented localhost defaults **only** in development. Production with a
`passkey` key and no trusted identity throws `ATHENA_RUNTIME_CONFIG_INVALID`.
RP ID is never taken from `Host`, `X-Forwarded-Host`, or `Origin`.
`passkey.enabled: true` is operator intent. Advertised `passkeys` follows the generated operation catalog, not this flag.

## Social OAuth config (orchestration + HTTP)

Canonical bag on local `createClient`. Object maps on `auth.social`, `auth.oauth`,
and `auth.socialProviders` normalize once. Apps do not import `google()` for
this common case. Configured providers are advertised and the four social HTTP
routes (`POST /sign-in/social`, `GET /callback/{provider}`, `POST /link-social`,
`POST /unlink-account`) are served. Unconfigured apps stay `social.providers: []`.
Ids that are not in the built-in registry may declare `issuer` (or explicit
authorize/token/userinfo URLs) for a local/OIDC fixture — used by packed
`testProvider` tests. The distinct Authorization Server client admin API is
`auth.admin.authorizationServer.client`; it manages apps that use Athena as
issuer and does not configure social providers or callback allowlists.

```ts
import { createClient } from "@xylex-group/athena/server";

export const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
  auth: {
    mode: "local",
    social: {
      providers: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!,
          clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        },
      },
    },
  },
});
```

`auth.social: true` / `auth.oauth: true` is invalid (`ATHENA_RUNTIME_CONFIG_INVALID`).
There is no standalone `createOAuthClient`, `createSocialClient`, or
`athena.oauth` namespace. Social providers remain under `auth.social.providers`;
dedicated Rust callback allowlists are Social Callback Registrations.
`clientSecret` and the transaction store are server-only (not in browser /
Next client / React Native / Auth UI). Post-auth redirects must match
`security.trustedOrigins`; tokens never appear in the redirect query. Last-credential
unlink is rejected.

## Domain hooks

`createClient({ auth: { mode: "local", hooks } })` and `createAthenaAuthRuntime({ hooks })` accept the same `AthenaAuthHooks` map. Keys are implemented domain events only (`user.create`, `organization.create`, `session.issue`, `passkey.register`, `passkey.update`, `passkey.delete`, …). See ADR 0039 and ADR 0041.

Passkey rename and delete use the same `executeAuthMutation` nucleus as register: `previous → before → transaction(scope.stores + persistAudit) → after`. Hook and `audit_log_auth` payloads are identifying `AthenaAuthHookPasskey` only (`id`, `name`, `userId`, optional `createdAt`) — never public key, credential ID, authenticator data, or challenge data. The public `AthenaPasskeyRecord` is authenticator metadata (`displayName`, vendor, device type, transports, backup) without cryptographic material.

`athena.audit_log_auth` meaning is the Auth Event IR on `ATHENA_AUTH_EVENT_DEFINITIONS` ([ADR 0052](../../../../docs/adr/technical/0052-athena-auth-audit-event-ir.md)): mutation kind, typed `resolveSubject({ previous, result, actor, input })`, optional org resolver, previous/result policy. The executor validates then persists inside the mutation transaction; `insertAuditLogAuth` does not guess subject or organization ids. Deletes capture a sanitized previous object and a tombstone `{ deleted: true, id, … }`. `session.revoke` writes one audit row per revoked session (`secondaryEvents`). `session.activeOrganization.update` always uses `actor.sessionId` as `subject_id`. Missing required semantics throw `ATHENA_AUTH_AUDIT_*` (8024–8029) when audit logging is enabled. Do not backfill historical rows from scavenged ids.

Optional `auth.passkey.registration` / `authentication` set WebAuthn userVerification, residentKey, authenticatorAttachment, and the `credProps` extension. Unspecified passwordless registration defaults to `residentKey: "required"` / `requireResidentKey: true` and requests `credProps` unless the operator set `credProps: false` ([ADR 0044](../../../../docs/adr/technical/0044-athena-passkey-discoverability-and-webauthn-ownership.md)). Operator `residentKey` remains an override. Default registration omits `authenticatorAttachment`. `auth.passkey.onboarding.enabled` starts a durable registration transaction instead of creating a user before the ceremony finishes. Advertised `passkey.onboarding` is additive; Auth UI must not infer onboarding from `passkeys: true`.

Callbacks are **not** copied onto `NormalizedAthenaAuthConfig`. Pass `athenaAuthConfig(config.auth)?.hooks` into the runtime.

- `before` — serial, fail-fast; throw vetoes the transaction (`ATHENA_AUTH_HOOK_REJECTED` unless already `AthenaAuthRuntimeError`)
- `after` — serial, continue-on-error; HTTP success is preserved after commit
- `onError` — best-effort; its throw is logged and swallowed

Compound rules: signup emits `user.create` and, when auto sign-in succeeds, a sibling `session.issue`. Org create emits one `organization.create`. Invite accept emits `organization.invitation.accept` only. Ban emits `user.ban` only. Role change emits `organization.member.role.update` (not the email string `organization.member.role.updated`).

Transactional email (`authEmailEvents`) stays a separate notification catalog. Map those strings onto domain events; do not register them as `auth.hooks` keys.

v1 caches the embedded runtime per PostgreSQL runtime object and fingerprints **hooks object identity**. Reuse a module-level `hooks` const. A different object against the same cached runtime throws `ATHENA_AUTH_RUNTIME_CONFIG_CONFLICT` (temporary; a stable registration model is debt).
