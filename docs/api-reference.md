# Athena JS 3 API reference

Compact contract surface for construction, config, context, errors, and package
entrypoints. For every method with examples, use the
[complete method reference](./complete-method-reference.md).

Package version: `@xylex-group/athena@3.0.0`.

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
  storage?: AthenaStorageConfig
  billing?: AthenaBillingConfig
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

Transport and service-specific error classes (gateway, billing, storage, …)
remain separate.

---

## Package subpaths

| Subpath | Contents |
| --- | --- |
| `@xylex-group/athena` | Root client, models/helpers, generator-related exports (Node/root condition) |
| `@xylex-group/athena/browser` | Browser-safe root surface |
| `@xylex-group/athena/next/client` | Browser façade + session bridge / auth URL / cookie helpers |
| `@xylex-group/athena/next/server` | Server façade + context resolvers + bridge handlers (`server-only`) |
| `@xylex-group/athena/react` | Hooks and query runtime |
| `@xylex-group/athena/billing` | Billing-focused surface |
| `@xylex-group/athena/admin` | Admin helpers |
| `@xylex-group/athena/organization` | Organization helpers |
| `@xylex-group/athena/cookies` | Cookie store helpers |
| `@xylex-group/athena/utils` | Shared utils (headers, auth URLs, …) |
| `@xylex-group/athena/social-providers` | Social provider registry |
| `@xylex-group/athena/cloudflare` | Worker-only D1/R2 edge-local client (`createCloudflareClient`) |

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
