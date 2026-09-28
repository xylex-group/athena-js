import {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  type AthenaAuthCapabilitiesResult,
} from "../auth/capabilities.ts";
import { bindAthenaAuthClientBaseUrl } from "../auth/client.ts";
import { createAthenaAuthProxyHandlers } from "../auth/http/proxy.ts";
import {
  attachAthenaAuthRouting,
  type ResolvedAthenaAuthRouting,
  resolveAthenaAuthRouting,
  resolveExplicitAuthRouting,
} from "../auth/resolve-routing.ts";
import {
  ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
  AthenaBillingError,
} from "../billing/errors.ts";
import { AthenaConfigurationError } from "../config/errors.ts";
import { ATHENA_NEXT_RUNTIME_PROTOCOL } from "../gateway/protocol.ts";
import type { AthenaClientModelsInput } from "../schema/types.ts";
import { AthenaStorageError } from "../storage/runtime/errors.ts";
import { ATHENA_AUTH_PATH } from "../utils/athena-auth-url.ts";
// Browser-safe client core: "next/client" ships to Client Components and must
// never pull the Node-only direct PostgreSQL transport into the bundle.
import {
  type AthenaClient,
  type AthenaClientConfig,
  assertDirectPostgresRequiresNodeRuntime,
  assertLocalAuthRequiresNodeRuntime,
  assertLocalChatRequiresNodeRuntime,
  assertLocalStorageRequiresNodeRuntime,
  assertS3StorageRequiresNodeRuntime,
  createClient as createBrowserSafeClient,
} from "../v3-client-core.ts";
import {
  ATHENA_AUTH_NOT_AVAILABLE,
  type AthenaNextAdapterConfig,
  type AthenaNextTopologyConfig,
  createDiscoveredNextRuntime,
  normalizeNextDiscovery,
  type ResolvedNextAthenaRuntimeTopology,
  type ResolvedNextAthenaTopology,
  resolveSameOriginBaseUrl,
} from "./topology.ts";

export { athenaNotificationCatalogDemo } from "../notifications/catalog.ts";

export {
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
  ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH,
  ATHENA_AUTH_GET_SESSION_PATH,
  ATHENA_AUTH_PATH,
  ATHENA_AUTH_UPSTREAM_ENV_KEYS,
  ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES,
  ATHENA_AUTH_VERIFY_EMAIL_PATH,
  ATHENA_SESSION_DATA_HEADER,
  type AthenaAuthClientBaseUrlOptions,
  type AthenaAuthUpstreamEnv,
  type AthenaAuthUpstreamEnvKey,
  AUTH_SESSION_PATH,
  createFreshSessionLookupUrl,
  DEFAULT_ATHENA_AUTH_ORIGIN,
  DEFAULT_ATHENA_AUTH_UPSTREAM_URL,
  DISABLE_COOKIE_CACHE_QUERY_PARAM,
  DISABLE_COOKIE_CACHE_QUERY_VALUE,
  type EnvLike,
  isAbsoluteUrl,
  LOCAL_DEV_ORIGIN,
  normalizeAthenaAuthBaseUrl,
  readAthenaAuthUpstreamUrlFromEnv,
  resolveAthenaAuthClientBaseUrl,
  resolveAthenaAuthRequestUrl,
  resolveAthenaAuthUpstreamUrl,
  resolveEmailVerificationCallbackUrl,
  SESSION_DATA_HEADER,
} from "../utils/athena-auth-url.ts";
export type {
  AthenaRequestHeaderOverrideFields,
  AthenaRequestHeaderProfile,
  BuildAthenaRequestHeadersInput,
} from "../utils/athena-request-headers.ts";
export {
  buildAthenaGatewayHeaders,
  buildAthenaRequestHeaders,
} from "../utils/athena-request-headers.ts";
/**
 * Browser cookie wipe for Athena/Better Auth prefixes.
 * Re-exported so client apps can import sign-out helpers from one Next entry.
 */
export {
  ATHENA_AUTH_COOKIE_PREFIXES,
  type ClearAuthCookiesOptions,
  clearAuthCookies,
} from "../utils/auth-cookies.ts";
export {
  AUTH_DEFAULT_VIEW,
  AUTH_MODE_REDIRECTS,
  AUTH_MODE_SET,
  AUTH_ROUTES,
  AUTH_TWO_FACTOR_SEGMENT,
  AUTH_VIEW_BY_SEGMENT,
  AUTHENTICATED_REDIRECT_MODE_SET,
  AUTHENTICATED_REDIRECT_VIEW_SET,
  type AuthMode,
  type AuthModeRedirects,
  type AuthRoutes,
  type AuthView,
  createAuthModeRedirects,
  createAuthRoutes,
  isAuthMode,
  resolveAuthModeRedirect,
  resolveAuthViewFromSegment,
  shouldRedirectAuthenticatedAuthMode,
  shouldRedirectAuthenticatedAuthView,
} from "../utils/auth-routes.ts";
export {
  asNonEmptyString,
  asString,
  readTrimmedString,
} from "../utils/coercions.ts";
export {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  ATHENA_AUTH_SESSION_COOKIE_NAMES,
  type AthenaAuthSessionBridgeClientOptions,
  type AthenaAuthSessionBridgePayload,
  type AthenaAuthSessionBridgeSource,
  clearAthenaAuthSessionOnAppHost,
  persistAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
} from "./session-bridge/index.ts";

export type {
  AthenaNextAdapterConfig,
  AthenaNextTopologyConfig,
  ResolvedNextAthenaTopology,
} from "./topology.ts";
export { resetAthenaDiscoverySessionCache } from "./topology.ts";

type AthenaBrowserClientBase<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = Omit<AthenaClientConfig<TModels>, "env" | "context"> & {
  next?: AthenaNextAdapterConfig;
  topology?: AthenaNextTopologyConfig;
};

/**
 * Browser-safe Next client configuration.
 *
 * Explicit `url` + `key` remain the hosted default.
 * Opt-in discovery (`topology.discover: "next"` or `next.localRuntime: "auto"`)
 * may omit them when fallback is `"error"`.
 */
type AthenaBrowserClientHostedConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBrowserClientBase<TModels> & {
  key: string;
  url: string;
};

type AthenaBrowserClientLocalRuntimeConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBrowserClientBase<TModels> & {
  next: { localRuntime: "auto" };
};

type AthenaBrowserClientDiscoverConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBrowserClientBase<TModels> & {
  topology: AthenaNextTopologyConfig & { discover: "next" };
};

export type AthenaBrowserClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> =
  | AthenaBrowserClientHostedConfig<TModels>
  | AthenaBrowserClientLocalRuntimeConfig<TModels>
  | AthenaBrowserClientDiscoverConfig<TModels>;

/**
 * Private Next discovery handoff into the browser-safe core.
 * Must not appear on public {@link AthenaClientConfig} / {@link AthenaBrowserClientConfig}.
 */
type AthenaNextInternalClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBrowserClientConfig<TModels> & {
  resolveRuntimeTopology?: () => Promise<ResolvedNextAthenaRuntimeTopology>;
};

/**
 * Thin Next browser façade over {@link createClient}.
 *
 * Application code owns singleton lifetime (module-level export).
 * This factory does not cache clients and does not read process.env.
 */
function routingFromTopologyAuth(
  auth: NonNullable<ResolvedNextAthenaTopology["auth"]>
): ResolvedAthenaAuthRouting {
  if (auth.transport === "remote") {
    return resolveAthenaAuthRouting({
      emitWarnings: false,
      routing: "direct",
      url: auth.path,
    });
  }
  return resolveAthenaAuthRouting({
    emitWarnings: false,
    routing: "same-origin",
  });
}

function discoveredAuthBasePath(
  topology: ResolvedNextAthenaRuntimeTopology
): string | undefined {
  const advertised = topology.transports.auth;
  if (advertised?.kind === "http") {
    const path = advertised.basePath.trim();
    if (path) {
      return path;
    }
  }
  const fallback = topology.auth?.path.trim();
  if (fallback) {
    return fallback;
  }
}

function routingFromDiscoveredAuth(
  auth: NonNullable<ResolvedNextAthenaTopology["auth"]>,
  path: string
): ResolvedAthenaAuthRouting {
  if (auth.transport === "remote" || /^https?:\/\//i.test(path)) {
    return resolveAthenaAuthRouting({
      emitWarnings: false,
      routing: "direct",
      url: path,
    });
  }
  if (path !== ATHENA_AUTH_PATH) {
    return resolveAthenaAuthRouting({
      emitWarnings: false,
      routing: "custom",
      url: path,
    });
  }
  return resolveAthenaAuthRouting({
    emitWarnings: false,
    routing: "same-origin",
  });
}

function authNotAvailableResult(): {
  data: null;
  error: typeof ATHENA_AUTH_NOT_AVAILABLE;
  errorDetails: {
    code: typeof ATHENA_AUTH_NOT_AVAILABLE;
    message: string;
    status: number;
  };
  ok: false;
  raw: { error: { code: typeof ATHENA_AUTH_NOT_AVAILABLE } };
  status: 404;
} {
  return {
    data: null,
    error: ATHENA_AUTH_NOT_AVAILABLE,
    errorDetails: {
      code: ATHENA_AUTH_NOT_AVAILABLE,
      message:
        "Athena Auth is not available on this runtime (Data probe succeeded).",
      status: 404,
    },
    ok: false,
    raw: { error: { code: ATHENA_AUTH_NOT_AVAILABLE } },
    status: 404,
  };
}

type AuthCapabilitiesSurface = {
  markUnknown?: (source?: string) => void;
  set?: (next: typeof ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT) => void;
};

function authCapabilitiesOf(client: {
  auth: object;
}): AuthCapabilitiesSurface | undefined {
  return (client.auth as { capabilities?: AuthCapabilitiesSurface })
    .capabilities;
}

function seedDefaultEmbeddedCapabilities(client: { auth: object }) {
  authCapabilitiesOf(client)?.set?.(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT);
}

async function seedSameOriginAuthCapabilities(client: { auth: object }) {
  const surface = authCapabilitiesOf(client);
  const ok = (
    client.auth as {
      ok?: () => Promise<{
        data?: { capabilities?: AthenaAuthCapabilitiesResult };
      }>;
    }
  ).ok;
  if (typeof ok === "function") {
    try {
      const result = await ok();
      const advertised = result?.data?.capabilities;
      if (advertised && typeof advertised === "object") {
        surface?.set?.(advertised);
        return;
      }
    } catch {
      // Fall through to the default snapshot.
    }
  }
  seedDefaultEmbeddedCapabilities(client);
}

const AUTH_DISCOVERY_BIND_SKIP = new Set([
  "capabilities",
  "handlers",
  "session",
  "tokenProvider",
]);

function wrapStorageFileOpsForDiscoveredTopology<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  client: Pick<AthenaClient<TModels>, "storage">,
  resolveTopology: () => Promise<ResolvedNextAthenaRuntimeTopology>
): void {
  const file = client.storage?.file;
  if (!file) {
    return;
  }
  for (const key of Object.keys(file)) {
    const value = Reflect.get(file, key);
    if (typeof value !== "function") {
      continue;
    }
    Reflect.set(file, key, async (...args: unknown[]) => {
      const topology = await resolveTopology();
      if (topology.transports.storage?.kind !== "http") {
        throw new AthenaStorageError({
          code: "storage_unavailable",
          errorNumber: 3007,
          message: "storage runtime is not configured",
          status: 503,
        });
      }
      return value.apply(file, args);
    });
  }
}

function wrapBillingOpsForDiscoveredTopology(
  client: { billing?: object },
  resolveTopology: () => Promise<ResolvedNextAthenaRuntimeTopology>
): void {
  const billing = client.billing as Record<string, unknown> | undefined;
  if (!billing) {
    return;
  }
  for (const key of Object.keys(billing)) {
    const value = billing[key];
    if (typeof value !== "function") {
      if (value && typeof value === "object") {
        wrapBillingOpsForDiscoveredTopology(
          { billing: value as object },
          resolveTopology
        );
      }
      continue;
    }
    const original = value as (...args: unknown[]) => unknown;
    billing[key] = async (...args: unknown[]) => {
      const topology = await resolveTopology();
      if (topology.transports.billing?.kind !== "http") {
        throw new AthenaBillingError({
          body: undefined,
          code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
          endpoint: "",
          message: "billing runtime is not configured",
          method: "POST",
          status: 503,
        });
      }
      return original.apply(billing, args);
    };
  }
}

function wrapAuthOperationsForDiscoveredTopology(
  target: object,
  ensureAuthTopologyBound: () => Promise<unknown>
): void {
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (AUTH_DISCOVERY_BIND_SKIP.has(key)) {
      continue;
    }
    const value = record[key];
    if (typeof value === "function") {
      const original = value as (...args: unknown[]) => unknown;
      const wrapped = async (...args: unknown[]) => {
        const blocked = await ensureAuthTopologyBound();
        if (blocked !== undefined) {
          return blocked;
        }
        return original.apply(target, args);
      };
      Object.assign(wrapped, original);
      record[key] = wrapped;
      wrapAuthOperationsForDiscoveredTopology(wrapped, ensureAuthTopologyBound);
      continue;
    }
    if (value && typeof value === "object") {
      wrapAuthOperationsForDiscoveredTopology(value, ensureAuthTopologyBound);
    }
  }
}

function bindAuthToDiscoveredTopology<TClient extends { auth: object }>(
  client: TClient,
  resolveTopology: () => Promise<ResolvedNextAthenaRuntimeTopology>
): TClient {
  let pending: Promise<ResolvedNextAthenaRuntimeTopology> | undefined;
  let bound = false;
  const load = () => {
    if (!pending) {
      const next = resolveTopology();
      pending = next;
      void next.catch(() => {
        if (pending === next) {
          pending = undefined;
        }
      });
    }
    return pending;
  };
  const ensureAuthTopologyBound = async () => {
    const topology = await load();
    if (!topology.auth) {
      pending = undefined;
      authCapabilitiesOf(client)?.markUnknown?.("http");
      return authNotAvailableResult();
    }
    if (bound) {
      return;
    }
    const path = discoveredAuthBasePath(topology);
    if (path) {
      bindAthenaAuthClientBaseUrl(client.auth, path);
      attachAthenaAuthRouting(
        client,
        routingFromDiscoveredAuth(topology.auth, path)
      );
    }
    bound = true;
    await seedSameOriginAuthCapabilities(client);
  };
  wrapAuthOperationsForDiscoveredTopology(client.auth, ensureAuthTopologyBound);
  return client;
}

function attachBrowserAuthHandlers<TClient extends { auth: object }>(
  client: TClient,
  config: { auth?: false | { routing?: string; url?: string | null } },
  resolvedRouting?: ResolvedAthenaAuthRouting
): TClient {
  const shouldAttachProxy =
    resolvedRouting?.mode === "same-origin" ||
    (config.auth !== false &&
      Boolean(
        config.auth?.routing === "same-origin" || config.auth?.url?.trim()
      ));
  if (shouldAttachProxy && !Object.hasOwn(client.auth, "handlers")) {
    Object.assign(client.auth, {
      handlers: createAthenaAuthProxyHandlers(() => ({ client })),
    });
  }
  return client;
}

/**
 * Browser-safe {@link createClient}. Same constructor name as the Node entry;
 * this module never pulls `pg` or embedded Auth.
 *
 * @docsCanonical
 * @docsRuntime browser
 * @docsRole browser-client-constructor
 * @docsRelated createClient
 * @since 5.0.0
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaBrowserClientConfig<TModels>): AthenaClient<TModels> {
  assertDirectPostgresRequiresNodeRuntime(config);
  assertLocalAuthRequiresNodeRuntime(config);
  assertLocalChatRequiresNodeRuntime(config);
  assertLocalStorageRequiresNodeRuntime(config);
  assertS3StorageRequiresNodeRuntime(config);
  const discovery = normalizeNextDiscovery(config);
  const explicitRouting = resolveExplicitAuthRouting(
    config.auth === false ? false : config.auth
  );
  const discovered = discovery
    ? createDiscoveredNextRuntime(discovery)
    : undefined;
  const includeAuthTransport = !(config.auth === false || explicitRouting);
  const resolvedTopology: ResolvedNextAthenaTopology | undefined = discovery
    ? {
        ...(includeAuthTransport
          ? { auth: { path: ATHENA_AUTH_PATH, transport: "same-origin" } }
          : {}),
        data: { path: discovery.path },
        protocol: ATHENA_NEXT_RUNTIME_PROTOCOL,
      }
    : undefined;
  const attachedRouting =
    explicitRouting ??
    (resolvedTopology?.auth
      ? routingFromTopologyAuth(resolvedTopology.auth)
      : undefined);
  const materializeAuth =
    config.auth === false
      ? false
      : explicitRouting
        ? config.auth
        : discovery
          ? typeof config.auth === "object" && config.auth
            ? config.auth
            : undefined
          : config.auth;
  const materialize: AthenaNextInternalClientConfig<TModels> =
    discovered && discovery
      ? ({
          ...config,
          auth: materializeAuth,
          gatewayTransport: config.gatewayTransport ?? discovered.transport,
          key: config.key ?? "athena-next-discovery",
          resolveRuntimeTopology: () => discovered.resolveTopology(),
          url: config.url ?? resolveSameOriginBaseUrl(discovery.path),
        } as AthenaNextInternalClientConfig<TModels>)
      : config;
  if (!(discovery || config.url)) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "ATHENA_DISCOVERY_CONFIG_INVALID: Next createClient requires url and key unless discovery is enabled.",
      "db"
    );
  }
  const factory = createBrowserSafeClient as unknown as (
    c: AthenaNextInternalClientConfig<TModels>
  ) => AthenaClient<TModels>;
  const client = attachBrowserAuthHandlers(
    factory(materialize),
    config,
    attachedRouting
  );
  if (attachedRouting) {
    attachAthenaAuthRouting(client, attachedRouting);
  }
  if (discovered && !explicitRouting && config.auth !== false) {
    bindAuthToDiscoveredTopology(client, () => discovered.resolveTopology());
  }
  if (discovered) {
    wrapStorageFileOpsForDiscoveredTopology(client, () =>
      discovered.resolveTopology()
    );
    wrapBillingOpsForDiscoveredTopology(client, () =>
      discovered.resolveTopology()
    );
  }
  if (resolvedTopology?.auth) {
    seedDefaultEmbeddedCapabilities(client);
    if (!discovered) {
      void seedSameOriginAuthCapabilities(client);
    }
  }
  return client;
}

/**
 * Thin Next browser façade over {@link createClient}.
 *
 * Application code owns singleton lifetime (module-level export).
 * This factory does not cache clients and does not read process.env.
 *
 * @deprecated Prefer {@link createClient} from `@xylex-group/athena/next/client`.
 */
export function createAthenaBrowserClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaBrowserClientConfig<TModels>): AthenaClient<TModels> {
  const factory = createClient as unknown as (
    c: AthenaBrowserClientConfig<TModels>
  ) => AthenaClient<TModels>;
  return factory(config);
}
