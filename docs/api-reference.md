# Athena JS 3 API reference

Compact contract surface for construction, config, context, errors, and package
entrypoints. For every method with examples, use the
[complete method reference](./complete-method-reference.md).

Package version: `@xylex-group/athena@{{ATHENA_JS_PACKAGE_VERSION}}`.

---

## Client construction

### Primitive

```ts
function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels>
```

Synchronous. Sole materializer of the immutable client core (ADR 0001 / 0014).

### Next façades

Documented in full in [next-js.md](./next-js.md).

```ts
// @xylex-group/athena/next/client
function createAthenaBrowserClient(
  config: AthenaBrowserClientConfig,
): AthenaClient

// @xylex-group/athena/next/server  (async, server-only)
function createAthenaServerClient(
  options: AthenaServerClientConfig,
): Promise<AthenaClient>
```

Both call `createClient`. Browser config requires `url` + `key` and omits `env` /
request `context`. Server config requires `{ url, key }` or `{ env }`, resolves
request/session context per invocation, and does not cache clients.

### Cloudflare edge-local / switchable runtime

Documented in full in [cloudflare-edge-local.md](./cloudflare-edge-local.md).

```ts
// @xylex-group/athena/cloudflare
function createCloudflareClient(config): CloudflareAthenaClient // always edge
function createAthenaFromWorkerEnv(env, options?): { mode; client; capabilities } // best DX
function createAthenaRuntime(config: AthenaRuntimeConfig): { mode; client; capabilities }
function createAthenaRuntimeClient(config: AthenaRuntimeConfig): AthenaClient
function resolveAthenaExecutionMode(input): 'gateway' | 'edge'
```

- **Edge:** D1/R2 bindings in-process (ADR 0015).
- **Gateway:** HTTP to athena_rs (`createClient`).
- **Auto:** only D1 → edge; only URL → gateway; **both** → `prefer` / `ATHENA_EXECUTION_PREFER` (default edge).
- Env: `ATHENA_EXECUTION_MODE`, `ATHENA_EXECUTION_PREFER`.

Not for browser bundles when using D1/R2.

---

## Client

```ts
interface AthenaClient<TModels> {
  readonly db: AthenaDbModule
  readonly auth: AthenaAuthBindings
  readonly chat: AthenaChatModule
  readonly storage: AthenaStorageModule
  readonly billing: AthenaBillingModule
  readonly email: AthenaEmailModule
  readonly notifications: AthenaNotificationsModule
  readonly capabilities: AthenaClientCapabilities

  from(...): TableQueryBuilder
  rpc(...): RpcQueryBuilder
  query(...): Promise<AthenaResult>
  request(...): Promise<AthenaRequestResponse>
  verifyConnection(...): Promise<AthenaGatewayConnectionResult>
  withContext(context: AthenaRequestContext): AthenaClient<TModels>
}
```

One client type only. Namespaces are always present; unavailable services fail
on use with `ATHENA_SERVICE_NOT_CONFIGURED`. `capabilities` reports gateway vs
edge-local mode and layer support.

`notifications` is a root capability ([ADR 0055](../../../docs/adr/technical/0055-athena-js-notifications-capability.md)): catalog-owned topics/channels; `athena.notification_preferences` stores sparse overrides; `preferences.list` / `preferences.update`, `list({ unread })`, `markRead`, `markAllRead`. Not `auth.notifications`. No `createNotificationsClient`. No public `./notifications` subpath. Errors `ATHENA_NOTIFICATIONS_*` (9000–9006).

`request()` is HTTP-only (`http:` / `https:`). It does not compile SQL and does
not emulate `/gateway/*` on a `db.pgUri` client.

---

## Mutation result (ADR 0018)

```ts
interface AthenaResult<T> {
  data: T | null
  error: AthenaResultError | null
  count?: number | null
  /** Mutation-only honest meta. Omitted on reads. `null` = unknown, never fabricated `0`. */
  affectedRows?: number | null
  status: number
  raw: unknown
}
```

Canonical affected-row count is **count-preferred**: finite `count`, else finite
`affectedRows`, else unknown. `requireAffected(result, { min })` uses that order.
Successful PG/D1 mutations set both fields from `rowCount` / `meta.changes`.
Gateway HTTP copies envelope `count` when present; otherwise honest aliases
(`affected_rows`, `row_count`, `rows_affected`, `count`) or `null`.

Compare-and-swap is fluent — no `request({ path: "/gateway/update" })`:

```ts
const result = await athena
  .from("forms", { schema: "forms" })
  .eq("id", id)
  .eq("schema_revision", expected)
  .update(payload)
requireAffected(result, { min: 1 })
```

`.single()` / `.maybeSingle()` project the first row or `null` (same
`toSingleResult` on reads and mutations).

---

## Configuration

```ts
interface AthenaClientConfig<TModels> {
  url?: string | null
  key?: string | null
  client?: string | null
  backend?: BackendConfig | BackendType
  headers?: Record<string, string>
  models?: TModels
  env?: Record<string, string | undefined>
  context?: AthenaRequestContext | AthenaRequestContextProvider
  db?: AthenaDbConfig
  auth?: AthenaAuthConfig
  chat?: AthenaChatConfig
  storage?: AthenaStorageConfig // url | r2 | { provider: "local", root } (Node)
  billing?: AthenaBillingConfig
  email?: AthenaEmailConfig
  retryReads?: boolean
  traceQueries?: boolean | AthenaQueryTraceOptions
  debugAst?: boolean
  findManyAst?: boolean
  /** Optional prebuilt gateway transport (tests / Cloudflare edge). Prefer createCloudflareClient. */
  gatewayTransport?: AthenaGatewayClient
  capabilities?: AthenaClientCapabilities
}
```

Precedence:

1. Explicit service objects (`db`, `auth`, …) override unified-root derivation.
2. Explicit root fields override values from the supplied `env` object.
3. No implicit global `process.env` reads.

---

## Email

Athena Email is generic **transport + delivery** (`athena.email`). Athena Auth Email is **events, templates, and rendering**. The Auth email store is **Auth-only persistence** (`athena.emails`, `athena.email_send_failures`).

Root transport:

```ts
createClient({
  email: {
    provider: /* smtp | resend | httpEmailProvider | consoleEmailProvider */,
    defaults: { from: "no-reply@example.com" },
  },
  auth: { mode: "local" },
  databaseUrl,
})
```

Do **not** nest a provider under `auth.email`.

### Embedded Node + SMTP

```ts
import { createClient } from "@xylex-group/athena"
import { smtp } from "@xylex-group/athena/email/node"

createClient({
  databaseUrl,
  email: {
    provider: smtp({
      host: env.SMTP_HOST,
      port: 587,
      secure: "starttls",
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    }),
    defaults: { from: "no-reply@example.com" },
  },
  auth: { mode: "local" },
})
```

### Embedded Node + Resend

```ts
import { createClient, resend } from "@xylex-group/athena"

createClient({
  databaseUrl,
  email: {
    provider: resend({ apiKey: env.RESEND_API_KEY }),
    defaults: { from: "no-reply@example.com" },
  },
  auth: { mode: "local" },
})
```

### Embedded Cloudflare + HTTP/Resend

Workers cannot use SMTP. Use `resend` or `httpEmailProvider` (fetch). Missing or Node-only providers throw `ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME` on `send()`.

### Remote Auth + app-level root email

```ts
createClient({
  url: env.ATHENA_URL,
  key: env.ATHENA_API_KEY,
  auth: { mode: "remote", url: env.ATHENA_AUTH_URL },
  email: {
    provider: resend({ apiKey: env.RESEND_API_KEY }),
    defaults: { from: "app@example.com" },
  },
})
```

Password reset / verify still go through the Auth service. `client.email.send()` remains available for app mail (receipts, notifications).

### Missing provider

Construction succeeds. `athena.email.send()` throws `ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED`. Embedded Auth persists `ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED` on `athena.email_send_failures` — never silent success. Console delivery is explicit (`consoleEmailProvider()` / `createConsoleEmailProvider()`).

`resend({ apiKey })` and `httpEmailProvider({ url })` are fetch-based (browser/edge-safe). SMTP is Node-only (`@xylex-group/athena/email/node`).

---

## Request context

```ts
interface AthenaRequestContext {
  userId?: string | null
  organizationId?: string | null
  headers?: Record<string, string>
  cookie?: string | null
  bearerToken?: string | null
  sessionToken?: string | null
  forceNoCache?: boolean
}
```

Providers may be sync or async and are reevaluated per operation. Merge order:
client headers → configured context → `withContext` → per-operation headers.

---

## Errors

`AthenaConfigurationError` carries a structured `code`:

| Code | When |
| --- | --- |
| `ATHENA_NO_SERVICE_CONFIGURED` | Construction with no routable service URL |
| `ATHENA_SERVICE_NOT_CONFIGURED` | Using an unconfigured `db` / `auth` / `chat` / `storage` / `billing` namespace |
| `ATHENA_AUTH_NOT_AVAILABLE` | Data runtime is compatible; Auth is disabled or not advertised (discover-next) |
| `ATHENA_API_KEY_REQUIRED` | Missing API key at construction |
| `ATHENA_INVALID_URL` | Invalid URL during configuration (reserved/used where applicable) |
| `ATHENA_NEXT_SERVER_RUNTIME_REQUIRED` | Next server helpers need Next runtime or explicit request inputs |
| `ATHENA_RUNTIME_OWNERSHIP_INVALID` | Request view used as a root (`handlers`, `close()`, `migrate()`, `getAthenaRuntimeDiagnostics`) |
| `ATHENA_RUNTIME_CONFIG_INVALID` | Invalid runtime options (for example `storage.provider: "local"` or `"s3"` combined with `storage.url` / `storage.r2` / each other, local without `root`, or S3 without `bucket` / injected client) |
| `ATHENA_STORAGE_LOCAL_NODE_REQUIRED` | `storage.provider: "local"` on browser / React Native / non-trusted Node |
| `ATHENA_STORAGE_S3_NODE_REQUIRED` | `storage.provider: "s3"` on browser / React Native / non-trusted Node |
| `ATHENA_STORAGE_CAPABILITY_UNSUPPORTED` | Adapter cannot perform the op (local: presign, retention, ACL, catalog). Also `AthenaStorageCapabilityError.code` |
| `ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH` | Object is not this package instance's root (foreign runtime / protocol) |

`AthenaEmailError` is raised from `athena.email.send()`:

| Code | When |
| --- | --- |
| `ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED` | `send()` with no root `email.provider` |
| `ATHENA_EMAIL_MESSAGE_INVALID` | Missing recipient, subject, from, or body after defaults merge |
| `ATHENA_EMAIL_DELIVERY_FAILED` | Provider `send()` threw; native result types are not exposed |
| `ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME` | Provider cannot run in the current runtime (SMTP is Node-only) |
| `ATHENA_EMAIL_PROVIDER_INVALID` | Adapter config is incomplete (missing host, url, apiKey, …) |

`AthenaRuntimeOwnershipError` extends `AthenaConfigurationError`. Request views are `ownership: "request"`; they borrow pools / Auth stores and do not own `close()`.

Transport and service-specific error classes (gateway, billing, storage, …)
remain separate.

---

## Package subpaths

| Subpath | Contents |
| --- | --- |
| `@xylex-group/athena` | Root client, models/helpers, generator-related exports (Node/root condition) |
| `@xylex-group/athena/browser` | Browser-safe root surface |
| `@xylex-group/athena/next/client` | Browser façade + session bridge / auth URL / cookie helpers |
| `@xylex-group/athena/next/session` | RSC `getServerSession` (`server-only`; no `createClient`) |
| `@xylex-group/athena/next/server` | Server façade + context resolvers + bridge handlers (`server-only`) |
| `@xylex-group/athena/react` | Hooks and query runtime |
| `@xylex-group/athena/billing` | Billing-focused surface |
| `@xylex-group/athena/admin` | Admin helpers |
| `@xylex-group/athena/organization` | Organization helpers |
| `@xylex-group/athena/cookies` | Cookie store helpers |
| `@xylex-group/athena/utils` | Shared utils (headers, auth URLs, …) |
| `@xylex-group/athena/social-providers` | Social provider registry |
| `@xylex-group/athena/cloudflare` | Worker-only D1/R2 edge-local client (`createCloudflareClient`) |
| `@xylex-group/athena/schema` | Schema IR v2 + authoring (`table`, canonicalize / validate / fingerprint) |
| `@xylex-group/athena/devtools` | DevTools protocol types + sanitizers (ADR 0051). No ring buffer, no secrets. Event channel is Node/local via `/api/athena/devtools/v1/events` |
| `@xylex-group/athena/rights` | Branded `AthenaRightKey` parse/match (ADR 0054). Nine-symbol budget. Browser-safe. Native catalog stays in `crates/athena-rights` |
| `@xylex-group/athena/policy` | Policy authoring DSL + IR types |
| `@xylex-group/athena/email` | Browser/edge-safe email providers (`resend`, `httpEmailProvider`, `consoleEmailProvider`) |
| `@xylex-group/athena/email/node` | Node-only SMTP (`smtp`). Not reachable from `/browser` or `/cloudflare` |

---

## Related guides

| Topic | Doc |
| --- | --- |
| Install + first queries | [getting-started.md](./getting-started.md) |
| Next.js | [next-js.md](./next-js.md) |
| Cloudflare Workers (D1/R2) | [cloudflare-edge-local.md](./cloudflare-edge-local.md) |
| Auth → gateway context | [auth-session-forwarding.md](./auth-session-forwarding.md) |
| Storage | [storage/index.md](./storage/index.md) |
| v2 migration | [migration-v2-to-v3.md](./migration-v2-to-v3.md) |
| Maintainer architecture | [client-internal-architecture.md](./client-internal-architecture.md) |
| Mutation row-count / fluent CAS | [ADR 0018](../../../docs/adr/technical/0018-athena-js-canonical-mutation-row-count.md) |
| Schema IR v2 | [schema-ir.md](./schema-ir.md) · [ADR 0038](../../../docs/adr/technical/0038-athena-schema-ir-v2.md) |
| DevTools protocol | [ADR 0051](../../../docs/adr/technical/0051-athena-devtools-runtime-inspector-protocol.md) · spec [`docs/sdd/xylex/athena-devtools-runtime-inspector/SPEC.md`](../../../docs/sdd/xylex/athena-devtools-runtime-inspector/SPEC.md) |
| Rights IR | [ADR 0054](../../../docs/adr/technical/0054-athena-js-rights-ir.md) · spec [`docs/sdd/xylex/athena-js-rights-ir/SPEC.md`](../../../docs/sdd/xylex/athena-js-rights-ir/SPEC.md) |
| Notifications | [ADR 0055](../../../docs/adr/technical/0055-athena-js-notifications-capability.md) · spec [`docs/sdd/xylex/athena-notifications-and-auth-ui-domains/SPEC.md`](../../../docs/sdd/xylex/athena-notifications-and-auth-ui-domains/SPEC.md) |
| HTTP principal authority | [ADR 0056](../../../docs/adr/technical/0056-athena-js-http-principal-authority.md) · spec [`docs/sdd/xylex/athena-js-http-principal-authority/SPEC.md`](../../../docs/sdd/xylex/athena-js-http-principal-authority/SPEC.md) · finality [`docs/sdd/xylex/athena-js-cross-domain-runtime-finality/SPEC.md`](../../../docs/sdd/xylex/athena-js-cross-domain-runtime-finality/SPEC.md) |
