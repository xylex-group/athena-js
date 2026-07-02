# API Reference

This page documents the exported contract surfaces of `@xylex-group/athena` and `@xylex-group/athena/react`.

For workflow-first onboarding, start with [`getting-started.md`](getting-started.md).
For the full `findMany(...)` AST explanation, live route payloads, and Athena server implications, use [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md).
For method-by-method runtime AST/state/payload models, use [`runtime-method-ast-models.md`](runtime-method-ast-models.md).
For detailed auth-session and bearer forwarding semantics on gateway/query requests, use [`auth-session-forwarding.md`](auth-session-forwarding.md).
For model architecture strategy, use [`type-safety-playbook.md`](type-safety-playbook.md).
For Athena Auth endpoint parity and per-endpoint examples, use [`auth/index.mdx`](auth/index.mdx) and [`auth-client-bindings.md`](auth-client-bindings.md).
For full storage setup, managed file examples, binary proxy behavior, and server OpenAPI route coverage, use [`storage/index.md`](storage/index.md).
For exhaustive method-by-method coverage (including auth, runtime chains, react, cookies, and utils), use [`complete-method-reference.md`](complete-method-reference.md).

## Export surfaces

Main package exports include:

- runtime client constructors (`createClient`, `AthenaClient`)
- query builder contracts (`AthenaSdkClient`, `TableQueryBuilder`, `RpcQueryBuilder`)
- low-level service hatch (`client.request(...)`)
- request header cookbook ([`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md))
- chat runtime surface (`client.chat`, chat types, realtime helpers)
- typed registry builders (`defineModel` deprecated, `defineSchema`, `defineDatabase`, `defineRegistry`, `createTypedClient`)
- generator config/pipeline helpers
- result and error helpers

React package exports include:

- low-level gateway hook (`useAthenaGateway`)
- query runtime (`createAthenaQueryClient`, provider, `useQuery`, `useMutation`)
- auth session parity hook (`useSession`)

Main package auth exports include:

- `createClient(...).auth` (preferred) and `createAuthClient` (deprecated)
- `AthenaAuthSdkClient` with both legacy flat methods and grouped `auth.*` bindings
- organization plugin binding surface (`AthenaAuthOrganizationBindings`)
- auth binding contract (`AthenaAuthBindings`)

## Core result contract

Most SDK operations return:

```ts
interface AthenaResultError {
  message: string
  code: string | null
  athenaCode: AthenaErrorCode
  gatewayCode?: AthenaGatewayErrorCode | null
  kind: AthenaErrorKind
  category: AthenaErrorCategory
  retryable: boolean
  details: unknown | null
  hint: string | null
  status: number
  statusText: string | null
  constraint?: string
  table?: string
  operation?: string
  endpoint?: AthenaGatewayEndpointPath
  method?: AthenaGatewayMethod
  requestId?: string
  cause?: string
  raw: unknown
}

interface AthenaResult<T> {
  data: T | null
  error: AthenaResultError | null
  statusText?: string | null
  errorDetails?: AthenaGatewayErrorDetails | null
  status: number
  count?: number | null
  raw: unknown
}
```

## Runtime client construction

### `createClient(url, apiKey, options?)`

```ts
function createClient(
  url: string | null | undefined,
  apiKey: string | null | undefined,
  options?: Pick<AthenaGatewayCallOptions, "client" | "headers" | "backend"> & {
    client?: string | null | undefined
    userId?: string | null | undefined
    organizationId?: string | null | undefined
    forceNoCache?: boolean
    pgUri?: string | null | undefined
    jdbcUrl?: string | null | undefined
    athenaKey?: string | null | undefined
    db?: { url?: string | null | undefined }
    gateway?: { url?: string | null | undefined }
    auth?: AthenaAuthClientConfig & { url?: string | null | undefined; baseUrl?: string | null | undefined }
    chat?: { url?: string | null | undefined; wsUrl?: string | null | undefined; webSocketFactory?: AthenaChatWebSocketFactory | null | undefined }
    storage?: { url?: string | null | undefined }
    dbUrl?: string | null | undefined
    gatewayUrl?: string | null | undefined
    authUrl?: string | null | undefined
    chatUrl?: string | null | undefined
    chatWsUrl?: string | null | undefined
    storageUrl?: string | null | undefined
    experimental?: {
      athenaStorageBackend?: boolean
      debugAst?: boolean
      enableErrorNormalization?: boolean
      findManyAst?: boolean
      retryReads?: boolean
      traceQueries?: boolean | AthenaQueryTraceOptions
      typecheckColumns?: boolean
      storage?: AthenaStorageClientConfig
    }
  }
): AthenaSdkClientWithAuth
```

This is the canonical SDK entry point. The SDK treats `url` as the public unified Athena base URL and resolves services to `${url}/db`, `${url}/auth`, `${url}/chat`, and `${url}/storage` unless you provide explicit service overrides. Chat realtime defaults to the same host converted to `ws:` / `wss:` with `/chat/ws`.
Direct env-style inputs such as `createClient(process.env.ATHENA_URL, process.env.ATHENA_API_KEY, { auth: { baseUrl: process.env.ATHENA_AUTH_URL }, client: process.env.ATHENA_CLIENT })` are supported; the SDK still throws early when the API key is missing.
The `auth` block accepts the full `AthenaAuthClientConfig` surface, including `bearerToken`, `cookie`, `sessionToken`, `headers`, and `credentials`. When those auth-context fields are set at client construction time, `client.auth.*` uses them by default and gateway/query calls inherit the same context through `Cookie`, `X-Athena-Auth-Session-Token`, and `X-Athena-Auth-Bearer-Token` when applicable.

### `createClient({ key, ...config })`

```ts
function createClient(
  config: Pick<AthenaGatewayCallOptions, "client" | "headers" | "backend"> & {
    key: string | null | undefined
    client?: string | null | undefined
    userId?: string | null | undefined
    organizationId?: string | null | undefined
    forceNoCache?: boolean
    pgUri?: string | null | undefined
    jdbcUrl?: string | null | undefined
    athenaKey?: string | null | undefined
    url?: string | null | undefined
    db?: { url?: string | null | undefined }
    gateway?: { url?: string | null | undefined }
    auth?: AthenaAuthClientConfig & { url?: string | null | undefined; baseUrl?: string | null | undefined }
    chat?: { url?: string | null | undefined; wsUrl?: string | null | undefined; webSocketFactory?: AthenaChatWebSocketFactory | null | undefined }
    storage?: { url?: string | null | undefined }
    dbUrl?: string | null | undefined
    gatewayUrl?: string | null | undefined
    authUrl?: string | null | undefined
    chatUrl?: string | null | undefined
    chatWsUrl?: string | null | undefined
    storageUrl?: string | null | undefined
    experimental?: {
      athenaStorageBackend?: boolean
      debugAst?: boolean
      enableErrorNormalization?: boolean
      findManyAst?: boolean
      retryReads?: boolean
      traceQueries?: boolean | AthenaQueryTraceOptions
      typecheckColumns?: boolean
      storage?: AthenaStorageClientConfig
    }
  }
): AthenaSdkClientWithAuth
```

The object form is the backwards-compatible escape hatch for direct service URLs. Resolution order is:

- DB: `db.url` -> `gateway.url` -> `dbUrl` -> `gatewayUrl` -> `${url}/db`
- Auth: `auth.url` -> `auth.baseUrl` -> `authUrl` -> `${url}/auth`
- Chat HTTP: `chat.url` -> `chatUrl` -> `${url}/chat`
- Chat realtime: `chat.wsUrl` -> `chatWsUrl` -> derived unified-root websocket URL
- Storage: `storage.url` -> `storageUrl` -> `${url}/storage`

Per-call overrides still win over these client-wide auth defaults. Use call-level `fetchOptions` on `client.auth.*` or call-level `headers` on gateway/query builders when you need impersonation or another one-off credential.
`forceNoCache: true` is a client-wide sticky switch. It forces `Cache-Control: no-cache` onto SDK-managed gateway, auth, and storage requests and overrides any `cache-control` header supplied through client-level or per-call headers.

`experimental.athenaStorageBackend` exposes the experimental `client.storage.*` bindings. Default clients do not include `.storage`; `createClient(..., { experimental: { athenaStorageBackend: true } })`, `AthenaClient.builder().experimental(...)`, and `AthenaClient.builder().options(...)` narrow the returned client type to `AthenaSdkClientWithStorage`.
`experimental.storage.onError` registers a client-level observer for storage request failures. It receives the same `AthenaStorageError` instance that will be thrown, and observer failures do not mask the original request error.
`experimental.enableErrorNormalization` is deprecated and retained as a no-op compatibility flag because failed `AthenaResult` values now expose structured normalized `error` objects by default.
`experimental.debugAst` builds a normalized runtime AST for each executed operation. Successful results expose it through `getAthenaDebugAst(...)`, and traced operations include it on `AthenaQueryTraceEvent.ast`.
`experimental.findManyAst` opt-ins clean `findMany(...)` calls to use direct AST bodies on `/gateway/fetch` when the request is lossless there; shorthand `where` values are normalized, UUID-like equality filters still fall back to the legacy query path, and nested relation select strings stay off SQL query fallback.
`experimental.retryReads` enables fixed-policy retries for retryable read failures on `select`, `findMany(...)`, and `query(...)`. It performs two additional attempts internally and does not retry writes.
`experimental.traceQueries` emits detailed query execution diagnostics for every runtime call.
`experimental.typecheckColumns` is type-only. When the row keys are known from `from<Table>()`, `from(model)`, `fromModel(...)`, `db.from<Row>(...)`, `db.select<Row>(table).single(...)`, or typed RPC result generics, the SDK validates simple string selects, array literals, and RPC filter/order column names at compile time. Typed `db.select<Row>(table, columns)` is intentionally not supported; use `db.from<Row>(table).select(columns)` when you want inline typed column selection.
For deferred builders, trace callsites are captured from the public SDK seam that declared or finalized the operation and are memoized through the eventual execution, so traces stay anchored to user code across local and CI stack differences.

### `client.withContext(context?)`

```ts
interface AthenaClientContextOptions {
  userId?: string | null | undefined
  organizationId?: string | null | undefined
  forceNoCache?: boolean
  headers?: Record<string, string>
  auth?: {
    bearerToken?: string | null | undefined
    cookie?: string | null | undefined
    sessionToken?: string | null | undefined
    headers?: Record<string, string>
    credentials?: AthenaAuthCredentials
    signal?: AbortSignal
  }
}

interface AthenaSdkClient {
  withContext(context?: AthenaClientContextOptions): AthenaSdkClient
}

interface AthenaSdkClientWithAuth extends AthenaSdkClient {
  withContext(context?: AthenaClientContextOptions): AthenaSdkClientWithAuth
}

interface AthenaSdkClientWithStorage extends AthenaSdkClientWithAuth {
  withContext(context?: AthenaClientContextOptions): AthenaSdkClientWithStorage
}
```

Derives a request-scoped client without mutating the base client.

Behavior:

- binds `userId`, `organizationId`, auth tokens/cookies, extra headers, and `forceNoCache`
- keeps the original `url`, `key`, `client`, and service URLs intact
- storage-enabled clients keep `.storage`
- strict-column clients keep their compile-time column checks

Use this for session-scoped or tenant-scoped requests. It is the preferred alternative to manually building `X-User-Id`, `X-Organization-Id`, `Cookie`, or bearer-token headers in application wrappers.

### `client.withOptions(options?)`

```ts
interface AthenaClientOverrideOptions extends Omit<AthenaCreateClientOptions, "experimental"> {
  url?: string | null | undefined
  key?: string | null | undefined
}

interface AthenaSdkClientWithAuth {
  withOptions(options?: AthenaClientOverrideOptions): AthenaSdkClientWithAuth
}

interface AthenaSdkClientWithStorage extends AthenaSdkClientWithAuth {
  withOptions(options?: AthenaClientOverrideOptions): AthenaSdkClientWithStorage
}
```

Derives a new client from an existing one without mutating the base client.

Behavior:

- headers merge with the base client headers
- `auth.headers` merge with the base auth headers
- `url`, `key`, `client`, `userId`, `organizationId`, `db`, `gateway`, `auth`, `storage`, and legacy `*Url` aliases can all be overridden
- `undefined` override values do not clear the base client configuration
- storage-enabled clients keep `.storage`
- strict-column clients keep their compile-time column checks

This is the advanced escape hatch. Prefer `withContext(...)` for normal request-scoped auth/session/tenant binding.

### `client.withSession(session, options?)`

```ts
interface AthenaClientSessionLike {
  user?: {
    id?: string | null | undefined
  } | null | undefined
  session?: {
    token?: string | null | undefined
    activeOrganizationId?: string | null | undefined
  } | null | undefined
}

interface AthenaClientSessionOptions extends AthenaClientContextOptions {
  requestHeaders?: AthenaHeaderBag | Record<string, string | null | undefined>
}

interface AthenaSdkClient {
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): AthenaSdkClient
}
```

Derives a request-scoped client from a session-shaped object plus optional request headers.

Behavior:

- derives `userId` from `session.user.id`
- derives `organizationId` from `session.session.activeOrganizationId`
- derives `bearerToken` and `sessionToken` from `session.session.token`
- derives auth cookies from `options.requestHeaders`
- still accepts explicit overrides through `options.headers`, `options.auth`, and `forceNoCache`

Use this when you already have a Better Auth-style or Athena-style session object and want the shortest possible SDK setup in route handlers or server actions.

### `client.request(options)`

```ts
type AthenaRequestService = "db" | "auth" | "chat" | "storage"

type AthenaRequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"

interface AthenaRequestQueryValueMap {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | Array<string | number | boolean | null | undefined>
}

interface AthenaRequestOptions {
  service?: AthenaRequestService
  url?: string
  path?: string
  method?: AthenaRequestMethod
  headers?: Record<string, string>
  apiKey?: string | null
  athenaKey?: string | null
  query?: AthenaRequestQueryValueMap
  body?: RequestInit["body"] | Record<string, unknown> | unknown[] | null
  signal?: AbortSignal
  credentials?: RequestInit["credentials"]
  responseType?: "json" | "text" | "response"
}

interface AthenaRequestResponse<T = unknown> {
  ok: boolean
  status: number
  statusText: string
  headers: Headers
  data: T | string | null
  raw: Response
}
```

`client.request(...)` is the low-level escape hatch for routes the fluent SDK does not wrap yet.

Behavior:

- use `service` plus `path` to target a configured SDK service
- use `url` to bypass service routing and hit an absolute URL directly
- configured API key, `X-Athena-Client`, auth session/bearer context, and scoped `userId` / `organizationId` headers are mirrored automatically on configured service calls
- `apiKey` and `athenaKey` on the request options override the client defaults for that call only
- `responseType: "json"` is the default; use `"text"` or `"response"` when you need raw transport control

See [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md) for end-to-end examples across gateway, auth, chat, and storage.

### `AthenaQueryTraceOptions`

```ts
interface AthenaQueryTraceOptions {
  logger?: (event: AthenaQueryTraceEvent) => void
}
```

### `AthenaQueryTraceEvent`

```ts
interface AthenaQueryTraceEvent {
  timestamp: string
  durationMs: number
  operation: "select" | "insert" | "upsert" | "update" | "delete" | "rpc" | "query"
  endpoint:
    | "/gateway/fetch"
    | "/gateway/insert"
    | "/gateway/update"
    | "/gateway/delete"
    | "/gateway/rpc"
    | "/gateway/query"
    | `/rpc/${string}`
  table?: string
  functionName?: string
  sql: string
  payload: unknown
  ast?: AthenaQueryDebugAst
  options?: AthenaGatewayCallOptions | AthenaRpcCallOptions
  callsite: AthenaQueryTraceCallsite | null
  outcome?: {
    status: number
    error: AthenaResultError | null
    errorDetails?: AthenaGatewayErrorDetails | null
    count?: number | null
    data: unknown
    raw: unknown
  }
  thrownError?: unknown
}

interface AthenaQueryTraceCallsite {
  filePath: string
  fileName: string
  line: number
  column: number
  frame?: string
  functionName?: string
}
```

### `@xylex-group/athena/utils` subpath

```ts
import {
  asString,
  asBoolean,
  asBooleanOrNull,
  asRecord,
  asIdentifier,
  firstString,
  readTrimmedString,
  asNumber,
  asStringArray,
  slugify,
  trimTrailingSlashes,
  parseBooleanFlag,
  isLocalHostname,
  clearAuthCookies,
  proxyRequestHeaders,
  sqlText,
  escapeLikePatternValue,
  quoteSqlStringLiteral,
  sqlNullableText,
  sqlJsonbLiteral,
  sqlBigInt,
} from "@xylex-group/athena/utils"
```

```ts
function slugify(input: string): string
```

- lowercases
- replaces non `[a-z0-9]` groups with `-`
- trims leading/trailing `-`
- caps output length at `64`

```ts
function trimTrailingSlashes(value: string): string
```

Removes one or more trailing `/` characters from a string.

```ts
function asString(value: unknown): string | null
```

Coerces finite numbers, bigint values, and non-empty trimmed strings to strings.

```ts
function asBoolean(value: unknown): boolean
```

Coerces booleans, numbers, and common string tokens (`true/false`, `1/0`, `yes/no`, `y/n`, `on/off`) to a boolean. Unrecognized values return `false`.

```ts
function asBooleanOrNull(value: unknown): boolean | null
```

Same coercion rules as `asBoolean`, but returns `null` for unrecognized values.

```ts
function asRecord(value: unknown): Record<string, unknown> | null
```

Returns plain object-like records and rejects arrays, null, and primitives.

```ts
function asIdentifier(value: unknown): string | null
```

Coerces id-like values to a string. This is for payload values, not SQL quoting; use `identifier(...)` for SQL identifiers.

```ts
function firstString(record: Record<string, unknown> | null | undefined, keys: readonly string[]): string | null
```

Returns the first present non-empty string-like value from the provided keys.

```ts
function readTrimmedString(value: unknown): string | null
```

Returns a trimmed string or `null` when the input is not a non-empty string.

```ts
function asNumber(value: unknown): number | null
```

Returns finite numbers from numeric inputs or numeric strings.

```ts
function asStringArray(value: unknown): string[]
```

Trims string array entries and drops empty or non-string values.

```ts
function parseBooleanFlag(rawValue: string | undefined, fallback: boolean): boolean
```

Parses common boolean flag tokens (`1/0`, `true/false`, `yes/no`, `on/off`) and returns `fallback` for empty or unrecognized input.

```ts
function isLocalHostname(hostname: string): boolean
```

Returns `true` for local/loopback hosts such as:

- `localhost` and `*.localhost`
- `127.0.0.1` and `127.*.*.*`
- `::1`, `[::1]`, `0:0:0:0:0:0:0:1`

```ts
function sqlText(value: string): string
```

Returns a PostgreSQL dollar-quoted literal safe for raw SQL value interpolation.

```ts
function escapeLikePatternValue(value: string): string
```

Escapes `%`, `_`, and `\` for SQL `LIKE` / `ILIKE` pattern literals.

```ts
function quoteSqlStringLiteral(value: string): string
```

Returns a single-quoted SQL string literal with embedded apostrophes escaped as `''`.

```ts
function sqlNullableText(value: string | null | undefined): string
```

Returns `NULL` for nullish inputs, otherwise a dollar-quoted string literal.

```ts
function sqlJsonbLiteral(value: unknown): string
```

JSON-serializes a value, wraps it as a dollar-quoted literal, and appends `::jsonb`.

```ts
function sqlBigInt(value: bigint | number): string
```

Returns an explicit `::bigint` SQL literal.

```ts
interface ClearAuthCookiesOptions {
  prefixes?: string[]
  hostname?: string
  path?: string
  cookieHeader?: string
}

function clearAuthCookies(options?: ClearAuthCookiesOptions): string[]
```

`clearAuthCookies(...)` is browser-oriented and safely returns `[]` when no browser cookie store is available.

```ts
function proxyRequestHeaders(request: Request): Headers
```

Creates a cloned `Headers` set suitable for upstream proxy calls and normalizes forwarding headers:

- removes `host`
- sets `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-origin`, `x-forwarded-uri`
- sets `x-forwarded-port` only when the request URL includes an explicit port

### `AthenaClient.fromEnvironment()`

Reads:

- URL aliases: `ATHENA_URL`, `NEXT_PUBLIC_ATHENA_URL`
- gateway URL aliases: `ATHENA_DB_URL`, `ATHENA_GATEWAY_URL`, `NEXT_PUBLIC_ATHENA_DB_API_URL`
- API key aliases: `ATHENA_API_KEY`, `NEXT_PUBLIC_ATHENA_API_KEY`, `ATHENA_GATEWAY_API_KEY`, `X_API_KEY`
- client aliases: `ATHENA_CLIENT`, `NEXT_PUBLIC_ATHENA_CLIENT`
- auth URL aliases: `ATHENA_AUTH_URL`, `NEXT_PUBLIC_ATHENA_AUTH_URL`
- storage URL aliases: `ATHENA_STORAGE_URL`, `NEXT_PUBLIC_ATHENA_STORAGE_URL`
- chat URL aliases: `ATHENA_CHAT_URL`, `NEXT_PUBLIC_ATHENA_CHAT_URL`
- chat websocket URL aliases: `ATHENA_CHAT_WS_URL`, `NEXT_PUBLIC_ATHENA_CHAT_WS_URL`

`AthenaClient.fromEnvironment(options?)` also accepts ordinary `createClient(...)` options plus:

```ts
interface AthenaClientFromEnvironmentOptions extends AthenaCreateClientOptions {
  env?: Record<string, string | undefined>
  url?: string | null | undefined
  key?: string | null | undefined
}
```

Throws when URL or key is missing.

## Chat module

`AthenaSdkClientWithAuth` now exposes:

- `chat.room.list(query?, options?)`
- `chat.room.create(input, options?)`
- `chat.room.get(roomId, options?)`
- `chat.room.update(roomId, input, options?)`
- `chat.room.archive(roomId, options?)`
- `chat.room.readCursor.upTo(roomId, input?, options?)`
- `chat.room.member.list(roomId, options?)`
- `chat.room.member.add(roomId, input, options?)`
- `chat.room.member.remove(roomId, userId, options?)`
- `chat.room.message.list(roomId, query?, options?)`
- `chat.room.message.send(roomId, input, options?)`
- `chat.room.message.update(roomId, messageId, input, options?)`
- `chat.room.message.delete(roomId, messageId, options?)`
- `chat.message.reaction.add(messageId, input, options?)`
- `chat.message.reaction.remove(messageId, emoji, options?)`
- `chat.message.search(input, options?)`
- `chat.realtime.info(options?)`
- `chat.realtime.connect(options?)`

Realtime notes:

- `chat.realtime.info()` derives its HTTP info endpoint from `chat.wsUrl` / `chatWsUrl` when needed
- `chat.realtime.connect()` uses the configured websocket URL and returns a connection helper with `send`, `readUpTo`, `ping`, and `close`

### `AthenaClient.builder()`

```ts
interface AthenaClientBuilder<StorageEnabled extends boolean = false> {
  url(url: string): AthenaClientBuilder<StorageEnabled>
  key(apiKey: string): AthenaClientBuilder<StorageEnabled>
  athenaKey(athenaKey: string | null | undefined): AthenaClientBuilder<StorageEnabled>
  pgUri(pgUri: string | null | undefined): AthenaClientBuilder<StorageEnabled>
  jdbcUrl(jdbcUrl: string | null | undefined): AthenaClientBuilder<StorageEnabled>
  backend(backend: BackendConfig | BackendType): AthenaClientBuilder<StorageEnabled>
  client(clientName: string): AthenaClientBuilder<StorageEnabled>
  headers(headers: Record<string, string>): AthenaClientBuilder<StorageEnabled>
  auth(config: AthenaAuthClientConfig): AthenaClientBuilder<StorageEnabled>
  experimental(options: AthenaClientExperimentalOptions & { athenaStorageBackend: true }): AthenaClientBuilder<true>
  experimental(options: AthenaClientExperimentalOptions): AthenaClientBuilder<StorageEnabled>
  options(options: AthenaCreateClientOptionsWithStorage): AthenaClientBuilder<true>
  options(options: AthenaCreateClientOptions): AthenaClientBuilder<StorageEnabled>
  build(): StorageEnabled extends true ? AthenaSdkClientWithStorage : AthenaSdkClientWithAuth
}
```

`build()` requires both URL and key.

Behavior notes:

- `build()` returns `AthenaSdkClientWithAuth` by default (same contract as `createClient(...)`)
- storage-enabled builder calls narrow `build()` to `AthenaSdkClientWithStorage`
- `auth(...)`, `experimental(...)`, and `options(...)` are additive
- repeated `auth(...)`/`options({ auth })` calls merge auth headers and fields
- repeated `experimental(...)`/`options({ experimental })` calls merge flags (including `traceQueries` object config)

### Backend constants

```ts
const Backend = {
  Athena: { type: "athena" },
  Postgrest: { type: "postgrest" },
  PostgreSQL: { type: "postgresql" },
  ScyllaDB: { type: "scylladb" },
} as const;
```

`BackendType`:

```ts
type BackendType = "athena" | "postgrest" | "postgresql" | "scylladb"
```

## Query runtime API

### `AthenaSdkClient`

```ts
interface AthenaSdkClient {
  from<TModel extends AthenaModelTarget>(
    model: TModel,
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>>
  from<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update>
  db: AthenaDbModule

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>

  query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>>
}

interface AthenaSdkClientWithAuth extends AthenaSdkClient {
  auth: AthenaAuthBindings
}

interface AthenaSdkClientWithStorage extends AthenaSdkClientWithAuth {
  storage: AthenaStorageModule
}

interface AthenaFromOptions {
  schema?: string
}

interface AthenaDbModule {
  from<TModel extends AthenaModelTarget>(
    model: TModel,
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>>
  from<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update>

  select<Row = Record<string, AthenaJsonValue | undefined>>(
    table: string,
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row, Row>
  select(
    table: string,
    columns: string | string[],
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Record<string, AthenaJsonValue | undefined>, Record<string, AthenaJsonValue | undefined>>

  insert<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    values: Insert | Insert[],
    options?: AthenaGatewayCallOptions,
  ): MutationQuery<Row> | MutationQuery<Row[]>

  upsert<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    values: Insert | Insert[],
    options?: AthenaGatewayCallOptions & { updateBody?: Update; onConflict?: string | string[] },
  ): MutationQuery<Row> | MutationQuery<Row[]>

  update<Row = Record<string, AthenaJsonValue | undefined>, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: string,
    values: Update,
    options?: AthenaGatewayCallOptions,
  ): UpdateChain<Row>

  delete<Row = Record<string, AthenaJsonValue | undefined>>(
    table: string,
    options?: AthenaGatewayCallOptions & { resourceId?: string },
  ): MutationQuery<Row | null>

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>

  query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions): Promise<AthenaResult<Row[]>>
}
```

### Storage module (experimental)

Storage bindings are only available when `experimental.athenaStorageBackend` is enabled. For workflow examples and OpenAPI route coverage, use [`storage/index.md`](storage/index.md).

```ts
const athena = createClient(url, apiKey, {
  experimental: {
    athenaStorageBackend: true,
    storage: {
      onError(error) {
        console.error(error.code, error.athenaCode, error.kind, error.toDetails())
      },
    },
  },
})

const { file, upload } = await athena.storage.createStorageUploadUrl({
  s3_id: "s3_1",
  bucket: "documents",
  storage_key: "reports/report.pdf",
})

const uploaded = await athena.storage.file.upload({
  s3_id: "s3_1",
  bucket: "documents",
  files: selectedFile,
  extensions: ["pdf"],
  maxFileSizeMb: 25,
})

const response = await athena.storage.getStorageFileProxy("file_1", {
  purpose: "download",
})
const bytes = await response.arrayBuffer()

await athena.storage.delete("file_1")
```

```ts
interface AthenaStorageModule {
  credentials: AthenaStorageCredentialsNamespace
  catalog: AthenaStorageCatalogNamespace
  file: AthenaStorageFileNamespace
  folder: AthenaStorageFolderNamespace
  permission: AthenaStoragePermissionNamespace
  object: AthenaStorageObjectNamespace
  bucket: AthenaStorageBucketNamespace
  multipart: AthenaStorageMultipartNamespace
  audit: AthenaStorageAuditNamespace
  delete(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  delete(fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>
  listStorageCatalogs(options?: AthenaStorageCallOptions): Promise<{ data: S3CatalogItem[] }>
  createStorageCatalog(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions): Promise<S3CatalogItem>
  updateStorageCatalog(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions): Promise<S3CatalogItem>
  deleteStorageCatalog(id: string, options?: AthenaStorageCallOptions): Promise<{ id: string; deleted: boolean }>
  listStorageCredentials(options?: AthenaStorageCallOptions): Promise<{ data: S3CredentialListItem[] }>
  createStorageUploadUrl(input: CreateStorageUploadUrlRequest, options?: AthenaStorageCallOptions): Promise<StorageUploadUrlResponse>
  createStorageUploadUrls(input: CreateStorageUploadUrlsRequest, options?: AthenaStorageCallOptions): Promise<StorageBatchUploadUrlResponse>
  listStorageFiles(input: ListStorageFilesRequest, options?: AthenaStorageCallOptions): Promise<StorageListFilesResponse>
  getStorageFile(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  getStorageFileUrl(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions): Promise<PresignedFileUrlResponse>
  getStorageFileProxy(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>
  updateStorageFile(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  deleteStorageFile(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  setStorageFileVisibility(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  deleteStorageFolder(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions): Promise<StorageFolderMutationResponse>
  moveStorageFolder(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions): Promise<StorageFolderMutationResponse>
}

interface AthenaStorageFileNamespace extends AthenaStorageFileModule {
  upload(input: AthenaStorageFileUploadRequest, options?: AthenaStorageCallOptions): Promise<StorageUploadUrlResponseWithPut>
  upload(input: AthenaStorageFileUploadInput, options?: AthenaStorageCallOptions): Promise<AthenaStorageFileUploadResult>
  uploadMany(input: AthenaStorageFileUploadManyRequest, options?: AthenaStorageCallOptions): Promise<StorageBatchUploadUrlResponseWithPut>
  confirmUpload(fileId: string, input?: ConfirmStorageUploadRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  uploadBinary(fileId: string, body: AthenaStoragePutBody, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  search(input: SearchStorageFilesRequest, options?: AthenaStorageCallOptions): Promise<StorageListFilesResponse>
  get(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  update(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  download(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>
  download(fileIds: readonly string[], query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response[]>
  list(input: AthenaStorageFileListInput, options?: AthenaStorageCallOptions): Promise<StorageListFilesResponse>
  delete(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  delete(fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>
  deleteMany(input: DeleteManyStorageFilesRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationManyResponse>
  updateMany(input: UpdateManyStorageFilesRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationManyResponse>
  restore(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  purge(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  copy(fileId: string, input: CopyStorageFileRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  url(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions): Promise<PresignedFileUrlResponse>
  publicUrl(fileId: string, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  proxyUrl(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  proxy(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>
  versions(fileId: string, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  restoreVersion(fileId: string, versionId: string, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  deleteVersion(fileId: string, versionId: string, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  retention: {
    get(fileId: string, query?: Pick<StorageFileRetentionRequest, "version_id">, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    set(fileId: string, input: StorageFileRetentionRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  }
  visibility: {
    update(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
    set(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
    setMany(input: SetManyStorageFileVisibilityRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationManyResponse>
  }
}

interface AthenaStorageFolderNamespace {
  list(input: ListStorageFoldersRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  tree(input: TreeStorageFoldersRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions): Promise<StorageFolderMutationResponse>
  move(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions): Promise<StorageFolderMutationResponse>
}

interface AthenaStoragePermissionNamespace {
  list(input: StoragePermissionListRequest, options?: AthenaStorageCallOptions): Promise<StoragePermissionListResponse>
  grant(input: StoragePermissionGrantRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  revoke(input: StoragePermissionRevokeRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  check(input: StoragePermissionCheckRequest, options?: AthenaStorageCallOptions): Promise<StoragePermissionCheckResponse>
}

interface AthenaStorageObjectNamespace {
  list(input: StorageListObjectsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  head(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  exists(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  validate(input: StorageObjectValidateRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  update(input: StorageUpdateObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  copy(input: StorageObjectCopyRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  url(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  publicUrl(input: StorageObjectPublicUrlRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  uploadUrl(input: StoragePresignUploadRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  postPolicy(input: StorageSignedPostPolicyRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  versions(input: StorageObjectVersionListRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  restoreVersion(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  deleteVersion(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  folder: {
    create(input: StorageObjectFolderCreateRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    delete(input: StorageObjectFolderDeleteRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    rename(input: StorageObjectFolderRenameRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  }
}

interface AthenaStorageBucketNamespace {
  list(input: Omit<StorageObjectBaseRequest, "bucket">, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  create(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  lifecycle: {
    get(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    set(input: StorageSetBucketLifecycleRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    delete(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  }
  policy: {
    get(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    set(input: StorageSetBucketPolicyRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    delete(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  }
  publicAccess: {
    get(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    set(input: StorageSetPublicAccessBlockRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    delete(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  }
  cors: {
    get(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    set(input: StorageSetBucketCorsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
    delete(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  }
}

interface AthenaStorageMultipartNamespace {
  create(input: StorageMultipartCreateRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  signPart(input: StorageMultipartSignPartRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  complete(input: StorageMultipartCompleteRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  abort(input: StorageMultipartAbortRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  listParts(input: StorageMultipartListPartsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
}

interface AthenaStorageAuditNamespace {
  list(input: StorageAuditQueryRequest, options?: AthenaStorageCallOptions): Promise<StorageAuditListResponse>
}
```

For typed inline column selection on the DB helper surface, prefer `athena.db.from<Row>(table).select("id, email")`.

### `getAthenaDebugAst(value)`

```ts
function getAthenaDebugAst(value: unknown): AthenaQueryDebugAst | null
```

Returns the normalized debug AST previously attached to a successful result or traced/thrown error when `experimental.debugAst` is enabled.

```ts
type AthenaStorageErrorCode =
  | "INVALID_URL"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "INVALID_ATHENA_ENVELOPE"
  | "UNKNOWN_ERROR"

interface AthenaStorageClientConfig {
  prefixPath?: string | ((context: AthenaStoragePathContext) => string | null | undefined)
  vars?: Record<string, string | number | boolean | null | undefined>
  env?: Record<string, string | undefined>
  onError?: AthenaStorageErrorHandler
}

interface AthenaStorageCallOptions extends AthenaGatewayCallOptions {
  signal?: AbortSignal
  onError?: AthenaStorageErrorHandler
}

type AthenaStorageBinaryCallOptions = AthenaStorageCallOptions

type AthenaStorageErrorHandler = (error: AthenaStorageError) => void | Promise<void>

type StorageFileAccessPurpose = "read" | "download" | "stream"

class AthenaStorageError extends Error {
  code: AthenaStorageErrorCode
  athenaCode: AthenaErrorCode
  kind: AthenaErrorKind
  category: AthenaErrorCategory
  retryable: boolean
  status: number
  endpoint: AthenaGatewayEndpointPath
  method: AthenaGatewayMethod
  requestId?: string
  hint?: string
  causeDetail?: string
  raw: unknown
  normalized: NormalizedAthenaError
  toDetails(): AthenaStorageErrorDetails
}

function createAthenaStorageError(input: AthenaStorageErrorInput): AthenaStorageError
```

Raw JSON storage endpoints return the parsed response body. Athena-envelope storage endpoints unwrap `{ status, message, data }` and return `data`. `getStorageFileProxy(...)` is the binary exception: it calls `GET /storage/files/{file_id}/proxy`, accepts the current proxy purposes (`"read"`, `"download"`, and `"stream"`) through the same query shape as `getStorageFileUrl(...)`, and returns the untouched `Response` so callers can read headers such as `Content-Type`, `Content-Disposition`, `Content-Length`, `ETag`, and `Cache-Control` before choosing `.blob()`, `.arrayBuffer()`, `.text()`, or streaming.

The `file.*` helpers cover the managed storage workflow end to end: presigned upload prep, optional direct byte upload, upload confirmation, search, batch mutation helpers, version and retention helpers, and the visibility aliases. `file.visibility.update(...)` uses the compatibility `PATCH /storage/files/{file_id}/visibility` route, `file.visibility.set(...)` uses the canonical `POST` variant on the same path, and `file.visibility.setMany(...)` targets `POST /storage/files/visibility-many`. `experimental.storage.prefixPath` is prepended by `file.upload(...)` and `file.list(...)`; templates can use values such as `{organization_id}`, `{organizationId}`, `{user_id}`, `{resource_id}`, `{env.APP_ENV}`, or `${APP_ENV}`.

The grouped `folder`, `permission`, `object`, `bucket`, `multipart`, and `audit` namespaces mirror the current Athena storage route families. For the route-by-route matrix and examples, use [`storage/index.md`](storage/index.md).

React upload state is available from `useStorageUpload(...)` in `@xylex-group/athena/react`. The hook returns `{ uploading, progress, percent, error, result, upload, abort, reset }` and calls through to `athena.storage.file.upload(...)`.

All storage request failures flow through `createAthenaStorageError(...)` and throw `AthenaStorageError`. The error carries storage-specific `code`, normalized Athena fields (`athenaCode`, `kind`, `category`, `retryable`), request metadata (`status`, `endpoint`, `method`, `requestId`), diagnostic fields (`hint`, `causeDetail`, `raw`), and a hidden normalized error payload so `normalizeAthenaError(error)` returns the same normalized classification.

Storage failures can be observed globally with `experimental.storage.onError` or per call with `options.onError`. Both callbacks receive the thrown `AthenaStorageError`; callback failures are ignored so the original storage error is preserved.

## Builder contracts

### Shared filter chain (typed-column behavior)

`TableQueryBuilder`, `SelectChain`, and `UpdateChain` implement a shared filter contract.

On typed paths, column params are keyed to row fields when keys are known.
On untyped paths, column params fall back to `string`.

Methods include:

- `eq`, `eqCast`, `eqUuid`, `match`
- `range`, `limit`, `offset`, `currentPage`, `pageSize`, `totalPages`
- `order`
- `gt`, `gte`, `lt`, `lte`, `neq`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`
- `not`, `or`

`eq()` applies UUID-aware behavior for identifier-like columns.

### `TableQueryBuilder<Row, Insert, Update, Context = unknown>`

```ts
interface TableQueryBuilder<Row, Insert = Partial<Row>, Update = Partial<Insert>, Context = unknown> {
  select<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): SelectChain<Row, T>
  findMany<const TSelect extends AthenaSelectShape>(
    options: AthenaFindManyOptions<Row, TSelect>,
  ): Promise<AthenaResult<Array<AthenaFindManyResult<Row, TSelect, Context>>>>

  insert(values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row>
  insert(values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[]>

  upsert(
    values: Insert,
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update
      onConflict?: string | string[]
    },
  ): MutationQuery<Row>

  upsert(
    values: Insert[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update
      onConflict?: string | string[]
    },
  ): MutationQuery<Row[]>

  update(values: Update, options?: AthenaGatewayCallOptions): UpdateChain<Row>

  delete(options?: AthenaGatewayCallOptions & { resourceId?: string }): MutationQuery<Row | null>

  single<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<T | null>>

  reset(): TableQueryBuilder<Row, Insert, Update, Context>
}
```

Notes:

- `.findMany(...)` is an eager object-AST read surface that compiles into the existing gateway payload.
- `.select(...)` returns a chain, not an eager promise.
- The `columns` string is comma-separated, and response aliases can be requested with `customName:columnName`.
- `.delete(...)` throws if neither `id` nor `resource_id` condition is present and no `resourceId` option is supplied.
- `.reset()` clears builder state (filters/modifiers) and reuses same table target.

Example:

```ts
await athena.from("users").findMany({
  select: {
    id: true,
    profile: {
      select: {
        display_name: true,
      },
    },
  },
  where: {
    id: "u-1",
  },
})
```

### `findMany(...)` AST types

```ts
interface AthenaRelationSelectNode<TSelect extends AthenaSelectShape = AthenaSelectShape> {
  select: TSelect
  as?: string
  via?: string
  schema?: string
}

type AthenaSelectShape = Record<string, true | AthenaRelationSelectNode<any>>

type AthenaWhereOperatorInput = {
  eq?: AthenaConditionValue
  neq?: AthenaConditionValue
  gt?: AthenaConditionValue
  gte?: AthenaConditionValue
  lt?: AthenaConditionValue
  lte?: AthenaConditionValue
  like?: AthenaConditionValue
  ilike?: AthenaConditionValue
  is?: AthenaConditionValue
  in?: AthenaConditionArrayValue
  contains?: AthenaConditionArrayValue
  containedBy?: AthenaConditionArrayValue
}

type AthenaWhereColumnInput<Row = Record<string, AthenaJsonValue | undefined>> =
  Partial<Record<keyof Row & string, AthenaConditionValue | AthenaWhereOperatorInput>>

type AthenaWhereBooleanSafeOperatorInput = {
  eq?: AthenaConditionValue
  neq?: AthenaConditionValue
  gt?: AthenaConditionValue
  gte?: AthenaConditionValue
  lt?: AthenaConditionValue
  lte?: AthenaConditionValue
  like?: AthenaConditionValue
  ilike?: AthenaConditionValue
  is?: AthenaConditionValue
}

type AthenaWhereBooleanNotOperatorInput =
  | { eq: AthenaConditionValue }
  | { neq: AthenaConditionValue }
  | { gt: AthenaConditionValue }
  | { gte: AthenaConditionValue }
  | { lt: AthenaConditionValue }
  | { lte: AthenaConditionValue }
  | { like: AthenaConditionValue }
  | { ilike: AthenaConditionValue }
  | { is: AthenaConditionValue }

type AthenaWhereBooleanOperand<Row = Record<string, AthenaJsonValue | undefined>> =
  string extends keyof Row & string
    ? AthenaWhereColumnInput<Row>
    : {
        [K in keyof Row & string]: {
          [P in K]: AthenaConditionValue | AthenaWhereBooleanSafeOperatorInput
        } & Partial<Record<Exclude<keyof Row & string, K>, never>>
      }[keyof Row & string]

type AthenaWhereNotOperand<Row = Record<string, AthenaJsonValue | undefined>> =
  string extends keyof Row & string
    ? AthenaWhereColumnInput<Row>
    : {
        [K in keyof Row & string]: {
          [P in K]: AthenaConditionValue | AthenaWhereBooleanNotOperatorInput
        } & Partial<Record<Exclude<keyof Row & string, K>, never>>
      }[keyof Row & string]

type AthenaWhere<Row = Record<string, AthenaJsonValue | undefined>> =
  AthenaWhereColumnInput<Row> & {
    or?: [AthenaWhereBooleanOperand<Row>, ...AthenaWhereBooleanOperand<Row>[]]
    not?: AthenaWhereNotOperand<Row>
  }

type AthenaOrderBy<Row = Record<string, AthenaJsonValue | undefined>> =
  | {
      column: keyof Row & string
      ascending?: boolean
    }
  | Partial<
      Record<
        keyof Row & string,
        "asc" | "desc" | "ascending" | "descending" | boolean | { ascending?: boolean }
      >
    >

interface AthenaFindManyOptions<Row, TSelect extends AthenaSelectShape> {
  select: TSelect
  where?: AthenaWhere<Row>
  orderBy?: AthenaOrderBy<Row>
  limit?: number
}
```

Schema-qualified base table + relation example:

```ts
await athena.from("chat_subscriptions", { schema: "private" }).findMany({
  select: {
    user_id: true,
    user: {
      schema: "athena",
      select: {
        id: true,
      },
    },
  },
})
```

Notes:

- `select` is required.
- `where` scalar values compile to `eq`.
- On typed rows, each `where.or` clause must target exactly one known column and only use scalar lossless operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`).
- On typed rows, `where.not` must target exactly one known column and use either an `eq` shorthand value or a single scalar lossless operator.
- On untyped rows, runtime validation still enforces the same boolean-clause transport constraints.
- `orderBy` supports one column in v1.
- `as` and `via` are the escape hatches for aliased or ambiguous relation joins.

### `SelectChain<Row, SelectedRow = Row>`

```ts
interface SelectChain<Row, SelectedRow = Row>
  extends PromiseLike<AthenaResult<SelectedRow[]>> {
  single<T = SelectedRow>(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>

  maybeSingle<T = SelectedRow>(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<T | null>>
}
```

`await`/`.then(...)` executes the read.

### `MutationQuery<Result>`

```ts
interface MutationQuery<Result> extends PromiseLike<AthenaResult<Result>> {
  select(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>
  returning(columns?: string | string[], options?: AthenaGatewayCallOptions): Promise<AthenaResult<Result>>

  single(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Result extends Array<infer Item> ? Item | null : Result | null>>

  maybeSingle(
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Result extends Array<infer Item> ? Item | null : Result | null>>
}
```

### `UpdateChain<Row>`

```ts
interface UpdateChain<Row> extends MutationQuery<Row[]> {}
```

### `RpcQueryBuilder<Row>`

```ts
interface RpcQueryBuilder<Row> extends PromiseLike<AthenaResult<Row[]>> {
  eq(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  neq(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  gt(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  gte(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  lt(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  lte(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  like(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  ilike(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  is(column: string, value: AthenaConditionValue): RpcQueryBuilder<Row>
  in(column: string, values: AthenaConditionArrayValue): RpcQueryBuilder<Row>
  order(column: string, options?: { ascending?: boolean }): RpcQueryBuilder<Row>
  limit(count: number): RpcQueryBuilder<Row>
  offset(count: number): RpcQueryBuilder<Row>
  range(from: number, to: number): RpcQueryBuilder<Row>

  select(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<Row[]>>
  single<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<T | null>>
  maybeSingle<T = Row>(columns?: string | string[], options?: AthenaRpcCallOptions): Promise<AthenaResult<T | null>>
}
```

`rpc(fn, ...)` requires a non-empty function name.

## Gateway types and payloads

### JSON-safe primitives

```ts
type AthenaJsonPrimitive = string | number | boolean | null

type AthenaJsonValue = AthenaJsonPrimitive | AthenaJsonObject | AthenaJsonArray

interface AthenaJsonObject {
  [key: string]: AthenaJsonValue
}

type AthenaJsonArray = AthenaJsonValue[]
```

### Condition primitives

```ts
type AthenaConditionValue = AthenaJsonPrimitive
type AthenaConditionArrayValue = Array<AthenaConditionValue>
type AthenaConditionCastType = string
```

### `AthenaGatewayCallOptions`

```ts
interface AthenaGatewayCallOptions {
  baseUrl?: string
  apiKey?: string
  athenaKey?: string | null
  client?: string
  backend?: BackendConfig | BackendType
  publishEvent?: string
  forceNoCache?: boolean
  pgUri?: string | null
  jdbcUrl?: string | null
  bearerToken?: string | null
  cookie?: string | null
  sessionToken?: string | null
  headers?: Record<string, string>
  userId?: string | null
  organizationId?: string | null

  schema?: string
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  defaultToNull?: boolean
  stripNulls?: boolean
  onConflict?: string | string[]
  updateBody?: AthenaJsonObject
}
```

Behavior notes:

- `key` / `apiKey` set `apikey`, `x-api-key`, `X-Api-Key`, and `X-Athena-Key` (unless `athenaKey` overrides the last header).
- `athenaKey` sets `X-Athena-Key` only; per-call `apiKey` / `athenaKey` override client defaults.
- If `headers.Cookie` includes an Athena auth session cookie such as `athena-auth.session_token` or `athena-auth.session-token`, the gateway request also sends `X-Athena-Auth-Session-Token` with the parsed token.
- If `headers.Authorization` is `Bearer <token>`, the gateway request also sends `X-Athena-Auth-Bearer-Token` with the bare token.
- The original `Cookie` and `Authorization` headers are still forwarded unchanged.
- `createClient(..., { auth: { bearerToken } })` also mirrors that bearer token onto gateway requests as `X-Athena-Auth-Bearer-Token`.
- `pgUri` and `jdbcUrl` forward OpenAPI PostgreSQL routing headers (`x-pg-uri`, `x-athena-jdbc-url`, `x-jdbc-url`).
- For precedence rules, browser/server caveats, cookbook examples, and rollout guidance, use [`auth-session-forwarding.md`](auth-session-forwarding.md) and [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md).

### `AthenaRpcCallOptions`

```ts
interface AthenaRpcCallOptions extends AthenaGatewayCallOptions {
  count?: "exact" | "planned" | "estimated"
  get?: boolean
}
```

### `AthenaChatCallOptions`

```ts
type AthenaChatCallOptions = Pick<
  AthenaGatewayBaseOptions,
  | "headers"
  | "client"
  | "apiKey"
  | "athenaKey"
  | "bearerToken"
  | "cookie"
  | "sessionToken"
  | "forceNoCache"
> & {
  signal?: AbortSignal
}
```

Chat call options reuse the gateway base auth/key fields plus optional `AbortSignal`. See [`request-headers-and-auth-examples.md`](request-headers-and-auth-examples.md).

### Fetch payload

```ts
interface AthenaFetchPayload {
  view_name?: string
  table_name?: string
  columns?: string[] | string
  conditions?: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  current_page?: number
  page_size?: number
  total_pages?: number
  strip_nulls?: boolean
  group_by?: string
  time_granularity?: "day" | "hour" | "minute"
  aggregation_column?: string
  aggregation_strategy?: "cumulative_sum"
  aggregation_dedup?: boolean
  sort_by?: AthenaSortBy
}
```

### Insert payload

```ts
interface AthenaInsertPayload<TInsertBody = AthenaJsonObject, TUpdateBody = AthenaJsonObject> {
  table_name: string
  insert_body: TInsertBody | TInsertBody[]
  update_body?: TUpdateBody
  columns?: string[] | string
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  default_to_null?: boolean
  on_conflict?: string | string[]
}
```

### Update payload

```ts
interface AthenaUpdatePayload<TUpdateBody = AthenaJsonObject> extends AthenaFetchPayload {
  set?: TUpdateBody
  data?: TUpdateBody
}
```

### Delete payload

```ts
interface AthenaDeletePayload {
  table_name: string
  resource_id?: string
  columns?: string[] | string
  conditions?: AthenaGatewayCondition[]
  sort_by?: AthenaSortBy
  current_page?: number
  page_size?: number
  total_pages?: number
}
```

### RPC payload

```ts
interface AthenaRpcPayload<TArgs = AthenaJsonObject> {
  function: string
  function_name?: string
  schema?: string
  args?: TArgs
  select?: string
  filters?: AthenaRpcFilter[]
  count?: "exact" | "planned" | "estimated"
  head?: boolean
  limit?: number
  offset?: number
  order?: AthenaRpcOrder
}
```

### Query payload

```ts
interface AthenaQueryPayload {
  query: string
}
```

## Gateway response/error contracts

```ts
interface AthenaGatewayResponse<T = unknown> {
  ok: boolean
  status: number
  statusText?: string | null
  data: T | null
  count?: number | null
  error?: string
  errorDetails?: AthenaGatewayErrorDetails | null
  raw: unknown
}

type AthenaGatewayErrorCode =
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "UNKNOWN_ERROR"

interface AthenaGatewayErrorDetails {
  code: AthenaGatewayErrorCode
  message: string
  status: number
  endpoint?: "/gateway/fetch" | "/gateway/insert" | "/gateway/update" | "/gateway/delete" | "/gateway/rpc" | "/gateway/query" | `/rpc/${string}`
  method?: "GET" | "POST" | "PUT" | "DELETE"
  requestId?: string
  hint?: string
  cause?: string
}
```

Gateway error utilities:

- `AthenaGatewayError`
- `isAthenaGatewayError(error)`

## Error and result helpers (`auxiliaries`)

### Error classification primitives

```ts
type AthenaErrorKind = "unique_violation" | "not_found" | "validation" | "auth" | "rate_limit" | "transient" | "unknown"

type AthenaErrorCode =
  | "UNIQUE_VIOLATION"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "AUTH_UNAUTHORIZED"
  | "AUTH_FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK_UNAVAILABLE"
  | "TRANSIENT_FAILURE"
  | "HTTP_FAILURE"
  | "UNKNOWN"

type AthenaErrorCategory = "transport" | "client" | "server" | "database" | "unknown"
```

### Main helpers

- `isOk(result)`
- `normalizeAthenaError(input, context?)` (deprecated)
- `unwrapRows(result, options?)`
- `unwrap(result, options?)`
- `unwrapOne(result, options?)`
- `requireSuccess(result, context?)`
- `requireAffected(result, { min? }, context?)`
- `coerceInt(value, options?)`
- `assertInt(value, label?, options?)`
- `withRetry(config, fn)` (deprecated)
- `AthenaError` class

`normalizeAthenaError(...)` is deprecated. Prefer the structured `result.error` envelope on failed `AthenaResult` values and the fields already attached to thrown SDK errors.
`withRetry(...)` is deprecated. Prefer `experimental.retryReads` for normal SDK-managed read retries, or an explicit app-local retry policy when you need custom replay behavior.

## Typed schema and registry API

### Model declarations

```ts
function defineModel<Row, Insert = Partial<Row>, Update = Partial<Insert>, Meta extends ModelMetadata<Row> = ModelMetadata<Row>>(
  input: { meta: Meta },
): ModelDef<Row, Insert, Update, Meta>

function defineSchema<Models extends Record<string, AnyModelDef>>(models: Models): SchemaDef<Models>
function defineDatabase<Schemas extends Record<string, SchemaDef<Record<string, AnyModelDef>>>>(schemas: Schemas): DatabaseDef<Schemas>
function defineRegistry<Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>>(databases: Databases): RegistryDef<Databases>
```

`defineModel(...)` is deprecated. Prefer `table(...).schema(...).columns(...).primaryKey(...)` for new model contracts, while `defineSchema(...)`, `defineDatabase(...)`, and `defineRegistry(...)` remain the active registry grouping helpers.

### Typed client

```ts
interface TypedClientOptions<TMap extends TenantKeyMap = TenantKeyMap>
  extends Pick<
    AthenaGatewayCallOptions,
    "backend" | "client" | "headers" | "forceNoCache" | "userId" | "organizationId"
  > {
  tenantKeyMap?: TMap
  tenantContext?: TenantContext<TMap>
}

interface TypedAthenaClient<TRegistry, TTenantMap> extends AthenaSdkClient {
  readonly registry: TRegistry
  readonly tenantKeyMap: Readonly<TTenantMap>
  readonly tenantContext: TenantContext<TTenantMap>

  withContext(context?: AthenaClientContextOptions): TypedAthenaClient<TRegistry, TTenantMap>
  withTenantContext(context: TenantContext<TTenantMap>): TypedAthenaClient<TRegistry, TTenantMap>

  fromModel<
    TDatabase extends keyof TRegistry & string,
    TSchema extends keyof TRegistry[TDatabase]["schemas"] & string,
    TModel extends keyof TRegistry[TDatabase]["schemas"][TSchema]["models"] & string,
  >(
    database: TDatabase,
    schema: TSchema,
    model: TModel,
  ): TableQueryBuilder<
    RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    InsertOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    UpdateOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>
  >
}

function createTypedClient(registry, url, apiKey, options?): TypedAthenaClient
```

`withContext(...)` is the preferred request-scoped API for typed clients too. Use it for `userId`, `organizationId`, `forceNoCache`, and extra request headers. Keep `withTenantContext(...)` for `tenantKeyMap`-driven header values.

### Utility types

- `ModelDef`, `SchemaDef`, `DatabaseDef`, `RegistryDef`
- `RowOf<TModel>`
- `InsertOf<TModel>`
- `UpdateOf<TModel>`
- `ModelAt<TRegistry, TDatabase, TSchema, TModel>`
- `TenantKeyMap`, `TenantContext`, `TenantContextValue`
- introspection types (`IntrospectionSnapshot`, `IntrospectionTable`, etc.)

## Generator API

Runtime exports:

- `defineGeneratorConfig`
- `findGeneratorConfigPath`
- `generatorEnv`
- `loadGeneratorConfig`
- `normalizeGeneratorConfig`
- `resolveGeneratorProvider`
- `generateArtifactsFromSnapshot`
- `runSchemaGenerator`
- `resolvePostgresColumnType`
- `normalizeSchemaSelection`
- `resolveProviderSchemas`
- `DEFAULT_POSTGRES_SCHEMAS`

Config root type:

```ts
interface AthenaGeneratorConfig {
  provider: GeneratorProviderInputConfig
  output?: GeneratorOutputConfig
  naming?: Partial<GeneratorNamingConfig>
  filter?: GeneratorFilterConfig
  features?: Partial<GeneratorFeatureFlags>
  experimental?: Partial<GeneratorExperimentalFlags>
}
```

`runSchemaGenerator(...)` returns the normalized generator config, filtered snapshot, generated files, written files, and skipped protected artifacts (unless dry-run).
`loadGeneratorConfig(...)` now also supports env-only fallback when no `athena.config.*` file exists.

## React integration (`@xylex-group/athena/react`)

### Gateway hook

```ts
useAthenaGateway(config?: AthenaGatewayHookConfig): AthenaGatewayHookResult
```

Hook result methods:

- `fetchGateway`
- `insertGateway`
- `updateGateway`
- `deleteGateway`
- `rpcGateway`

State fields:

- `isLoading`
- `error`
- `lastRequest`
- `lastResponse`
- `baseUrl`

### Query runtime exports

- `AthenaQueryClient`
- `createAthenaQueryClient`
- `attachStateAdapter`
- `AthenaQueryClientProvider`
- `useAthenaQueryClient`
- `useQuery`
- `useMutation`

Default runtime stance is intentionally conservative:

- cache mode defaults to `none`
- retries default to `0`
- focus/refetch behavior is restrained by default

## Validation commands

Use these after API surface or typed-contract updates:

```bash
pnpm typecheck
pnpm check:all
```

For generator-related changes also run:
Use these after large API-level updates or generated contract changes.
## Generator configuration quick reference (from docs/generator-config.md)

### Defaults recap

- `provider` can be satisfied either by a config file or by env-only fallback keys.
- output targets:
  - `model`: `athena/models/{schema_kebab}/{model_kebab}.ts`
  - `schema`: `athena/schemas/{schema_kebab}.ts`
  - `database`: `athena/relations.ts`
  - `registry`: `athena/registry.generated.ts` (default safe direct preset)
- default safe direct preset:
  - `output.preset: "athena-direct"`
  - pairs with the default `output.format: "table-builder"`
  - keeps registry output on `athena/registry.generated.ts`
- naming:
  - `modelType: "pascal"`
  - `modelConst: "camel"`
  - `schemaConst: "camel"`
  - `databaseConst: "camel"`
  - `registryConst: "camel"`
- feature flags:
  - `emitRelations: true`
  - `emitRegistry: true`
- filters:
  - `filter.includeTables`: optional table allow-list
  - `filter.excludeTables`: optional table deny-list
- experimental:
  - `postgresGatewayIntrospection: false`
  - `scyllaProviderContracts: true`

### Config discovery

Generator config discovery checks in order:

1. `athena.config.ts`
2. `athena.config.js`
3. `athena-js.config.ts`
4. `athena-js.config.js`
5. `.athena.config.ts`
6. `.athena.config.js`

### Command line usage

- `athena-js generate`
- `athena-js generate --dry-run`
- `athena-js generate --config ./path/to/config`

Env-only examples:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run
```

```bash
ATHENA_URL=https://athena-db.com ATHENA_API_KEY=secret ATHENA_GENERATOR_DB=app_db athena-js generate --dry-run
```

If you need concrete examples and troubleshooting scenarios, use the full
[`generator-config.md`](generator-config.md) page.

### Env-backed config note

Generator config files can stay fully env-driven without losing type safety:

- `generatorEnv("DATABASE_URL")` for required strings such as `provider.connectionString`
- `generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", { default: ["public", "athena"] })` for schema lists
- `generatorEnv.boolean("ATHENA_GENERATOR_EMIT_REGISTRY", { default: true })` for flags
- `generatorEnv.oneOf("ATHENA_GENERATOR_MODEL_TYPE", ["camel", "pascal"] as const, { default: "pascal" })` for string unions
- `generatorEnv.json("ATHENA_GENERATOR_PLACEHOLDER_MAP", { default: {} })` for object-valued fields

```bash
athena-js generate --dry-run
```
