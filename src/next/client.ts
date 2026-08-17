import type { AthenaClientModelsInput } from "../schema/types.ts";
// Browser-safe client core: "next/client" ships to Client Components and must
// never pull the Node-only direct PostgreSQL transport into the bundle.
import {
  type AthenaClient,
  type AthenaClientConfig,
  assertDirectPostgresRequiresNodeRuntime,
  assertLocalAuthRequiresNodeRuntime,
  createClient as createBrowserSafeClient,
} from "../v3-client-core.ts";
import { createAthenaAuthProxyHandlers } from "../auth/http/proxy.ts";
import { AthenaConfigurationError } from "../config/errors.ts";
import {
  createDiscoveredGatewayTransport,
  normalizeNextDiscovery,
  resolveSameOriginBaseUrl,
  type AthenaNextAdapterConfig,
  type AthenaNextTopologyConfig,
} from "./topology.ts";

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
export type AthenaBrowserClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> =
  | (AthenaBrowserClientBase<TModels> & {
      key: string;
      url: string;
    })
  | (AthenaBrowserClientBase<TModels> & {
      next: { localRuntime: "auto" };
    })
  | (AthenaBrowserClientBase<TModels> & {
      topology: AthenaNextTopologyConfig & { discover: "next" };
    });

/**
 * Thin Next browser façade over {@link createClient}.
 *
 * Application code owns singleton lifetime (module-level export).
 * This factory does not cache clients and does not read process.env.
 */
function attachBrowserAuthHandlers<TClient extends { auth: object }>(
  client: TClient,
  config: { auth?: false | { routing?: string; url?: string | null } }
): TClient {
  const auth = config.auth === false ? undefined : config.auth;
  if (!auth) {
    return client;
  }
  if (!(auth.routing === "same-origin" || (auth.url && auth.url.trim()))) {
    return client;
  }
  if (Object.hasOwn(client.auth, "handlers")) {
    return client;
  }
  Object.assign(client.auth, {
    handlers: createAthenaAuthProxyHandlers(() => ({ client })),
  });
  return client;
}

/**
 * Browser-safe {@link createClient}. Same constructor name as the Node entry;
 * this module never pulls `pg` or embedded Auth.
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaBrowserClientConfig<TModels>): AthenaClient<TModels> {
  assertDirectPostgresRequiresNodeRuntime(config);
  assertLocalAuthRequiresNodeRuntime(config);
  const discovery = normalizeNextDiscovery(config);
  const materialize = discovery
    ? {
        ...config,
        gatewayTransport:
          config.gatewayTransport ?? createDiscoveredGatewayTransport(discovery),
        url: config.url ?? resolveSameOriginBaseUrl(discovery.path),
      }
    : config;
  if (!discovery && !config.url) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "ATHENA_DISCOVERY_CONFIG_INVALID: Next createClient requires url and key unless discovery is enabled.",
      "db"
    );
  }
  const factory = createBrowserSafeClient as unknown as (
    c: typeof materialize
  ) => AthenaClient<TModels>;
  return attachBrowserAuthHandlers(factory(materialize), config);
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
