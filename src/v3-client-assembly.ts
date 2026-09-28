/**
 * Browser-safe Athena client assembly.
 *
 * This module must never import Node-only modules (pg, dns, net, tls, fs, …).
 * Direct PostgreSQL materialization lives in the Node-only wrapper
 * `./v3-client.ts`; browser and edge-restricted entries consume this core.
 */

import {
  athenaAuthConfig,
  isDisabledAthenaAuthConfig,
  isLocalAthenaAuthConfig,
} from "./auth/config.ts";
import { assertLocalAuthHooks } from "./auth/hooks/assert-local.ts";
import { assertLocalAuthObservability } from "./auth/observability/config.ts";
import {
  type AthenaAuthDiagnostics,
  attachAthenaAuthRouting,
  getAttachedAthenaAuthRouting,
  type ResolvedAthenaAuthRouting,
  resolveAthenaAuthRouting,
  toAthenaAuthDiagnostics,
} from "./auth/resolve-routing.ts";
import {
  normalizeUniversalCreateClientConfig as normalizeUniversalCreateClientConfigImpl,
} from "./client/config/normalize.ts";
import {
  athenaChatConfig,
  hasExplicitRemoteHttpApiKeyNeed,
  isEdgeLocalSentinelUrl,
  normalizeOptional,
  isR2Binding,
} from "./client/config/predicates.ts";
import type {
  AthenaAuthBindings,
} from "./auth/types.ts";
import type { AthenaBillingConfig } from "./billing/create-client-config.ts";
import {
  type AthenaBillingModule,
  createBillingModule,
} from "./billing/module.ts";
import { createRequestScopedBillingFacade } from "./billing/runtime/self/request-port.ts";
import { createBrowserBillingTransport } from "./billing/runtime/browser-transport.ts";
import { assertBillingProviderRuntimeEnvironment } from "./billing/runtime/local/providers/config.ts";
import { assertLocalBillingRuntimeEnvironment } from "./billing/runtime/resolve-mode.ts";
import type {
  AthenaChatModule,
} from "./chat/types.ts";
import {
  createInternalClientCore,
  createInternalClientView,
  type AthenaClientRuntimeBindings,
  type InternalAthenaClient,
  type InternalAthenaClientCore,
} from "./client/context.ts";
import type { AthenaRequestClient } from "./client-brands.ts";
import type {
  AthenaChatConfig as ClientAthenaChatConfig,
  AthenaClient as ClientAthenaClient,
  AthenaClientConfig as ClientAthenaClientConfig,
  AthenaClientConfigWithR2 as ClientAthenaClientConfigWithR2,
  AthenaClientWithR2Storage as ClientAthenaClientWithR2Storage,
  AthenaRequestContext as ClientAthenaRequestContext,
} from "./client/contracts.ts";
export type {
  AthenaAuthConfig,
  AthenaChatConfig,
  AthenaChatMode,
  AthenaClient,
  AthenaClientConfig,
  AthenaClientConfigWithR2,
  AthenaClientRuntimeConfig,
  AthenaClientServicesConfig,
  AthenaClientWithR2Storage,
  AthenaDbConfig,
  AthenaRequestContext,
  AthenaRequestContextProvider,
  AthenaStorageConfig,
} from "./client/contracts.ts";
import type {
  AthenaRequestOptions,
} from "./client-request.ts";
import {
  normalizeAthenaAuthorizationConfig,
} from "./runtime/authorization/normalize-config.ts";
import {
  createGatewayCapabilities,
} from "./cloudflare/capabilities.ts";
import { resolveAthenaClientCapabilitiesIr } from "./capabilities/assembly.ts";
import { projectAthenaClientCapabilities } from "./capabilities/client-projection.ts";
import {
  D1_QUERY_CAPABILITIES,
  GATEWAY_QUERY_CAPABILITIES,
  POSTGRES_QUERY_CAPABILITIES,
  SQLITE_LOCAL_QUERY_CAPABILITIES,
} from "./query/engine/capabilities.ts";
import {
  type CloudflareR2StorageModule,
  composeHttpAndR2Storage,
  createCloudflareR2StorageModule,
} from "./cloudflare/r2/storage.ts";
import type {
  R2BucketLike,
} from "./cloudflare/types.ts";
import {
  AthenaConfigurationError,
  type AthenaService,
} from "./config/errors.ts";
import { mergeAthenaRequestContexts } from "./context/merge.ts";
import { registerTransactionCacheObserver } from "./db/transaction/cache.ts";
import { createEmailModule } from "./email/module.ts";
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
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
} from "./gateway/types.ts";
import { createNotificationsEmbeddedHttpRequest } from "./notifications/http-adapter.ts";
import {
  createNotificationsModule,
  unwrapNotificationsGatewayResult,
} from "./notifications/module.ts";
import { explainAthenaQuery } from "./query/explain.ts";
import {
  type AthenaQueryClient,
  createAthenaQueryClient,
} from "./react/query-client.ts";
import {
  attachAthenaClientInternals,
  attachRequestAuthLifecycleGuards,
  createViewClientInternals,
  getAthenaClientInternals,
  isAthenaRequestRuntime,
  throwAthenaRuntimeOwnershipInvalid,
} from "./runtime/client-internals.ts";
import { assertDataLifecycleConfig } from "./runtime/data/lifecycle/assert.ts";
import {
  detectAthenaRuntimeEnvironment,
  resolveAthenaRuntime,
  toAthenaRuntimeDiagnostics,
} from "./runtime/resolve.ts";
import type { AthenaRuntimeTopologyIR } from "./runtime/transport/topology.ts";
import type {
  AthenaClientModelsInput,
} from "./schema/types.ts";
import type { AthenaStorageModule } from "./storage/module.ts";
import {
  getOrCreateNotificationStores,
  linkNotificationStores,
} from "./client/compose/notifications.ts";
import {
  advertiseSafeStorageCapabilities,
  createBrowserStorageTransport,
  createEmbeddedStorageFacade,
  createStorageRuntime,
  getStorageProvider,
  getStorageRuntime,
  wrapStorageModuleWithRuntime,
} from "./storage/runtime/index.ts";
import {
  getLocalObjectStore,
  isLocalStorageConfig,
  isS3StorageConfig,
} from "./storage/runtime.ts";

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
export {
  athenaChatConfig,
  hasRemoteAuthService,
  hasRemoteDbGatewayUrl,
  hasRemoteHttpServices,
  hasRemoteHttpStorage,
  isD1Binding,
  isEdgeLocalSentinelUrl,
  resolveUnifiedRemoteRoot,
} from "./client/config/predicates.ts";

type AthenaRequestContext = ClientAthenaRequestContext;
type AthenaChatConfig = ClientAthenaChatConfig;
type AthenaClientConfig<TModels extends AthenaClientModelsInput | undefined = undefined> =
  ClientAthenaClientConfig<TModels>;
export type { AthenaBillingConfig, AthenaDiagnosticsMode };

/**
 * Next discovery handoff into browser storage/billing HTTP. Not on public
 * {@link AthenaClientConfig} — no stripInternal, so a public member would leak
 * {@link AthenaRuntimeTopologyIR} from root and browser entrypoints.
 */
type AthenaInternalClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaClientConfig<TModels> & {
  localDatabase?: boolean;
  ownedResourceClose?: () => Promise<void>;
  resolveRuntimeTopology?: () => Promise<AthenaRuntimeTopologyIR>;
};

function hasDiscoveredRuntimeTopology(config: unknown): boolean {
  return (
    typeof config === "object" &&
    config != null &&
    typeof (config as { resolveRuntimeTopology?: unknown })
      .resolveRuntimeTopology === "function"
  );
}

type AthenaClientConfigWithR2<TModels extends AthenaClientModelsInput | undefined = undefined> =
  ClientAthenaClientConfigWithR2<TModels>;
type AthenaClientWithR2Storage<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = ClientAthenaClientWithR2Storage<TModels>;

type AthenaClient<
  TModels extends AthenaClientModelsInput | undefined =
    | AthenaClientModelsInput
    | undefined,
> = ClientAthenaClient<TModels>;

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
  readonly config: AthenaInternalClientConfig<TModels>;
  readonly authorizationConfig: ReturnType<
    typeof normalizeAthenaAuthorizationConfig
  >;
  readonly key: string;
  readonly runtimeBindings?: AthenaClientRuntimeBindings;
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

function isRemoteAuthOnlyClient<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const authObject = athenaAuthConfig(config.auth);
  if (
    isDisabledAthenaAuthConfig(config.auth) ||
    isLocalAthenaAuthConfig(config.auth) ||
    !normalizeOptional(authObject?.url)
  ) {
    return false;
  }
  if (config.gatewayTransport) {
    return false;
  }
  if (
    normalizeOptional(config.url) ||
    normalizeOptional(config.db?.url) ||
    normalizeOptional(config.db?.pgUri) ||
    normalizeOptional(config.databaseUrl)
  ) {
    return false;
  }
  if (
    normalizeOptional(config.storage?.url) ||
    (isLocalStorageConfig(config.storage) &&
      Boolean(
        getLocalObjectStore(config.storage) ||
          normalizeOptional(config.storage.root)
      ))
  ) {
    return false;
  }
  if (normalizeOptional(athenaChatConfig(config.chat)?.url)) {
    return false;
  }
  if (normalizeOptional(config.billing?.url)) {
    return false;
  }
  if (
    readFirstEnvHttpUrl(config.env, ATHENA_ENV_URL_KEYS) ||
    readFirstEnvHttpUrl(config.env, ATHENA_ENV_DB_URL_KEYS) ||
    readFirstEnvHttpUrl(config.env, ENV_STORAGE_URL_KEYS) ||
    readFirstEnvHttpUrl(config.env, ENV_CHAT_URL_KEYS)
  ) {
    return false;
  }
  return true;
}

function hasChatSessionCredentials(chat?: boolean | AthenaChatConfig): boolean {
  const options = athenaChatConfig(chat);
  return Boolean(
    normalizeOptional(options?.bearerToken) ??
      normalizeOptional(options?.cookie) ??
      normalizeOptional(options?.sessionToken)
  );
}

function resolveCore<TModels extends AthenaClientModelsInput | undefined>(
  config: AthenaClientConfig<TModels>,
  runtimeBindings?: AthenaClientRuntimeBindings
): AthenaClientCore<TModels> {
  const ownedResourceClose = (
    config as AthenaInternalClientConfig<TModels>
  ).ownedResourceClose;
  const resolvedRuntimeBindings = ownedResourceClose
    ? { ...runtimeBindings, ownedResourceClose }
    : runtimeBindings;
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
    // Billing lives on the main Athena HTTP surface.
    billing: hasDiscoveredRuntimeTopology(config)
      ? normalizeOptional(config.billing?.url)
      : (normalizeOptional(config.billing?.url) ?? dbUrl ?? root ?? undefined),
    chat:
      config.chat === true || athenaChatConfig(config.chat)?.mode === "local"
        ? undefined
        : resolveService(
            athenaChatConfig(config.chat)?.url,
            ENV_CHAT_URL_KEYS,
            "chat"
          ),
    chatWs:
      normalizeOptional(athenaChatConfig(config.chat)?.wsUrl) ??
      (explicitRootWinsOverEnvServices && root
        ? toWebSocketUrl(root)
        : undefined) ??
      readFirstEnvHttpUrl(env, ENV_CHAT_WS_URL_KEYS) ??
      (root ? toWebSocketUrl(root) : undefined),
    db: dbUrl,
    storage: hasDiscoveredRuntimeTopology(config)
      ? normalizeOptional(config.storage?.url)
      : resolveService(
          config.storage?.url,
          ENV_STORAGE_URL_KEYS,
          "storage"
        ),
  };

  const localStorageConfigured =
    isLocalStorageConfig(config.storage) &&
    Boolean(
      getLocalObjectStore(config.storage) ||
        normalizeOptional(config.storage.root)
    );
  const s3StorageConfigured = isS3StorageConfig(config.storage);
  const runtimeEnv = detectAthenaRuntimeEnvironment();
  const browserEmbeddedStorage =
    (runtimeEnv === "browser" || runtimeEnv === "react-native") &&
    !localStorageConfigured &&
    !s3StorageConfigured &&
    !isR2Binding(config.storage?.r2 ?? config.r2) &&
    !normalizeOptional(config.storage?.url) &&
    !readFirstEnvHttpUrl(env, ENV_STORAGE_URL_KEYS);

  if (
    !(
      urls.db ||
      urls.auth ||
      urls.chat ||
      urls.storage ||
      urls.billing ||
      config.gatewayTransport ||
      Boolean(config.db?.sqlite?.executor) ||
      config.chatRuntime ||
      localStorageConfigured ||
      s3StorageConfigured ||
      browserEmbeddedStorage
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
      config.gatewayTransport ||
      localStorageConfigured ||
      s3StorageConfigured ||
      isRemoteAuthOnlyClient(config)
    )
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_API_KEY_REQUIRED",
      "Athena API key is required unless chat session credentials are configured."
    );
  }
  if (
    !(key || hasChatSessionCredentials(config.chat)) &&
    hasExplicitRemoteHttpApiKeyNeed(config) &&
    !isRemoteAuthOnlyClient(config)
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

  const resolvedConfig: AthenaInternalClientConfig<TModels> =
    authWithCredentials ? { ...config, auth: authWithCredentials } : config;

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
    authorizationConfig: normalizeAthenaAuthorizationConfig(resolvedConfig),
    key: key ?? "",
    ...(resolvedRuntimeBindings
      ? { runtimeBindings: resolvedRuntimeBindings }
      : {}),
    urls,
  };
  return {
    ...base,
    internalCore: createInternalClientCore(
      createInternalConfig(base),
      resolvedRuntimeBindings
    ),
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
      canonicalQueries: config.canonicalQueries,
      findManyAst: diagnostics.findManyAst,
      findManyAstRelationSchema: Boolean(config.db?.pgUri),
      rawQueryDiagnostics: diagnostics.rawQueryDiagnostics,
      retryReads: config.retryReads,
      traceQueries: diagnostics.traceQueries,
    },
    chat: athenaChatConfig(config.chat),
    chatUrl: urls.chat,
    chatWsUrl: urls.chatWs,
    client: core.client,
    env: config.env,
    gatewayTransport: config.gatewayTransport,
    headers: config.headers,
    jdbcUrl: config.db?.jdbcUrl,
    localDatabase: Boolean(config.db?.sqlite?.executor),
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

/**
 * Universal createClient normalization pipeline: aliases → mode → edge.
 *
 * Browser-safe: direct PostgreSQL (`db.pgUri`) materialization is applied only
 * by the Node/server entry (`./v3-client.ts`) on top of this pipeline.
 */
export function normalizeUniversalCreateClientConfig<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  return normalizeUniversalCreateClientConfigImpl(config);
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
    config.db?.pool
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

/**
 * Fail fast when a non-Node runtime is handed `storage.provider: "local"`.
 * The filesystem adapter is Node-only and must never enter browser/RN graphs.
 *
 * @internal Used by browser/React Native façades; not public API.
 */
export function assertLocalStorageRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (isLocalStorageConfig(config.storage)) {
    throw new AthenaConfigurationError(
      "ATHENA_STORAGE_LOCAL_NODE_REQUIRED",
      'storage.provider "local" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module.',
      "storage"
    );
  }
}

/**
 * Fail fast when a non-Node runtime is handed `storage.provider: "s3"`.
 * Direct S3 execution is Node-only; the injected client must not enter browser graphs.
 *
 * @internal Used by browser/React Native façades; not public API.
 */
export function assertS3StorageRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (isS3StorageConfig(config.storage)) {
    throw new AthenaConfigurationError(
      "ATHENA_STORAGE_S3_NODE_REQUIRED",
      'storage.provider "s3" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module.',
      "storage"
    );
  }
}

export function assertLocalChatRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  const chat = config.chat;
  const wantsLocal =
    chat === true ||
    (typeof chat === "object" && chat !== null && chat.mode === "local");
  if (wantsLocal || config.chatRuntime) {
    throw new AthenaConfigurationError(
      "ATHENA_CHAT_LOCAL_NODE_REQUIRED",
      'Local Chat requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module, or use chat.mode "remote".',
      "chat"
    );
  }
}

const clientQueryCaches = new WeakMap<object, AthenaQueryClient>();

function authSessionRecord(client: { auth?: unknown }): {
  session?: { id?: unknown; token?: unknown; userId?: unknown };
  user?: { id?: unknown };
} | null {
  try {
    const sessionApi = (
      client.auth as { session?: { get?: () => unknown } } | undefined
    )?.session;
    // Root Auth UI clients have no viewContext.userId; read client.auth.session.
    const payload = sessionApi?.get?.();
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return payload as {
      session?: { id?: unknown; token?: unknown; userId?: unknown };
      user?: { id?: unknown };
    };
  } catch {
    return null;
  }
}

function userIdFromAuthSession(client: { auth?: unknown }): string | null {
  const record = authSessionRecord(client);
  if (!record) {
    return null;
  }
  const userId =
    typeof record.user?.id === "string" ? record.user.id.trim() : "";
  if (userId) {
    return userId;
  }
  const sessionUserId =
    typeof record.session?.userId === "string"
      ? record.session.userId.trim()
      : "";
  return sessionUserId || null;
}

function requestContextFromAuthSession(client: {
  auth?: unknown;
}): AthenaRequestContext | undefined {
  const record = authSessionRecord(client);
  if (!record) {
    return;
  }
  const userId = userIdFromAuthSession(client);
  const token =
    typeof record.session?.token === "string"
      ? record.session.token.trim()
      : "";
  const sessionId =
    typeof record.session?.id === "string" ? record.session.id.trim() : "";
  const sessionToken = token || sessionId;
  if (!(userId || sessionToken)) {
    return;
  }
  return {
    sessionToken: sessionToken || undefined,
    userId: userId || undefined,
  };
}

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
  const requireDb = (): void => {
    if (core.config.localDatabase || core.config.gatewayTransport) {
      return;
    }
    serviceGuard(core.urls, "db");
  };

  const {
    providers: _billingProviders,
    url: _billingUrl,
    testMode: _billingTestMode,
    mode: _billingMode,
    ...billingOptions
  } = core.config.billing ?? {};
  void _billingProviders;
  void _billingUrl;
  void _billingTestMode;
  void _billingMode;
  const explicitBillingUrl = normalizeOptional(_billingUrl);
  const billingRuntimeEnv = detectAthenaRuntimeEnvironment();
  const attachEmbeddedHttpBilling =
    (billingRuntimeEnv === "browser" ||
      billingRuntimeEnv === "react-native" ||
      hasDiscoveredRuntimeTopology(core.config)) &&
    !explicitBillingUrl &&
    core.config.billing?.mode !== "remote";
  const rootBilling = core.internalCore.runtimeBindings?.billing;
  const requestBilling =
    userId && core.internalCore.runtimeBindings?.billingRuntime && rootBilling
      ? createRequestScopedBillingFacade({
          base: rootBilling,
          runtime: core.internalCore.runtimeBindings.billingRuntime,
          userId,
          ...(organizationId ? { organizationId } : {}),
        })
      : undefined;
  const billingModule: AthenaBillingModule | unknown =
    requestBilling ??
    rootBilling ??
    (attachEmbeddedHttpBilling
    ? (createBrowserBillingTransport({
        ...(core.config.app?.url ? { appUrl: core.config.app.url } : {}),
        ...(core.config.billing?.endpoint
          ? { endpoints: { billing: core.config.billing.endpoint } }
          : {}),
        headers: core.config.headers,
        ...(core.config.resolveRuntimeTopology
          ? { resolveTopology: core.config.resolveRuntimeTopology }
          : {}),
      }) as unknown as AthenaBillingModule)
    : core.urls.billing
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
        : createUnavailableNamespace("billing", core.urls));

  const r2 = core.config.storage?.r2;
  const hasR2Binding = isR2Binding(r2);
  // Edge-local sentinel URLs are not real HTTP storage ports.
  const hasHttpStorage = Boolean(
    core.urls.storage && !isEdgeLocalSentinelUrl(core.urls.storage)
  );
  const localObjectStore = getLocalObjectStore<AthenaStorageModule>(
    core.config.storage
  );
  const runtimeEnv = detectAthenaRuntimeEnvironment();
  const hasS3Storage = isS3StorageConfig(core.config.storage);
  const attachEmbeddedHttpStorage =
    (runtimeEnv === "browser" ||
      runtimeEnv === "react-native" ||
      hasDiscoveredRuntimeTopology(core.config)) &&
    !localObjectStore &&
    !hasR2Binding &&
    !hasS3Storage &&
    !normalizeOptional(core.config.storage?.url);

  const baseCapabilities =
    core.config.capabilities ??
    createGatewayCapabilities({
      authRemote: Boolean(core.urls.auth),
      // Match callable surface: catalogs/backups need real remote HTTP storage.
      storageBackups: hasHttpStorage,
      storageCatalogs: hasHttpStorage,
      storageLocal: Boolean(localObjectStore),
      storageConfigured:
        hasHttpStorage ||
        hasR2Binding ||
        Boolean(localObjectStore) ||
        hasS3Storage ||
        attachEmbeddedHttpStorage,
    });

  // Hybrid: preserve HTTP storage.* (file/catalog/multipart/backup) and attach L3a R2.
  // R2-only: L3a helpers + clear unsupported for managed ports.
  // Local Node ObjectStore: catalog-optional file.* (ADR 0027).
  const storageModule:
    | AthenaStorageModule
    | CloudflareR2StorageModule
    | unknown = localObjectStore
    ? localObjectStore
    : hasR2Binding && hasHttpStorage
      ? composeHttpAndR2Storage(resolved.storage as AthenaStorageModule, {
          prefix: core.config.storage?.prefix ?? undefined,
          r2,
        })
      : hasR2Binding
        ? createCloudflareR2StorageModule({
            prefix: core.config.storage?.prefix ?? undefined,
            r2,
          })
        : hasS3Storage || attachEmbeddedHttpStorage
          ? createEmbeddedStorageFacade()
          : core.urls.storage
            ? resolved.storage
            : createUnavailableNamespace("storage", core.urls);

  const storageProvider = getStorageProvider(core.config.storage);
  const embeddedHttpProvider = attachEmbeddedHttpStorage
    ? createBrowserStorageTransport({
        ...(core.config.storage?.endpoint
          ? { endpoints: { storage: core.config.storage.endpoint } }
          : {}),
        headers: core.config.headers,
        ...(core.config.resolveRuntimeTopology
          ? { resolveTopology: core.config.resolveRuntimeTopology }
          : {}),
      })
    : undefined;
  const storageRuntime =
    getStorageRuntime(core.config.storage) ??
    (storageProvider
      ? createStorageRuntime({
          lifecycle: core.config.lifecycle?.storage,
          provider: storageProvider,
        })
      : undefined) ??
    (embeddedHttpProvider
      ? createStorageRuntime({
          lifecycle: core.config.lifecycle?.storage,
          provider: embeddedHttpProvider,
        })
      : undefined);
  const boundStorage =
    storageRuntime &&
    (localObjectStore || attachEmbeddedHttpStorage || hasS3Storage)
      ? wrapStorageModuleWithRuntime(storageModule as object, storageRuntime)
      : storageModule;
  if (storageRuntime && boundStorage && typeof boundStorage === "object") {
    advertiseSafeStorageCapabilities(
      boundStorage as object,
      core.config.storage
    );
  }
  const capabilitiesIr = resolveAthenaClientCapabilitiesIr({
    base: baseCapabilities,
    query:
      baseCapabilities.db.engine === "sqlite"
        ? SQLITE_LOCAL_QUERY_CAPABILITIES
        : baseCapabilities.db.engine === "cloudflare-d1"
        ? D1_QUERY_CAPABILITIES
        : baseCapabilities.db.engine === "postgresql"
          ? POSTGRES_QUERY_CAPABILITIES
          : GATEWAY_QUERY_CAPABILITIES,
    auth:
      core.config.auth !== false &&
      (Boolean(core.urls.auth) || isLocalAthenaAuthConfig(core.config.auth))
        ? resolved.auth.capabilities.getSnapshot()
        : undefined,
    chat:
      core.config.chatRuntime || core.urls.chat
        ? resolved.chat.capabilities
        : undefined,
    storage: {
      backups: baseCapabilities.storage.backups,
      catalogs: baseCapabilities.storage.catalogs,
      objects:
        Boolean(storageRuntime) || baseCapabilities.storage.objects,
      source: core.config.storage?.provider ?? "runtime",
    },
    billingProvider: core.config.billing?.providers
      ? Object.keys(core.config.billing.providers)[0] ?? "configured"
      : undefined,
  });
  const capabilities = projectAthenaClientCapabilities(
    capabilitiesIr,
    baseCapabilities
  );

  const useRemoteNotifications =
    !(
      isLocalAthenaAuthConfig(core.config.auth) ||
      core.config.db?.pgUri ||
      core.config.gatewayTransport
    ) && Boolean(core.urls.db || core.urls.auth);
  const notificationsRuntimeEnv = detectAthenaRuntimeEnvironment();
  const attachEmbeddedHttpNotifications =
    notificationsRuntimeEnv === "browser" ||
    notificationsRuntimeEnv === "react-native";
  const notificationStores = getOrCreateNotificationStores(core);

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
    chat: (core.config.chatRuntime
      ? core.config.chatRuntime
      : core.urls.chat
        ? resolved.chat
        : createUnavailableNamespace("chat", core.urls)) as AthenaChatModule,
    async close() {
      const internals = getAthenaClientInternals(client);
      if (isAthenaRequestRuntime(internals)) {
        throwAthenaRuntimeOwnershipInvalid("close");
      }
      if (internals?.close) {
        await internals.close();
      } else {
        await core.internalCore.runtimeBindings?.ownedResourceClose?.();
      }
    },
    db: (core.urls.db || core.config.localDatabase || core.config.gatewayTransport
      ? resolved.db
      : createUnavailableNamespace(
          "db",
          core.urls
        )) as AthenaClient<TModels>["db"],
    email: createEmailModule(core.config.email),
    explain: (executable) => explainAthenaQuery(executable),
    from: ((...args: unknown[]) => {
      requireDb();
      return Reflect.apply(resolved.from, resolved, args);
    }) as AthenaClient<TModels>["from"],
    health: () => {
      requireDb();
      return resolved.health();
    },
    models: core.config.models as TModels,
    notifications: createNotificationsModule({
      catalog: core.config.notifications?.catalog,
      eventStore: notificationStores.eventStore,
      getUserId: () => {
        const scoped = viewContext?.userId?.trim();
        if (scoped) {
          return scoped;
        }
        return userIdFromAuthSession(client);
      },
      preferenceStore: notificationStores.preferenceStore,
      remoteDialect: attachEmbeddedHttpNotifications
        ? "embedded-http"
        : "gateway-v1",
      remoteRequest: attachEmbeddedHttpNotifications
        ? createNotificationsEmbeddedHttpRequest()
        : useRemoteNotifications
          ? async (input) => {
              const forwarded = mergeAthenaRequestContexts(
                requestContextFromAuthSession(client),
                viewContext
              );
              const requester =
                forwarded && !isEmptyAthenaRequestContext(forwarded)
                  ? client.withContext(forwarded)
                  : client;
              const result = await requester.request({
                body:
                  input.method === "GET" || input.method === "DELETE"
                    ? undefined
                    : input.body,
                credentials: athenaAuthConfig(core.config.auth)?.credentials,
                method: input.method,
                path: input.path,
                query: input.query,
                service: core.urls.db ? "db" : "auth",
              });
              return unwrapNotificationsGatewayResult(result);
            }
          : undefined,
      transport:
        attachEmbeddedHttpNotifications || useRemoteNotifications
          ? "remote"
          : "embedded",
    }),
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
    storage: boundStorage as AthenaStorageModule,
    system: {
      compatibility: () => {
        requireDb();
        return resolved.system.compatibility();
      },
      /**
       * Safe auth routing snapshot (no secrets). Does not require db.
       */
      inspectAuth(options?: {
        requestOrigin?: string | null;
      }): AthenaAuthDiagnostics {
        const ctx = viewContext;
        // AUTH-1: project the construction-time authority only. Origin may
        // fill serverRequestBaseUrl; it must not re-run routing policy.
        const routing =
          getAttachedAthenaAuthRouting(client) ?? core.authRouting;
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
      runtime: () =>
        toAthenaRuntimeDiagnostics(
          resolveAthenaRuntime(core.config, {
            environment: detectAthenaRuntimeEnvironment(),
            trustedNode: detectAthenaRuntimeEnvironment() === "node",
          })
        ),
    },
    verifyConnection(options?: AthenaGatewayConnectionOptions) {
      requireDb();
      return resolved.verifyConnection(options);
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
      attachRequestAuthLifecycleGuards(next as object, client);
      linkNotificationStores(next as object, notificationStores);
      return next as AthenaRequestClient<AthenaClient<TModels>>;
    },
  } as AthenaClient<TModels>;

  linkNotificationStores(client, notificationStores);

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
  normalize: (input: AthenaClientConfig<TModels>) => AthenaClientConfig<TModels>,
  runtimeBindings?: AthenaClientRuntimeBindings
): AthenaClient<TModels> | AthenaClientWithR2Storage<TModels> {
  // Nuclear casts: createClientView/resolveCore generics overflow TS depth
  // during declaration emit (TS2589). Keep the public overload return types;
  // never re-instantiate AthenaClient<TModels> in the body expression tree.
  const pipeline = normalize as (c: unknown) => unknown;
  const coreOf = resolveCore as (
    c: unknown,
    bindings?: AthenaClientRuntimeBindings
  ) => unknown;
  const viewOf = createClientView as (c: unknown) => unknown;
  const client: unknown = viewOf(coreOf(pipeline(config), runtimeBindings));
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
    normalizer: (c: unknown) => unknown,
    runtimeBindings?: AthenaClientRuntimeBindings
  ) => unknown;
  const normalize = normalizeUniversalCreateClientConfig as unknown as (
    c: unknown
  ) => unknown;
  assertDataLifecycleConfig(config);
  assertLocalBillingRuntimeEnvironment({
    configuredProviders: config.billing?.providers,
    mode: config.billing?.mode,
  });
  assertBillingProviderRuntimeEnvironment(config.billing?.providers);
  const client: unknown = factory(config, normalize);
  assertLocalAuthHooks(athenaAuthConfig(config.auth));
  assertLocalAuthObservability(athenaAuthConfig(config.auth));
  return client as AthenaClient<TModels> | AthenaClientWithR2Storage<TModels>;
}
