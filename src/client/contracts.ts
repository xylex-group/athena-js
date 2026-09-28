/**
 * Leaf construction contracts.
 *
 * These public/config types are owned here so runtime plan and materializer
 * modules never need to import the browser façade for type information.
 */

import type {
  AthenaAuthEmailAndPasswordOptions,
  AthenaAuthPasskeyOptions,
  AthenaAuthSecurityOptions,
  AthenaAuthSessionOptions,
  AthenaAuthSocialOptions,
  AthenaAuthSocialProviderOptions,
} from "../auth/config.ts";
import type { AthenaAuthHooks } from "../auth/hooks/types.ts";
import type { AthenaAuthObservabilityConfig } from "../auth/observability/types.ts";
import type {
  AthenaAuthBindings,
  AthenaAuthClientConfig,
} from "../auth/types.ts";
import type { AthenaBillingConfig } from "../billing/create-client-config.ts";
import type { AthenaBillingModule } from "../billing/module.ts";
import type {
  AthenaChatModule,
  AthenaChatWebSocketFactory,
} from "../chat/types.ts";
import type { AthenaRequestClient } from "../client-brands.ts";
import type {
  AthenaFromOptions,
  AthenaQueryTraceOptions,
  RpcQueryBuilder,
  TableQueryBuilder,
} from "../client-fluent.ts";
import type {
  AthenaRequestOptions,
  AthenaRequestResponse,
} from "../client-request.ts";
import type {
  AthenaClientAdminModule,
  AthenaClientSystemModule,
} from "./context.ts";
import type {
  AthenaClientCapabilities,
  D1DatabaseLike,
  R2BucketLike,
} from "../cloudflare/types.ts";
import type {
  AthenaExecutionModeInput,
  AthenaExecutionPreferInput,
} from "../cloudflare/execution-mode.ts";
import type { AthenaDbModule } from "../db/module.ts";
import type { AthenaSqliteConfig } from "../sqlite-local/contracts.ts";
import type { AthenaDiagnosticsMode } from "../diagnostics.ts";
import type { AthenaEmailConfig, AthenaEmailModule } from "../email/types.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaJsonObject,
  AthenaRpcCallOptions,
  BackendConfig,
  BackendType,
} from "../gateway/types.ts";
import type {
  AthenaNotificationsConfig,
  AthenaNotificationsModule,
} from "../notifications/types.ts";
import type { AthenaExecutable } from "../query/descriptor.ts";
import type { AthenaQueryClient } from "../react/query-client.ts";
import type { AthenaDataLifecycleConfig } from "../runtime/data/lifecycle/types.ts";
import type { AthenaClientAuthorizationConfigInput } from "../runtime/authorization/config.ts";
import type { AthenaPrincipalRightsProjection } from "../runtime/data/principal.ts";
import type {
  AthenaClientModelForTableName,
  AthenaClientModelsInput,
  AthenaClientTableName,
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from "../schema/types.ts";
import type {
  AthenaStorageClientConfig,
  AthenaStorageDirectUploadConfig,
  AthenaStorageModule,
} from "../storage/module.ts";
import {
  ATHENA_STORAGE_PROVIDER,
  ATHENA_STORAGE_RUNTIME,
} from "../storage/runtime/types.ts";
import type {
  StorageObjectProvider,
  StorageRuntime,
  AthenaStorageLifecycleHooks,
} from "../storage/runtime/types.ts";
import type { AthenaRequestHeaderOverrideFields } from "../utils/athena-request-headers.ts";

type MaybePromise<T> = T | Promise<T>;
type ResolvedModels<TModels> = TModels extends AthenaClientModelsInput
  ? TModels
  : never;

export interface AthenaRequestContext {
  /** Opaque, non-secret access-envelope fingerprint from Auth/Gateway. */
  accessScope?: string | null;
  bearerToken?: string | null;
  cookie?: string | null;
  forceNoCache?: boolean;
  headers?: Record<string, string>;
  organizationId?: string | null;
  policyRevision?: string | null;
  sessionToken?: string | null;
  userId?: string | null;
}

export type AthenaRequestContextProvider = () => MaybePromise<
  AthenaRequestContext | undefined
>;

export interface AthenaDbConfig {
  /**
   * Cloudflare D1 binding (e.g. `env.DB`).
   * Drop-in local DB execution for `from` / `query` / flat CRUD — same fluent API as HTTP gateway.
   * When set, `createClient` wires a D1 transport automatically (ADR 0015).
   */
  d1?: D1DatabaseLike | null;
  jdbcUrl?: string | null;
  /**
   * Direct PostgreSQL connection URI for Node server runtimes (ADR 0022).
   * When set (and mode is not explicit `gateway`), `createClient` wires a PG
   * direct transport — no Athena Gateway required for DB ops.
   * On Gateway HTTP mode, still forwarded as `x-pg-uri` for server-side routing.
   */
  pgUri?: string | null;
  /**
   * Borrowed Node `pg` Pool. Athena never calls `end()` on this handle.
   * Node/server only — ignored by browser entries.
   */
  pool?: { end(): Promise<void> } | null;
  /** Host-injected SQLite Local runtime. No native driver is bundled by Athena. */
  sqlite?: AthenaSqliteConfig | null;
  /** Default D1 session mode when using `d1` (`first-unconstrained`, `first-primary`, …). */
  sessionMode?: string | null;
  url?: string | null;
}

/**
 * Auth service config on {@link createClient}.
 *
 * Prefer intent modes for Next apps:
 * - `routing: "same-origin"` → browser `/api/auth`, proxy upstream via `upstreamUrl` / env
 * - `routing: "direct"` → absolute `url` to Athena Auth
 * - omit `routing` → legacy `url` / env / `${root}/auth` precedence
 *
 * Flat additive fields (no large discriminated union) to avoid TS2589/DTS risk.
 */
export interface AthenaAuthConfig
  extends Omit<
    AthenaAuthClientConfig,
    "baseUrl" | "apiKey" | "bearerToken" | "cookie" | "sessionToken"
  > {
  /**
   * Project Auth `user.role` (and optional store/metadata rights) onto
   * `AthenaPrincipal.rights` at session lookup. Grants stay provenance-only.
   */
  authorization?: AthenaPrincipalRightsProjection;
  /**
   * Explicit opt-in only. `createClient()` never applies Auth DDL unless
   * this is `true`. Runtime default remains `false` when omitted.
   */
  autoMigrate?: boolean;
  /** Local handler base path. Defaults to `/api/auth`. */
  basePath?: string;
  /**
   * Local email/password policy. Normalized at the auth config boundary.
   * Email *transport* belongs on `createClient({ email: { provider } })`, not on `auth`.
   */
  emailAndPassword?: AthenaAuthEmailAndPasswordOptions;
  /**
   * Embedded Auth domain lifecycle hooks (`auth.mode: "local"` only).
   * Remote Auth throws `ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME`.
   * Callbacks are not copied onto `NormalizedAthenaAuthConfig`.
   */
  hooks?: AthenaAuthHooks;
  /**
   * Execution runtime. `"local"` runs Athena Auth inside this process
   * against `db.pgUri` / `databaseUrl`. `"remote"` talks to an Auth HTTP
   * service. Omitted mode is inferred: Node + database URI + no `auth.url`
   * → embedded; `auth.url` or browser → remote. Explicit mode always wins.
   */
  mode?: "local" | "remote";
  /** Alias of {@link AthenaAuthConfig.social} provider bags. */
  oauth?: Record<string, AthenaAuthSocialProviderOptions>;
  /**
   * Embedded Auth audit/trace tables (`auth.mode: "local"` only).
   * Remote Auth throws `ATHENA_AUTH_OBSERVABILITY_REQUIRES_LOCAL_RUNTIME`.
   */
  observability?: AthenaAuthObservabilityConfig;
  /** Local organization plugin. `enabled` defaults to true when omitted. */
  organizations?: { enabled?: boolean };
  /**
   * Embedded passkey (WebAuthn) options. Runtime enablement is
   * `auth.passkey.enabled`; construct keys `passkeys` / `webauthn` stay invalid.
   */
  passkey?: boolean | AthenaAuthPasskeyOptions;
  /** Auth routing intent. When omitted, legacy URL/env resolution is preserved. */
  routing?: "same-origin" | "direct" | "custom";
  /**
   * Optional signing secret for local mode. When omitted, the runtime
   * bootstraps a database-backed keyring.
   */
  secret?: string;
  /** Local cookie / body / origin policy. */
  security?: AthenaAuthSecurityOptions;
  /** Local session cookie lifetime and name. */
  session?: AthenaAuthSessionOptions;
  /**
   * Canonical social OAuth provider map (`createClient({ auth: { social } })`).
   * Provider secrets stay on the Node process; browser entries must not retain them.
   */
  social?: AthenaAuthSocialOptions;
  /** Alias of {@link AthenaAuthConfig.social} provider bags. */
  socialProviders?: Record<string, AthenaAuthSocialProviderOptions>;
  /**
   * Same-origin proxy upstream (origin or full auth base). Preferred over stuffing
   * the upstream into `url` when `routing` is `"same-origin"`.
   */
  upstreamUrl?: string | null;
  /**
   * Auth base URL or path.
   * - direct/custom: browser-facing auth base
   * - same-origin + absolute off-origin: treated as upstream (compat + deprecation warning)
   * - legacy: explicit override of env / root derivation
   */
  url?: string | null;
}

/**
 * Transport/runtime selection on {@link AthenaChatConfig}.
 * Disabling Chat is `chat: false` / omitted — never `mode: "disabled"`.
 * Matches {@link AthenaAuthConfig.mode}.
 */
export type AthenaChatMode = "local" | "remote";

export interface AthenaChatConfig
  extends Pick<
    AthenaRequestHeaderOverrideFields,
    "bearerToken" | "cookie" | "forceNoCache" | "headers" | "sessionToken"
  > {
  /**
   * Runtime selection. Omitted mode is inferred: `chat.url` → remote,
   * `chat: true` + `databaseUrl` → local.
   * Use `chat: false` to disable; `mode` is never `"disabled"`.
   */
  mode?: AthenaChatMode;
  /** Coarse Chat Rights enforcement. 5.x defaults to compatibility; set enforce after Rights assignment. */
  authorization?: {
    mode?: "compatibility" | "enforce";
  };
  /**
   * Root principal resolver consumed by Local Chat (INV-CHAT-011).
   * User-supplied Chat payload fields never override actor identity.
   */
  resolvePrincipal?: import("../runtime/data/principal.ts").AthenaPrincipalResolver;
  url?: string | null;
  webSocketFactory?: AthenaChatWebSocketFactory | null;
  wsUrl?: string | null;
}

export interface AthenaStorageConfig
  extends Omit<AthenaStorageClientConfig, "baseUrl" | "directUpload"> {
  /** Bucket name for `provider: "s3"`. */
  bucket?: string | null;
  directUpload?: AthenaStorageDirectUploadConfig;
  /**
   * Same-origin Embedded Storage HTTP path for browser/RN `createClient()`.
   * Defaults to `/api/athena/storage`. Discovery `endpoints.storage` overrides
   * when this is omitted.
   */
  endpoint?: string | null;
  /** Key prefix for R2 object ops (trailing slash normalized). */
  prefix?: string | null;
  /**
   * Trusted-Node filesystem ObjectStore. Catalog-optional; requires `root`.
   * Browser / React Native entries fail closed.
   */
  provider?: "local" | "s3" | (string & {});
  /**
   * Cloudflare R2 binding (e.g. `env.FILES`).
   * Drop-in local object I/O (`putObject` / `getObject` / `listObjects` / `deleteObject`).
   * When set with a remote storage URL (or unified root), HTTP storage.* ports are
   * preserved and composed with L3a helpers. R2-only keeps L3a + clear unsupported.
   */
  r2?: R2BucketLike | null;
  /** Absolute or process-local directory for `provider: "local"`. */
  root?: string | null;
  /**
   * Injected S3 object client for `provider: "s3"` (Node only).
   * Duck-typed `getObject` / `putObject` / `headObject` / `deleteObject` / `listObjectsV2`.
   * Athena does not construct an AWS SDK client or read global AWS credentials.
   */
  s3?: {
    deleteObject: (input: { Bucket: string; Key: string }) => Promise<unknown>;
    getObject: (input: { Bucket: string; Key: string }) => Promise<unknown>;
    headObject: (input: { Bucket: string; Key: string }) => Promise<unknown>;
    listObjectsV2: (input: {
      Bucket: string;
      ContinuationToken?: string;
      MaxKeys?: number;
      Prefix?: string;
    }) => Promise<unknown>;
    putObject: (input: {
      Body?: Uint8Array;
      Bucket: string;
      ContentType?: string;
      Key: string;
      Metadata?: Record<string, string>;
    }) => Promise<unknown>;
  } | null;
  url?: string | null;
  [ATHENA_STORAGE_PROVIDER]?: StorageObjectProvider;
  [ATHENA_STORAGE_RUNTIME]?: StorageRuntime;
}

export type { AthenaBillingConfig, AthenaDiagnosticsMode };

/**
 * Host / transport fields on {@link createClient}.
 * Kept distinct from {@link AthenaClientServicesConfig} and `models` so
 * constructor contextual typing does not re-instantiate the full client graph.
 */
export interface AthenaClientRuntimeConfig {
  /**
   * Public application identity (origin + optional display name).
   * `APP_URL` / documented aliases are enough when this is omitted.
   * Never derived from Host.
   */
  app?: {
    /** Durable installation id. Used for webhook ownership; never a display name. */
    id?: string | null;
    name?: string | null;
    url?: string | null;
  };
  backend?: BackendConfig | BackendType;
  /** Optional capability bag; defaults from gateway vs `db.d1` / `storage.r2` bindings. */
  capabilities?: AthenaClientCapabilities;
  /**
   * Application-owned Rights and model bindings. Auth authorization remains a
   * compatibility projection of the authenticated principal.
   */
  authorization?: AthenaClientAuthorizationConfigInput;
  client?: string | null;
  context?: AthenaRequestContext | AthenaRequestContextProvider;
  /**
   * Top-level D1 alias for `db.d1` (Worker DX). Prefer nested `db: { d1 }` in shared code.
   * All paths still materialize through {@link createClient}.
   */
  d1?: D1DatabaseLike | null;
  /**
   * Top-level alias of `db.pgUri` (typically `DATABASE_URL`).
   * Same value, same Node-only PostgreSQL transport. Browser/RN fail-closed.
   */
  databaseUrl?: string | null;
  db?: AthenaDbConfig;
  debugAst?: boolean;
  /**
   * Query diagnostics mode. Prefer `'auto'` in Next/OpenNext apps so production
   * builds stay quiet without app-local OPENNEXT_BUILD branching.
   * Per-flag `debugAst` / `findManyAst` / `traceQueries` always win when set.
   */
  diagnostics?: AthenaDiagnosticsMode;
  env?: Record<string, string | undefined>;
  findManyAst?: boolean;
  /**
   * Use the canonical query AST for supported fluent select reads.
   * Unsupported legacy expressions continue through their compatibility path.
   */
  canonicalQueries?: boolean;
  /**
   * Optional prebuilt gateway transport (tests / advanced injection).
   * Prefer `db.d1` for Cloudflare edge-local — `createClient` wires D1 automatically.
   * @see ADR 0015
   */
  gatewayTransport?: AthenaGatewayClient;
  headers?: Record<string, string>;
  key?: string | null;
  /**
   * Edge vs gateway selection when both bindings and HTTP URLs may be present.
   * Default `auto` (env `ATHENA_EXECUTION_MODE`). Prefer nested service fields for backends.
   * Canonical: `gateway` | `edge` | `auto`. Aliases: `server`, `remote`, `http`,
   * `d1`, `cloudflare`, `local`. Empty / unknown strings are not assignable.
   */
  mode?: AthenaExecutionModeInput | null;
  /**
   * Optional policy definitions owned by this root client.
   * Local HTTP handlers read them so apps do not re-pass the same bag.
   */
  policies?: {
    definitions?: unknown;
    enforce?: boolean;
    mode?: "disabled" | "observe" | "enforce";
  };
  /**
   * When `mode` is `auto` and both D1 and a gateway URL exist, which wins.
   * Default `edge` (env `ATHENA_EXECUTION_PREFER`).
   */
  prefer?: AthenaExecutionPreferInput | null;
  /**
   * Native data-runtime cache owned by this client.
   * SQL remains `athena.query(sql)` — use `athena.cache` for the entity graph.
   */
  query?: {
    cache?: "memory" | "none";
    gcTime?: number;
    staleTime?: number;
  };
  /** Top-level R2 alias for `storage.r2`. Prefer nested `storage: { r2 }` in shared code. */
  r2?: R2BucketLike | null;
  retryReads?: boolean;
  /** Top-level alias for `db.sessionMode` when using `d1`. */
  sessionMode?: string | null;
  /** Top-level alias for `storage.prefix` when using `r2`. */
  storagePrefix?: string | null;
  traceQueries?: boolean | AthenaQueryTraceOptions;
  url?: string | null;
}

/**
 * Domain capability fields on {@link createClient}.
 * Auth / billing / storage / email stay on this bag so `models` inference
 * does not participate in the same object as nested service IntelliSense.
 */
export interface AthenaClientServicesConfig {
  /**
   * Auth service config. Pass `false` to keep Athena DB without Athena Auth.
   * Object config is normalized once (`local` | `remote`); omitted mode is inferred.
   */
  auth?: false | AthenaAuthConfig;
  billing?: AthenaBillingConfig;
  chat?: boolean | AthenaChatConfig;
  /** @internal Planted local/remote Chat runtime before the client view freezes. */
  chatRuntime?: import("../chat/runtime.ts").AthenaChatRuntime;
  /**
   * Root email capability. Independent of Auth: transport lives here;
   * Auth may consume `athena.email` but must not own provider config.
   * Omitted config still materializes `athena.email` (unconfigured send fails).
   */
  email?: AthenaEmailConfig;
  /**
   * Server-owned mutation Data Lifecycle. Local/mutation-owning runtimes only.
   * Remote/browser throws `ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME`.
   */
  lifecycle?: {
    data?: AthenaDataLifecycleConfig;
    storage?: AthenaStorageLifecycleHooks;
  };
  /**
   * Notifications capability. Catalog is required to materialize the module.
   * Omitting `notifications.catalog` fail-closes to unavailable (no kernel default).
   */
  notifications?: AthenaNotificationsConfig;
  storage?: AthenaStorageConfig;
}

export interface AthenaClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> extends AthenaClientRuntimeConfig,
    AthenaClientServicesConfig {
  models?: TModels;
}

/** Config with a required R2 binding — narrows `client.storage` to L3a object methods. */
export type AthenaClientConfigWithR2<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaClientConfig<TModels> & {
  storage: AthenaStorageConfig & { r2: R2BucketLike };
};

type V3TableBuilder<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  Result = unknown,
> = TableQueryBuilder<Row, Insert, Update, Result>;

export interface AthenaClient<
  TModels extends AthenaClientModelsInput | undefined =
    | AthenaClientModelsInput
    | undefined,
> {
  readonly admin: AthenaClientAdminModule;
  readonly auth: AthenaAuthBindings;
  readonly billing: AthenaBillingModule;
  /** Native entity/query cache. Distinct from SQL `query()`. */
  readonly cache: AthenaQueryClient;
  /** Runtime feature detection for gateway vs edge-local backends (ADR 0015). */
  readonly capabilities: AthenaClientCapabilities;
  readonly chat: AthenaChatModule;
  /**
   * Dispose Athena-owned resources (PostgreSQL pool, embedded Auth).
   * Safe to call twice. Does not destroy borrowed pools, D1, or R2.
   */
  close: () => Promise<void>;
  readonly db: AthenaDbModule<ResolvedModels<TModels>>;
  readonly email: AthenaEmailModule;
  explain: (
    executable: AthenaExecutable<unknown>
  ) => ReturnType<typeof import("../query/explain.ts").explainAthenaQuery>;
  from<TModel extends AthenaModelTarget>(
    model: TModel
  ): V3TableBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>>;
  from<TTableName extends AthenaClientTableName<ResolvedModels<TModels>>>(
    table: TTableName,
    options?: AthenaFromOptions
  ): V3TableBuilder<
    RowOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>,
    InsertOf<
      AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>
    >,
    UpdateOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>
  >;
  from<
    Row = Record<string, unknown>,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    options?: AthenaFromOptions
  ): V3TableBuilder<Row, Insert, Update>;
  health: () => Promise<
    import("../release/identity.ts").AthenaNormalizedHealth
  >;
  readonly models: TModels;
  readonly notifications: AthenaNotificationsModule;
  /**
   * Executes raw SQL through Athena's compatibility query surface.
   *
   * @deprecated Will be removed in Athena 6.0.0. Use `admin.query()` for explicit operation and expected-shape metadata, or `db.query()` for the compatibility result shape.
   */
  query: <Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions
  ) => Promise<import("../result/types.ts").AthenaResult<Row[]>>;
  request: <T = unknown>(
    options: AthenaRequestOptions
  ) => Promise<AthenaRequestResponse<T>>;
  rpc: <Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions
  ) => RpcQueryBuilder<Row>;
  readonly storage: AthenaStorageModule;
  readonly system: AthenaClientSystemModule;
  verifyConnection: (
    options?: AthenaGatewayConnectionOptions
  ) => Promise<AthenaGatewayConnectionResult>;
  withContext: (
    context: AthenaRequestContext
  ) => AthenaRequestClient<AthenaClient<TModels>>;
}

/** Client with L3a R2 object methods typed on `storage`. */
export type AthenaClientWithR2Storage<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = Omit<AthenaClient<TModels>, "storage" | "withContext"> & {
  readonly storage: import("../cloudflare/r2/storage.ts").CloudflareR2StorageModule;
  withContext: (
    context: AthenaRequestContext
  ) => AthenaRequestClient<AthenaClientWithR2Storage<TModels>>;
};
