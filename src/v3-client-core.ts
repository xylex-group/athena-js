/**
 * Browser-safe Athena client core.
 *
 * This module must never import Node-only modules (pg, dns, net, tls, fs, …).
 * Direct PostgreSQL materialization lives in the Node-only wrapper
 * `./v3-client.ts`; browser and edge-restricted entries consume this core.
 */

import {
  athenaAuthConfig,
  isDisabledAthenaAuthConfig,
  isLocalAthenaAuthConfig,
  type AthenaAuthEmailAndPasswordOptions,
  type AthenaAuthSecurityOptions,
  type AthenaAuthSessionOptions,
} from "./auth/config.ts";
import {
  detectAthenaRuntimeEnvironment,
  resolveAthenaRuntime,
  toAthenaRuntimeDiagnostics,
} from "./runtime/resolve.ts";
import type { AthenaRequestClient } from "./client-brands.ts";
import {
  attachAthenaClientInternals,
  createViewClientInternals,
  getAthenaClientInternals,
} from "./runtime/client-internals.ts";
import {
  type AthenaAuthDiagnostics,
  attachAthenaAuthRouting,
  getAttachedAthenaAuthRouting,
  type ResolvedAthenaAuthRouting,
  resolveAthenaAuthRouting,
  toAthenaAuthDiagnostics,
} from "./auth/resolve-routing.ts";
import type {
  AthenaAuthBindings,
  AthenaAuthClientConfig,
} from "./auth/types.ts";
import {
  type AthenaBillingClientConfig,
  type AthenaBillingModule,
  createBillingModule,
} from "./billing/module.ts";
import type {
  AthenaChatModule,
  AthenaChatWebSocketFactory,
} from "./chat/types.ts";
import {
  type AthenaFromOptions,
  type AthenaQueryTraceOptions,
  type AthenaRequestOptions,
  type AthenaRequestResponse,
  createInternalClientCore,
  createInternalClientView,
  type InternalAthenaClient,
  type InternalAthenaClientCore,
  type RpcQueryBuilder,
  type TableQueryBuilder,
} from "./client.ts";
import type { AthenaResult } from "./client-result.ts";
import { explainAthenaQuery } from "./query/explain.ts";
import type { AthenaExecutable } from "./query/descriptor.ts";
import {
  type AthenaQueryClient,
  createAthenaQueryClient,
} from "./react/query-client.ts";
import {
  createCloudflareEdgeCapabilities,
  createGatewayCapabilities,
} from "./cloudflare/capabilities.ts";
import { createCloudflareD1GatewayTransport } from "./cloudflare/d1/transport.ts";
import { catalogFromModels } from "./query/engine/index.ts";
import {
  type AthenaExecutionMode,
  type AthenaExecutionModeInput,
  type AthenaExecutionPreferInput,
  resolveAthenaExecutionMode,
} from "./cloudflare/execution-mode.ts";
import {
  type CloudflareR2StorageModule,
  composeHttpAndR2Storage,
  createCloudflareR2StorageModule,
} from "./cloudflare/r2/storage.ts";
import type {
  AthenaClientCapabilities,
  D1DatabaseLike,
  R2BucketLike,
} from "./cloudflare/types.ts";
import {
  CLOUDFLARE_EDGE_API_KEY,
  CLOUDFLARE_EDGE_BASE_URL,
} from "./cloudflare/types.ts";
import {
  AthenaConfigurationError,
  type AthenaService,
} from "./config/errors.ts";
import { mergeAthenaRequestContexts } from "./context/merge.ts";
import type { AthenaDbModule } from "./db/module.ts";
import { registerTransactionCacheObserver } from "./db/transaction/cache.ts";
import {
  type AthenaDiagnosticsMode,
  resolveAthenaClientDiagnostics,
} from "./diagnostics.ts";
import {
  ATHENA_ENV_API_KEY_KEYS,
  ATHENA_ENV_CLIENT_KEYS,
  ATHENA_ENV_DB_URL_KEYS,
  ATHENA_ENV_URL_KEYS,
} from "./env/index.ts";
import type { AthenaGatewayClient } from "./gateway/client.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaJsonObject,
  AthenaRpcCallOptions,
  BackendConfig,
  BackendType,
} from "./gateway/types.ts";
import type {
  AthenaClientModelForTableName,
  AthenaClientModelsInput,
  AthenaClientTableName,
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from "./schema/types.ts";
import type {
  AthenaStorageClientConfig,
  AthenaStorageDirectUploadConfig,
  AthenaStorageModule,
} from "./storage/module.ts";
import type { AthenaRequestHeaderOverrideFields } from "./utils/athena-request-headers.ts";

type MaybePromise<T> = T | Promise<T>;
type ResolvedModels<TModels> = TModels extends AthenaClientModelsInput
  ? TModels
  : never;

/** Service-specific URL keys (not shared gateway root/db/key/client SSOT). */
const ENV_AUTH_URL_KEYS = [
  "ATHENA_AUTH_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_URL",
] as const;
const ENV_CHAT_URL_KEYS = [
  "ATHENA_CHAT_URL",
  "NEXT_PUBLIC_ATHENA_CHAT_URL",
] as const;
const ENV_CHAT_WS_URL_KEYS = [
  "ATHENA_CHAT_WS_URL",
  "NEXT_PUBLIC_ATHENA_CHAT_WS_URL",
] as const;
const ENV_STORAGE_URL_KEYS = [
  "ATHENA_STORAGE_URL",
  "NEXT_PUBLIC_ATHENA_STORAGE_URL",
] as const;
const MISSING_DB_SENTINEL = "https://athena.invalid/db";

export {
  AthenaConfigurationError,
  type AthenaConfigurationErrorCode,
  type AthenaService,
} from "./config/errors.ts";

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
   * Execution runtime. `"local"` runs Athena Auth inside this process
   * against `db.pgUri` / `databaseUrl`. `"remote"` talks to an Auth HTTP
   * service. Omitted mode is inferred: Node + database URI + no `auth.url`
   * → embedded; `auth.url` or browser → remote. Explicit mode always wins.
   */
  mode?: "local" | "remote";
  /**
   * Explicit opt-in only. `createClient()` never applies Auth DDL unless
   * this is `true`. Runtime default remains `false` when omitted.
   */
  autoMigrate?: boolean;
  /**
   * Optional signing secret for local mode. When omitted, the runtime
   * bootstraps a database-backed keyring.
   */
  secret?: string;
  /**
   * Local handler base path. Defaults to `/api/auth`.
   */
  basePath?: string;
  /**
   * Local email/password policy. Normalized at the auth config boundary.
   */
  emailAndPassword?: AthenaAuthEmailAndPasswordOptions;
  /**
   * Local organization plugin. `enabled` defaults to true when omitted.
   */
  organizations?: { enabled?: boolean };
  /**
   * Local cookie / body / origin policy.
   */
  security?: AthenaAuthSecurityOptions;
  /**
   * Local session cookie lifetime and name.
   */
  session?: AthenaAuthSessionOptions;
  /**
   * Auth routing intent. When omitted, legacy URL/env resolution is preserved.
   */
  routing?: "same-origin" | "direct" | "custom";
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

export interface AthenaChatConfig
  extends Pick<
    AthenaRequestHeaderOverrideFields,
    "bearerToken" | "cookie" | "forceNoCache" | "headers" | "sessionToken"
  > {
  url?: string | null;
  webSocketFactory?: AthenaChatWebSocketFactory | null;
  wsUrl?: string | null;
}

export interface AthenaStorageConfig
  extends Omit<AthenaStorageClientConfig, "baseUrl" | "directUpload"> {
  directUpload?: AthenaStorageDirectUploadConfig;
  /** Key prefix for R2 object ops (trailing slash normalized). */
  prefix?: string | null;
  /**
   * Cloudflare R2 binding (e.g. `env.FILES`).
   * Drop-in local object I/O (`putObject` / `getObject` / `listObjects` / `deleteObject`).
   * When set with a remote storage URL (or unified root), HTTP storage.* ports are
   * preserved and composed with L3a helpers. R2-only keeps L3a + clear unsupported.
   */
  r2?: R2BucketLike | null;
  url?: string | null;
}

export interface AthenaBillingConfig
  extends Omit<
    AthenaBillingClientConfig,
    "baseUrl" | "apiKey" | "client" | "fetchImpl"
  > {
  /** Optional override; defaults to the unified/root or db Athena URL. */
  url?: string | null;
}

export type { AthenaDiagnosticsMode };

export interface AthenaClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> {
  /**
   * Auth service config. Pass `false` to keep Athena DB without Athena Auth.
   * Object config is normalized once (`local` | `remote`); omitted mode is inferred.
   */
  auth?: false | AthenaAuthConfig;
  backend?: BackendConfig | BackendType;
  billing?: AthenaBillingConfig;
  /** Optional capability bag; defaults from gateway vs `db.d1` / `storage.r2` bindings. */
  capabilities?: AthenaClientCapabilities;
  chat?: AthenaChatConfig;
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
  models?: TModels;
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
   * Native data-runtime cache owned by this client.
   * SQL remains `athena.query(sql)` — use `athena.cache` for the entity graph.
   */
  query?: {
    cache?: "memory" | "none";
    gcTime?: number;
    staleTime?: number;
  };
  /**
   * When `mode` is `auto` and both D1 and a gateway URL exist, which wins.
   * Default `edge` (env `ATHENA_EXECUTION_PREFER`).
   */
  prefer?: AthenaExecutionPreferInput | null;
  /**
   * Top-level R2 alias for `storage.r2`. Prefer nested `storage: { r2 }` in shared code.
   */
  r2?: R2BucketLike | null;
  retryReads?: boolean;
  /** Top-level alias for `db.sessionMode` when using `d1`. */
  sessionMode?: string | null;
  storage?: AthenaStorageConfig;
  /** Top-level alias for `storage.prefix` when using `r2`. */
  storagePrefix?: string | null;
  traceQueries?: boolean | AthenaQueryTraceOptions;
  url?: string | null;
}

/** Config with a required R2 binding — narrows `client.storage` to L3a object methods. */
export type AthenaClientConfigWithR2<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaClientConfig<TModels> & {
  storage: AthenaStorageConfig & { r2: R2BucketLike };
};

/** Client with L3a R2 object methods typed on `storage`. */
export type AthenaClientWithR2Storage<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = Omit<AthenaClient<TModels>, "storage" | "withContext"> & {
  readonly storage: CloudflareR2StorageModule;
  withContext: (
    context: AthenaRequestContext
  ) => AthenaRequestClient<AthenaClientWithR2Storage<TModels>>;
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
  readonly admin: import("./client.ts").AthenaClientAdminModule;
  readonly auth: AthenaAuthBindings;
  readonly billing: AthenaBillingModule;
  /** Native entity/query cache. Distinct from SQL `query()`. */
  readonly cache: AthenaQueryClient;
  /** Runtime feature detection for gateway vs edge-local backends (ADR 0015). */
  readonly capabilities: AthenaClientCapabilities;
  explain: (
    executable: AthenaExecutable<unknown>
  ) => ReturnType<typeof explainAthenaQuery>;
  readonly models: TModels;
  readonly chat: AthenaChatModule;
  readonly db: AthenaDbModule<ResolvedModels<TModels>>;
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
  health: () => Promise<import("./release/identity.ts").AthenaNormalizedHealth>;
  /**
   * Executes raw SQL through Athena's compatibility query surface.
   *
   * @deprecated Prefer `admin.query()` with explicit `operation` and `expectedShape`.
   */
  query: <Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaResult<Row[]>>;
  request: <T = unknown>(
    options: AthenaRequestOptions
  ) => Promise<AthenaRequestResponse<T>>;
  rpc: <Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions
  ) => RpcQueryBuilder<Row>;
  readonly storage: AthenaStorageModule;
  readonly system: import("./client.ts").AthenaClientSystemModule;
  verifyConnection: (
    options?: AthenaGatewayConnectionOptions
  ) => Promise<AthenaGatewayConnectionResult>;
  withContext: (
    context: AthenaRequestContext
  ) => AthenaRequestClient<AthenaClient<TModels>>;
  /**
   * Dispose Athena-owned resources (PostgreSQL pool, embedded Auth).
   * Safe to call twice. Does not destroy borrowed pools, D1, or R2.
   */
  close: () => Promise<void>;
}

interface ResolvedServiceUrls {
  auth?: string;
  billing?: string;
  chat?: string;
  chatWs?: string;
  db?: string;
  storage?: string;
}

interface AthenaClientCoreBase<
  TModels extends AthenaClientModelsInput | undefined,
> {
  readonly authRouting?: ResolvedAthenaAuthRouting;
  readonly client?: string;
  readonly config: AthenaClientConfig<TModels>;
  readonly key: string;
  readonly urls: ResolvedServiceUrls;
}

interface AthenaClientCore<TModels extends AthenaClientModelsInput | undefined>
  extends AthenaClientCoreBase<TModels> {
  readonly internalCore: InternalAthenaClientCore<ResolvedModels<TModels>>;
}

function readFirstEnv(
  env: Record<string, string | undefined> | undefined,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = env?.[key]?.trim();
    if (value) {
      return value;
    }
  }
  return;
}

/**
 * First env value that looks like an absolute http(s) URL.
 * Skips unexpanded placeholders (e.g. `${ATHENA_URL}`) and other non-URLs so
 * ambient shell pollution cannot crash createClient during service resolution.
 */
function readFirstEnvHttpUrl(
  env: Record<string, string | undefined> | undefined,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = env?.[key]?.trim();
    if (value && isAbsoluteHttpUrl(value)) {
      return value;
    }
  }
  return;
}

/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function toWebSocketUrl(baseUrl: string): string | undefined {
  if (!isAbsoluteHttpUrl(baseUrl)) {
    return;
  }
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/wss/gateway`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function hasChatSessionCredentials(chat?: AthenaChatConfig): boolean {
  return Boolean(
    normalizeOptional(chat?.bearerToken) ??
      normalizeOptional(chat?.cookie) ??
      normalizeOptional(chat?.sessionToken)
  );
}

function resolveCore<TModels extends AthenaClientModelsInput | undefined>(
  config: AthenaClientConfig<TModels>
): AthenaClientCore<TModels> {
  const env = config.env;
  const explicitRoot = normalizeOptional(config.url);
  const envRoot = readFirstEnvHttpUrl(env, ATHENA_ENV_URL_KEYS);
  const root =
    explicitRoot && isAbsoluteHttpUrl(explicitRoot)
      ? explicitRoot
      : explicitRoot
        ? undefined
        : envRoot;
  const explicitRootWinsOverEnvServices = Boolean(
    root && explicitRoot && isAbsoluteHttpUrl(explicitRoot)
  );
  const resolveService = (
    explicit: string | null | undefined,
    envKeys: readonly string[],
    path: string
  ): string | undefined =>
    normalizeOptional(explicit) ??
    (explicitRootWinsOverEnvServices && root
      ? appendPath(root, path)
      : undefined) ??
    readFirstEnvHttpUrl(env, envKeys) ??
    (root ? appendPath(root, path) : undefined);

  const dbUrl = resolveService(config.db?.url, ATHENA_ENV_DB_URL_KEYS, "db");
  const authObject = athenaAuthConfig(config.auth);
  const authDisabled = isDisabledAthenaAuthConfig(config.auth);

  // Auth routing policy (SSOT). Legacy configs (no routing) keep historical
  // resolveService outcomes; same-origin enables relative `/api/auth`.
  // `auth: false` skips env/root Auth URL inference so DB-only clients stay DB-only.
  const authRouting = authDisabled
    ? undefined
    : resolveAthenaAuthRouting({
        credentials: authObject?.credentials,
        emitWarnings: true,
        env,
        execution: isLocalAthenaAuthConfig(config.auth) ? "local" : "remote",
        explicitRootWinsOverEnvServices,
        rootUrl: root,
        routing: authObject?.routing,
        upstreamUrl: authObject?.upstreamUrl,
        url: authObject?.url,
      });

  const authUrl = authDisabled
    ? undefined
    : authRouting?.mode === "legacy"
      ? authRouting.browserRequestBaseUrl ||
        resolveService(authObject?.url, ENV_AUTH_URL_KEYS, "auth")
      : authRouting?.browserRequestBaseUrl || undefined;

  const urls: ResolvedServiceUrls = {
    auth: authUrl || undefined,
    // Billing lives on the main Athena HTTP surface (same host as gateway/db).
    billing:
      normalizeOptional(config.billing?.url) ?? dbUrl ?? root ?? undefined,
    chat: resolveService(config.chat?.url, ENV_CHAT_URL_KEYS, "chat"),
    chatWs:
      normalizeOptional(config.chat?.wsUrl) ??
      (explicitRootWinsOverEnvServices && root
        ? toWebSocketUrl(root)
        : undefined) ??
      readFirstEnvHttpUrl(env, ENV_CHAT_WS_URL_KEYS) ??
      (root ? toWebSocketUrl(root) : undefined),
    db: dbUrl,
    storage: resolveService(
      config.storage?.url,
      ENV_STORAGE_URL_KEYS,
      "storage"
    ),
  };

  if (
    !(
      urls.db ||
      urls.auth ||
      urls.chat ||
      urls.storage ||
      urls.billing ||
      config.gatewayTransport
    )
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_NO_SERVICE_CONFIGURED",
      "Athena requires a unified URL or at least one configured service URL.",
      "db"
    );
  }

  const key =
    normalizeOptional(config.key) ?? readFirstEnv(env, ATHENA_ENV_API_KEY_KEYS);
  if (
    !(
      key ||
      hasChatSessionCredentials(config.chat) ||
      config.gatewayTransport
    )
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_API_KEY_REQUIRED",
      "Athena API key is required unless chat session credentials are configured."
    );
  }
  if (
    !key &&
    !hasChatSessionCredentials(config.chat) &&
    hasExplicitRemoteHttpApiKeyNeed(config)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_API_KEY_REQUIRED",
      "Athena API key is required unless chat session credentials are configured."
    );
  }

  // Default credentials for same-origin when not explicitly set on auth options.
  const authWithCredentials =
    authObject &&
    authObject.credentials === undefined &&
    authRouting?.credentials
      ? { ...authObject, credentials: authRouting.credentials }
      : config.auth;

  const resolvedConfig: AthenaClientConfig<TModels> = authWithCredentials
    ? { ...config, auth: authWithCredentials }
    : config;

  const base: AthenaClientCoreBase<TModels> = {
    authRouting:
      authRouting &&
      (authRouting.browserRequestBaseUrl || authRouting.mode !== "legacy")
        ? authRouting
        : undefined,
    client:
      normalizeOptional(config.client) ??
      readFirstEnv(env, ATHENA_ENV_CLIENT_KEYS),
    config: resolvedConfig,
    key: key ?? "",
    urls,
  };
  return {
    ...base,
    internalCore: createInternalClientCore(createInternalConfig(base)),
  };
}

async function resolveConfiguredContext<
  TModels extends AthenaClientModelsInput | undefined,
>(
  core: AthenaClientCore<TModels>,
  viewContext: AthenaRequestContext | undefined
): Promise<AthenaRequestContext | undefined> {
  const configured = core.config.context;
  const base =
    typeof configured === "function" ? await configured() : configured;
  return mergeAthenaRequestContexts(base, viewContext);
}

function createInternalConfig<
  TModels extends AthenaClientModelsInput | undefined,
>(core: AthenaClientCoreBase<TModels>) {
  const { config, urls } = core;
  const {
    url: _authUrl,
    routing: _authRouting,
    upstreamUrl: _authUpstreamUrl,
    ...authOptions
  } = athenaAuthConfig(config.auth) ?? {};
  const {
    url: _storageUrl,
    directUpload,
    r2: _r2,
    prefix: _r2Prefix,
    ...storageOptions
  } = config.storage ?? {};
  void _authUrl;
  void _authRouting;
  void _authUpstreamUrl;
  void _storageUrl;
  void _r2;
  void _r2Prefix;

  const diagnostics = resolveAthenaClientDiagnostics({
    debugAst: config.debugAst,
    diagnostics: config.diagnostics,
    env: config.env,
    findManyAst: config.findManyAst,
    traceQueries: config.traceQueries,
  });

  return {
    apiKey: core.key,
    auth: authOptions,
    authUrl: urls.auth,
    backend:
      typeof config.backend === "string"
        ? { type: config.backend }
        : config.backend,
    baseUrl: urls.db ?? MISSING_DB_SENTINEL,
    behavior: {
      debugAst: diagnostics.debugAst,
      findManyAst: diagnostics.findManyAst,
      findManyAstRelationSchema: Boolean(config.db?.pgUri),
      retryReads: config.retryReads,
      traceQueries: diagnostics.traceQueries,
    },
    chat: config.chat,
    chatUrl: urls.chat,
    chatWsUrl: urls.chatWs,
    client: core.client,
    gatewayTransport: config.gatewayTransport,
    headers: config.headers,
    jdbcUrl: config.db?.jdbcUrl,
    models: config.models as ResolvedModels<TModels>,
    pgUri: config.db?.pgUri,
    storage: {
      ...storageOptions,
      ...(directUpload ? { directUpload } : {}),
    },
    storageUrl: urls.storage,
  };
}

function serviceGuard(urls: ResolvedServiceUrls, service: AthenaService): void {
  if (!urls[service]) {
    throw new AthenaConfigurationError(
      "ATHENA_SERVICE_NOT_CONFIGURED",
      `Athena ${service} is not configured.`,
      service
    );
  }
}

function createUnavailableNamespace(
  service: AthenaService,
  urls: ResolvedServiceUrls,
  path: readonly PropertyKey[] = []
): unknown {
  return new Proxy(() => undefined, {
    apply() {
      serviceGuard(urls, service);
      throw new TypeError(
        `Athena service property ${path.map(String).join(".")} is not callable.`
      );
    },
    get(_target, property) {
      return createUnavailableNamespace(service, urls, [...path, property]);
    },
  });
}

/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function isD1Binding(value: unknown): value is D1DatabaseLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as D1DatabaseLike).prepare === "function"
  );
}

function isR2Binding(value: unknown): value is R2BucketLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as R2BucketLike).put === "function" &&
      typeof (value as R2BucketLike).get === "function"
  );
}

/**
 * Fold top-level Worker aliases into nested service config, then resolve
 * edge vs gateway so every path materializes through {@link createClient}.
 */
function foldBindingAliases<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const d1 = config.db?.d1 ?? config.d1;
  const r2 = config.storage?.r2 ?? config.r2;
  const sessionMode = config.db?.sessionMode ?? config.sessionMode;
  const prefix = config.storage?.prefix ?? config.storagePrefix;
  const aliasPgUri = normalizeOptional(config.databaseUrl);
  const nestedPgUri = normalizeOptional(config.db?.pgUri);
  const envPgUri = config.env
    ? normalizeOptional(config.env.DATABASE_URL)
    : undefined;
  if (aliasPgUri && nestedPgUri && aliasPgUri !== nestedPgUri) {
    throw new AthenaConfigurationError(
      "ATHENA_DATABASE_URL_CONFLICT",
      "databaseUrl and db.pgUri must be the same connection string when both are set.",
      "db"
    );
  }
  const pgUri = nestedPgUri ?? aliasPgUri ?? envPgUri;

  let next: AthenaClientConfig<TModels> = { ...config };
  if (d1 !== undefined || sessionMode !== undefined || pgUri !== undefined) {
    next = {
      ...next,
      db: {
        ...next.db,
        ...(d1 === undefined ? {} : { d1 }),
        ...(sessionMode === undefined ? {} : { sessionMode }),
        ...(pgUri === undefined ? {} : { pgUri }),
      },
    };
  }
  if (r2 !== undefined || prefix !== undefined) {
    next = {
      ...next,
      storage: {
        ...next.storage,
        ...(r2 === undefined ? {} : { r2 }),
        ...(prefix === undefined ? {} : { prefix }),
      },
    };
  }
  // Strip top-level aliases so they are not mistaken for service modules later.
  const {
    d1: _d1,
    r2: _r2,
    storagePrefix: _storagePrefix,
    sessionMode: _sessionMode,
    databaseUrl: _databaseUrl,
    ...rest
  } = next;
  void _d1;
  void _r2;
  void _storagePrefix;
  void _sessionMode;
  void _databaseUrl;
  return rest;
}

/**
 * When execution resolves to gateway, drop D1 so HTTP db routing wins.
 * R2 may still attach for hybrid local objects + remote gateway DB.
 */
function applyExecutionMode<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const d1 = config.db?.d1;
  const hasD1 = isD1Binding(d1);
  const hasUrl = Boolean(
    normalizeOptional(config.url) ??
      normalizeOptional(config.db?.url) ??
      (config.env
        ? (normalizeOptional(config.env.ATHENA_URL) ??
          normalizeOptional(config.env.NEXT_PUBLIC_ATHENA_URL))
        : undefined)
  );

  // Only resolve when there is something to choose between (or explicit mode).
  // Use != null so omitted mode/prefer (undefined) are not treated as hints —
  // `undefined !== null` is true and previously forced every createClient
  // without D1 through resolveAthenaExecutionMode, breaking storage-only clients.
  const hasModeHint =
    config.mode != null ||
    config.prefer != null ||
    Boolean(config.env?.ATHENA_EXECUTION_MODE) ||
    Boolean(config.env?.ATHENA_EXECUTION_PREFER);

  if (!(hasD1 || hasModeHint)) {
    return config;
  }

  // Pure edge (only d1, no url) or pure gateway without mode hints: keep default behavior.
  if (hasD1 && !hasUrl && !hasModeHint) {
    return config;
  }

  let resolved: AthenaExecutionMode | "edge" | "gateway";
  try {
    resolved = resolveAthenaExecutionMode({
      d1: hasD1 ? d1 : null,
      env: config.env,
      mode: config.mode,
      prefer: config.prefer,
      url: config.url ?? config.db?.url,
    });
  } catch (error) {
    // No mode/prefer and incomplete config: fall through to default materialize.
    if (!hasModeHint) {
      return config;
    }
    // pgUri-only + auto: D1/HTTP resolver cannot see PostgreSQL yet.
    // Defer to materializePostgresBinding (gateway mode stays header-only).
    const pgUri = normalizeOptional(config.db?.pgUri);
    if (pgUri && !hasD1) {
      const modeRaw =
        normalizeOptional(
          typeof config.mode === "string" ? config.mode : undefined
        ) ?? normalizeOptional(config.env?.ATHENA_EXECUTION_MODE);
      const modeKey = modeRaw?.trim().toLowerCase();
      if (!modeKey || modeKey === "auto") {
        return config;
      }
    }
    throw error;
  }

  if (resolved === "gateway" && hasD1) {
    const { d1: _drop, sessionMode: _sm, ...dbRest } = config.db ?? {};
    void _drop;
    void _sm;
    return {
      ...config,
      db: Object.keys(dbRest).length > 0 ? dbRest : undefined,
      gatewayTransport: undefined,
    };
  }

  return config;
}

/**
 * Unified remote root (top-level `url` or env ATHENA_URL / NEXT_PUBLIC_ATHENA_URL).
 * Used for billing hybrid routing and default service derivation.
 */
/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function resolveUnifiedRemoteRoot<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): string | undefined {
  return (
    normalizeOptional(config.url) ??
    readFirstEnv(config.env, ATHENA_ENV_URL_KEYS)
  );
}

/**
 * Remote Auth/storage/chat/billing URLs need a publishable key even when a
 * local gatewayTransport already satisfies DB construction.
 * Does not treat top-level `url` / discovery same-origin as a key requirement.
 */
function hasExplicitRemoteHttpApiKeyNeed<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const authDisabled = isDisabledAthenaAuthConfig(config.auth);
  const authLocal = isLocalAthenaAuthConfig(config.auth);
  const authObject = athenaAuthConfig(config.auth);
  return Boolean(
    (!authDisabled &&
      !authLocal &&
      (normalizeOptional(authObject?.url) ||
        readFirstEnv(config.env, ENV_AUTH_URL_KEYS))) ||
      normalizeOptional(config.storage?.url) ||
      readFirstEnv(config.env, ENV_STORAGE_URL_KEYS) ||
      normalizeOptional(config.chat?.url) ||
      readFirstEnv(config.env, ENV_CHAT_URL_KEYS) ||
      normalizeOptional(config.billing?.url)
  );
}

function isEdgeLocalSentinelUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return (
    url === CLOUDFLARE_EDGE_BASE_URL ||
    url.startsWith("https://athena.local/") ||
    url.startsWith("http://athena.local/")
  );
}

/**
 * True when a non-edge DB HTTP gateway is configured (nested `db.url` or env DB/gateway URL).
 * Important for hybrid `db: { d1, url: remoteGateway }` where top-level `url` may be unset.
 */
/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function hasRemoteDbGatewayUrl<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const dbUrl =
    normalizeOptional(config.db?.url) ??
    readFirstEnv(config.env, ATHENA_ENV_DB_URL_KEYS);
  return Boolean(dbUrl && !isEdgeLocalSentinelUrl(dbUrl));
}

/**
 * True when any remote HTTP service is configured (explicit or via env).
 * Used to decide whether the edge-local API-key sentinel is safe to inject.
 */
/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function hasRemoteHttpServices<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const authObject = athenaAuthConfig(config.auth);
  const authDisabled = isDisabledAthenaAuthConfig(config.auth);
  return Boolean(
    resolveUnifiedRemoteRoot(config) ||
      hasRemoteDbGatewayUrl(config) ||
      (!authDisabled &&
        (normalizeOptional(authObject?.url) ||
          readFirstEnv(config.env, ENV_AUTH_URL_KEYS))) ||
      normalizeOptional(config.storage?.url) ||
      readFirstEnv(config.env, ENV_STORAGE_URL_KEYS) ||
      normalizeOptional(config.chat?.url) ||
      readFirstEnv(config.env, ENV_CHAT_URL_KEYS) ||
      normalizeOptional(config.billing?.url)
  );
}

/**
 * True when HTTP object storage is configured (explicit `storage.url`, env, or
 * a unified remote root that resolveCore can turn into `/storage`).
 */
/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function hasRemoteHttpStorage<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  return Boolean(
    normalizeOptional(config.storage?.url) ||
      readFirstEnv(config.env, ENV_STORAGE_URL_KEYS) ||
      resolveUnifiedRemoteRoot(config)
  );
}

/** @internal Exported for the Node-only `./v3-client.ts` wrapper. */
export function hasRemoteAuthService<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  if (
    isDisabledAthenaAuthConfig(config.auth) ||
    isLocalAthenaAuthConfig(config.auth)
  ) {
    return false;
  }
  const authObject = athenaAuthConfig(config.auth);
  return Boolean(
    normalizeOptional(authObject?.url) ||
      readFirstEnv(config.env, ENV_AUTH_URL_KEYS) ||
      resolveUnifiedRemoteRoot(config)
  );
}

/**
 * Wire Cloudflare D1/R2 bindings into the shared `createClient` config spine.
 * Drop-in: `createClient({ db: { d1 }, storage: { r2 } })` uses the same fluent
 * DB/storage call sites as gateway HTTP mode.
 */
function materializeEdgeBindings<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const d1 = config.db?.d1;
  const r2 = config.storage?.r2;
  const hasD1 = isD1Binding(d1);
  const hasR2 = isR2Binding(r2);
  if (!(hasD1 || hasR2)) {
    return config;
  }

  if (hasD1 && d1 && typeof d1.prepare !== "function") {
    throw new AthenaConfigurationError(
      "ATHENA_NO_SERVICE_CONFIGURED",
      "db.d1 must be a D1 binding with prepare().",
      "db"
    );
  }

  const remoteRoot = resolveUnifiedRemoteRoot(config);
  const remoteServices = hasRemoteHttpServices(config);
  const remoteStorage = hasRemoteHttpStorage(config);
  const remoteAuth = hasRemoteAuthService(config);
  const next: AthenaClientConfig<TModels> = { ...config };

  if (hasD1 && d1) {
    if (!config.gatewayTransport) {
      next.gatewayTransport = createCloudflareD1GatewayTransport({
        d1,
        defaultSessionMode: config.db?.sessionMode,
        relationCatalog: catalogFromModels(config.models),
      });
    }
    // Local D1 sentinel — not a real HTTP endpoint. Hybrid services must not inherit this for billing.
    // Do not plant the sentinel when env (or explicit) remote DB gateway URLs exist:
    // resolveCore prefers explicit `db.url` over ATHENA_DB_URL / ATHENA_GATEWAY_URL, so a
    // sentinel would shadow those env gateways after remote key selection already succeeded.
    const explicitDbUrl = normalizeOptional(config.db?.url);
    const remoteDbGateway = hasRemoteDbGatewayUrl(config);
    next.db = {
      ...config.db,
      d1,
      url:
        explicitDbUrl ??
        (remoteDbGateway ? undefined : CLOUDFLARE_EDGE_BASE_URL),
    };
    // Pure edge-local needs a placeholder key for resolveCore. Hybrid clients
    // (top-level url, env ATHENA_URL, or any explicit/env remote service URL)
    // must not pre-fill the sentinel — leave key unset so resolveCore can use
    // ATHENA_API_KEY / ATHENA_GATEWAY_API_KEY (etc.) from the env object.
    const explicitKey = normalizeOptional(config.key);
    if (explicitKey) {
      next.key = explicitKey;
    } else if (remoteServices) {
      // Hybrid without top-level key: strip accidental empty key so env keys apply.
      next.key = undefined;
    } else {
      next.key = CLOUDFLARE_EDGE_API_KEY;
    }
    if (remoteRoot) {
      next.billing = {
        ...(config.billing ?? {}),
        url: normalizeOptional(config.billing?.url) ?? remoteRoot,
      };
    }
    if (!config.capabilities) {
      next.capabilities = createCloudflareEdgeCapabilities({
        authRemote: remoteAuth,
        findManyAst: true,
        flatCrud: true,
        query: true,
        relations: true,
        rpc: false,
        hasR2,
        // Explicit storage.url / env storage URL / unified remote root all count.
        hasRemoteStorage: remoteStorage,
      });
    }
  } else if (hasR2 && r2) {
    // R2 without D1: storage-only edge, or gateway HTTP DB + local R2 objects.
    // ADR 0016: presence of storage.r2 alone is sufficient to configure object storage.
    if (
      !(
        remoteRoot ||
        normalizeOptional(config.db?.url) ||
        normalizeOptional(config.storage?.url) ||
        readFirstEnv(config.env, ENV_STORAGE_URL_KEYS)
      )
    ) {
      next.storage = {
        ...config.storage,
        r2,
        // Local sentinel so resolveCore accepts a storage-only binding client.
        url: CLOUDFLARE_EDGE_BASE_URL,
      };
      if (!remoteServices) {
        next.key = normalizeOptional(config.key) ?? CLOUDFLARE_EDGE_API_KEY;
      } else if (normalizeOptional(config.key)) {
        next.key = normalizeOptional(config.key);
      } else {
        next.key = undefined;
      }
    }
    if (!config.capabilities) {
      if (
        remoteRoot ||
        normalizeOptional(config.db?.url) ||
        readFirstEnv(config.env, ATHENA_ENV_DB_URL_KEYS)
      ) {
        // Gateway (or other remote) DB + local R2: keep gateway mode.
        // Catalogs/backups only when remote HTTP storage is also wired.
        const base = createGatewayCapabilities({
          authRemote: remoteAuth,
          storageBackups: remoteStorage,
          storageCatalogs: remoteStorage,
          storageConfigured: remoteStorage || hasR2,
        });
        next.capabilities = {
          ...base,
          storage: {
            ...base.storage,
            local: true,
            objects: true,
          },
        };
      } else {
        // Storage-only edge client — no DB binding or remote root.
        // Explicit storage.url / env still enables HTTP catalogs/backups alongside R2.
        next.capabilities = {
          auth: {
            remote: remoteAuth,
          },
          db: {
            engine: "unknown",
            layers: {
              findManyAst: false,
              flatCrud: false,
              query: false,
              relations: false,
              rpc: false,
            },
            local: false,
            transactions: {
              atomic: false,
              backend: "unsupported",
              deferrable: false,
              interactive: false,
              isolationLevels: [],
              readOnly: false,
              savepoints: false,
            },
          },
          mode: "cloudflare-edge",
          storage: {
            backups: remoteStorage,
            catalogs: remoteStorage,
            local: true,
            objects: true,
          },
        };
      }
    }
  }

  return next;
}

/**
 * Universal createClient normalization pipeline: aliases → mode → edge.
 *
 * Browser-safe: direct PostgreSQL (`db.pgUri`) materialization is applied only
 * by the Node/server entry (`./v3-client.ts`) on top of this pipeline.
 */
export function normalizeUniversalCreateClientConfig<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  return materializeEdgeBindings(
    applyExecutionMode(foldBindingAliases(config))
  );
}

/**
 * Fail fast when a non-Node runtime (browser / RN) is handed `db.pgUri`.
 *
 * Direct PostgreSQL execution requires the Node-only `pg` driver; silently
 * ignoring `pgUri` would both break queries and risk shipping a database URI
 * (a secret) inside a client bundle. The URI is never included in the error.
 *
 * @internal Used by browser/React Native façades; not public API.
 */
export function assertDirectPostgresRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (
    normalizeOptional(config.db?.pgUri) ||
    normalizeOptional(config.databaseUrl) ||
    normalizeOptional(config.env?.DATABASE_URL) ||
    Boolean(config.db?.pool)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED",
      "databaseUrl / db.pgUri / db.pool direct PostgreSQL execution is not available in browser runtimes. Use an Athena HTTP gateway from the browser, or construct this client in a Node.js/server runtime.",
      "db"
    );
  }
}

/**
 * Fail fast when a browser runtime is handed `auth.mode: "local"`.
 * The local TypeScript auth runtime is Node-only and must never ship
 * DATABASE_URL processing into a client bundle.
 *
 * @internal Used by browser/React Native façades; not public API.
 */
export function assertLocalAuthRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (isLocalAthenaAuthConfig(config.auth)) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_LOCAL_NODE_REQUIRED",
      'auth.mode "local" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module, or use auth.mode "remote".',
      "auth"
    );
  }
}

const clientQueryCaches = new WeakMap<object, AthenaQueryClient>();

function getOrCreateClientQueryCache(core: {
  config: AthenaClientConfig<AthenaClientModelsInput | undefined>;
}): AthenaQueryClient {
  const existing = clientQueryCaches.get(core);
  if (existing) {
    return existing;
  }
  const created = createAthenaQueryClient({
    cache: {
      gcTime: core.config.query?.gcTime,
      mode: core.config.query?.cache ?? "memory",
      staleTime: core.config.query?.staleTime,
    },
  });
  clientQueryCaches.set(core, created);
  return created;
}

function createClientView<TModels extends AthenaClientModelsInput | undefined>(
  core: AthenaClientCore<TModels>,
  viewContext?: AthenaRequestContext
): AthenaClient<TModels> {
  // Bypass generic expansion during dts emit (TS2589).
  const createView = createInternalClientView as unknown as (
    internalCore: AthenaClientCore<TModels>["internalCore"],
    resolveContext: () => ReturnType<typeof resolveConfiguredContext<TModels>>,
    cacheContext?: {
      accessScope?: string;
      organizationId?: string;
      policyRevision?: string;
      userId?: string;
    }
  ) => InternalAthenaClient<ResolvedModels<TModels>>;
  const organizationId = viewContext?.organizationId?.trim();
  const userId = viewContext?.userId?.trim();
  const accessScope = viewContext?.accessScope?.trim();
  const policyRevision = viewContext?.policyRevision?.trim();
  const resolved = createView(
    core.internalCore,
    () => resolveConfiguredContext(core, viewContext),
    organizationId || userId || accessScope || policyRevision
      ? {
          accessScope: accessScope || undefined,
          organizationId: organizationId || undefined,
          policyRevision: policyRevision || undefined,
          userId: userId || undefined,
        }
      : undefined
  );
  const requireDb = (): void => serviceGuard(core.urls, "db");

  const { url: _billingUrl, ...billingOptions } = core.config.billing ?? {};
  void _billingUrl;
  const billingModule: AthenaBillingModule | unknown = core.urls.billing
    ? createBillingModule({
        apiKey: core.key,
        baseUrl: core.urls.billing,
        client: core.client,
        headers: {
          ...(core.config.headers ?? {}),
          ...(billingOptions.headers ?? {}),
        },
        ...billingOptions,
      })
    : createUnavailableNamespace("billing", core.urls);

  const r2 = core.config.storage?.r2;
  const hasR2Binding = isR2Binding(r2);
  // Edge-local sentinel URLs are not real HTTP storage ports.
  const hasHttpStorage = Boolean(
    core.urls.storage && !isEdgeLocalSentinelUrl(core.urls.storage)
  );

  const capabilities =
    core.config.capabilities ??
    createGatewayCapabilities({
      authRemote: Boolean(core.urls.auth),
      // Match callable surface: catalogs/backups need real remote HTTP storage.
      storageBackups: hasHttpStorage,
      storageCatalogs: hasHttpStorage,
      storageConfigured: hasHttpStorage || hasR2Binding,
    });

  // Hybrid: preserve HTTP storage.* (file/catalog/multipart/backup) and attach L3a R2.
  // R2-only: L3a helpers + clear unsupported for managed ports.
  // HTTP-only: resolved.storage. Neither: unavailable namespace.
  const storageModule:
    | AthenaStorageModule
    | CloudflareR2StorageModule
    | unknown =
    hasR2Binding && hasHttpStorage
      ? composeHttpAndR2Storage(resolved.storage as AthenaStorageModule, {
          prefix: core.config.storage?.prefix ?? undefined,
          r2,
        })
      : hasR2Binding
        ? createCloudflareR2StorageModule({
            prefix: core.config.storage?.prefix ?? undefined,
            r2,
          })
        : core.urls.storage
          ? resolved.storage
          : createUnavailableNamespace("storage", core.urls);

  const queryCache = getOrCreateClientQueryCache(core);
  registerTransactionCacheObserver(core.internalCore.gatewayTransport, {
    reconcileCommitted(operations, results) {
      for (const [index, operation] of operations.entries()) {
        const result = results[index];
        if (!result || result.error) {
          continue;
        }
        queryCache.reconcileExecutable(operation.descriptor, result);
      }
    },
  });

  const client: AthenaClient<TModels> = {
    admin: {
      query: ((...args: unknown[]) => {
        requireDb();
        return Reflect.apply(resolved.admin.query, resolved.admin, args);
      }) as AthenaClient<TModels>["admin"]["query"],
    },
    auth: (core.urls.auth
      ? resolved.auth
      : createUnavailableNamespace("auth", core.urls)) as AthenaAuthBindings,
    billing: billingModule as AthenaBillingModule,
    cache: queryCache,
    capabilities,
    explain: (executable) => explainAthenaQuery(executable),
    models: core.config.models as TModels,
    chat: (core.urls.chat
      ? resolved.chat
      : createUnavailableNamespace("chat", core.urls)) as AthenaChatModule,
    db: (core.urls.db
      ? resolved.db
      : createUnavailableNamespace(
          "db",
          core.urls
        )) as AthenaClient<TModels>["db"],
    from: ((...args: unknown[]) => {
      requireDb();
      return Reflect.apply(resolved.from, resolved, args);
    }) as AthenaClient<TModels>["from"],
    health: () => {
      requireDb();
      return resolved.health();
    },
    query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) {
      requireDb();
      return resolved.query<Row>(query, options);
    },
    request<T = unknown>(options: AthenaRequestOptions) {
      // Absolute URLs do not need a configured service base URL.
      if (!options.url?.trim()) {
        serviceGuard(core.urls, options.service ?? "db");
      }
      return resolved.request<T>(options);
    },
    rpc: ((...args: unknown[]) => {
      requireDb();
      return Reflect.apply(resolved.rpc, resolved, args);
    }) as AthenaClient<TModels>["rpc"],
    storage: storageModule as AthenaStorageModule,
    system: {
      compatibility: () => {
        requireDb();
        return resolved.system.compatibility();
      },
      runtime: () =>
        toAthenaRuntimeDiagnostics(
          resolveAthenaRuntime(core.config, {
            environment: detectAthenaRuntimeEnvironment(),
            trustedNode: detectAthenaRuntimeEnvironment() === "node",
          })
        ),
      /**
       * Safe auth routing snapshot (no secrets). Does not require db.
       */
      inspectAuth(options?: {
        requestOrigin?: string | null;
      }): AthenaAuthDiagnostics {
        const ctx = viewContext;
        const attached = getAttachedAthenaAuthRouting(client);
        const baseRouting = attached ?? core.authRouting;
        // Recompute server base when caller provides request origin.
        const routing =
          options?.requestOrigin && baseRouting
            ? resolveAthenaAuthRouting({
                credentials: athenaAuthConfig(core.config.auth)?.credentials,
                emitWarnings: false,
                env: core.config.env,
                requestOrigin: options.requestOrigin,
                routing: athenaAuthConfig(core.config.auth)?.routing,
                upstreamUrl: athenaAuthConfig(core.config.auth)?.upstreamUrl,
                url:
                  athenaAuthConfig(core.config.auth)?.url ??
                  baseRouting.browserRequestBaseUrl,
              })
            : baseRouting;
        return toAthenaAuthDiagnostics(routing, {
          bearerToken: ctx?.bearerToken,
          cookie: ctx?.cookie,
          requestOrigin: options?.requestOrigin,
          sessionToken: ctx?.sessionToken,
        });
      },
      release: () => {
        requireDb();
        return resolved.system.release();
      },
    },
    verifyConnection(options?: AthenaGatewayConnectionOptions) {
      requireDb();
      return resolved.verifyConnection(options);
    },
    async close() {
      const internals = getAthenaClientInternals(client);
      if (internals?.ownership === "view" || internals?.source === "view") {
        return;
      }
      if (internals?.close) {
        await internals.close();
      }
    },
    withContext(
      context: AthenaRequestContext
    ): AthenaRequestClient<AthenaClient<TModels>> {
      warnIfEmptyRequestContext(context);
      // Recursive view construction hits TS2589 under dts emit.
      const next = (
        createClientView as (c: unknown, ctx?: AthenaRequestContext) => unknown
      )(core, mergeAthenaRequestContexts(viewContext, context));
      if (core.authRouting) {
        attachAthenaAuthRouting(next as object, core.authRouting);
      }
      const internals = getAthenaClientInternals(client);
      if (internals) {
        attachAthenaClientInternals(
          next as object,
          createViewClientInternals(client, internals)
        );
      }
      return next as AthenaRequestClient<AthenaClient<TModels>>;
    },
  } as AthenaClient<TModels>;

  if (core.authRouting) {
    attachAthenaAuthRouting(client, core.authRouting);
  }

  return Object.freeze(client);
}

/**
 * True when a context object carries no identity, auth, cache, or header signal.
 * Used to catch the common footgun `withContext({})` in development.
 */
export function isEmptyAthenaRequestContext(
  context: AthenaRequestContext | undefined | null
): boolean {
  if (!context) {
    return true;
  }
  const hasHeaders =
    context.headers !== undefined &&
    context.headers !== null &&
    Object.keys(context.headers).length > 0;
  // Treat omitted fields (undefined) the same as explicit null so `{}` is empty.
  return (
    (context.userId === undefined || context.userId === null) &&
    (context.organizationId === undefined || context.organizationId === null) &&
    !normalizeOptionalContextString(context.accessScope) &&
    !normalizeOptionalContextString(context.policyRevision) &&
    !normalizeOptionalContextString(context.cookie) &&
    !normalizeOptionalContextString(context.bearerToken) &&
    !normalizeOptionalContextString(context.sessionToken) &&
    !context.forceNoCache &&
    !hasHeaders
  );
}

function normalizeOptionalContextString(
  value: string | null | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function warnIfEmptyRequestContext(context: AthenaRequestContext): void {
  if (!isEmptyAthenaRequestContext(context)) {
    return;
  }
  // globalThis.process avoids DTS failures without @types/node (Workers CI).
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  if (nodeEnv === "production") {
    return;
  }
  console.warn(
    "[athena] withContext({}) has no userId, organizationId, cookie, bearerToken, sessionToken, headers, or forceNoCache. " +
      "Gateway scope headers will not change. Pass identity fields, or use createAthenaServerClient({ session, scope })."
  );
}

/**
 * Shared client-construction spine with an injectable normalization pipeline.
 *
 * The browser-safe universal pipeline is {@link normalizeUniversalCreateClientConfig};
 * the Node/server entry (`./v3-client.ts`) passes a pipeline that additionally
 * materializes direct PostgreSQL (`db.pgUri`). Keeping the pipeline injectable
 * is what keeps `pg` / Node built-ins out of the browser dependency graph.
 *
 * @internal Not part of the public API surface.
 */
export function createClientWithNormalizer<
  TModels extends AthenaClientModelsInput | undefined,
>(
  config: AthenaClientConfig<TModels>,
  normalize: (input: AthenaClientConfig<TModels>) => AthenaClientConfig<TModels>
): AthenaClient<TModels> | AthenaClientWithR2Storage<TModels> {
  // Nuclear casts: createClientView/resolveCore generics overflow TS depth
  // during declaration emit (TS2589). Keep the public overload return types;
  // never re-instantiate AthenaClient<TModels> in the body expression tree.
  const pipeline = normalize as (c: unknown) => unknown;
  const coreOf = resolveCore as (c: unknown) => unknown;
  const viewOf = createClientView as (c: unknown) => unknown;
  const client: unknown = viewOf(coreOf(pipeline(config)));
  return client as AthenaClientWithR2Storage<TModels>;
}

/**
 * Materialize an Athena client (single public constructor).
 *
 * All backends and modes go through this API:
 * - Gateway HTTP: `createClient({ url, key })`
 * - Edge D1/R2: `createClient({ db: { d1 }, storage: { r2 } })` or top-level `{ d1, r2 }`
 * - Hybrid: edge D1 + `url` for remote auth/billing
 * - Switch: `mode: 'auto' | 'edge' | 'gateway'` and `prefer` when both D1 and URL exist
 *
 * Fluent `from` / `query` / `storage.*` call sites are identical across modes (ADR 0001 / 0015 / 0016).
 * `createCloudflareClient` / `createAthenaRuntime` are thin façades that only map config into this function.
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config:
    | (AthenaClientConfig<TModels> & { r2: R2BucketLike })
    | AthenaClientConfigWithR2<TModels>
): AthenaClientWithR2Storage<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config: AthenaClientConfig<TModels>
): AthenaClient<TModels> | AthenaClientWithR2Storage<TModels> {
  // Nuclear cast: passing the generic normalizer re-instantiates the config
  // graph (TS2589); the spine already erases generics internally.
  const factory = createClientWithNormalizer as unknown as (
    input: unknown,
    normalizer: (c: unknown) => unknown
  ) => unknown;
  const normalize = normalizeUniversalCreateClientConfig as unknown as (
    c: unknown
  ) => unknown;
  const client: unknown = factory(config, normalize);
  return client as AthenaClient<TModels> | AthenaClientWithR2Storage<TModels>;
}
