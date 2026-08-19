import "server-only";

import type { AthenaSessionData } from "../auth/session-data.ts";
import type { AthenaAuthSessionResponse } from "../auth/types.ts";
import { mergeAthenaRequestContexts } from "../context/merge.ts";
import { isNodeProductionEnv } from "../node-env.ts";
import type { AthenaClientModelsInput } from "../schema/types.ts";
import type { AthenaRequestClient } from "../client-brands.ts";
import {
  type AthenaClient,
  type AthenaClientConfig,
  type AthenaRequestContext,
  createClient,
} from "../v3-client.ts";
import {
  type AthenaServerRequestOptions,
  resolveNextRequestContext,
} from "./shared.ts";

/**
 * Minimal session shape used to derive gateway identity headers.
 * Accepts full transport session, {@link AthenaSessionData}, or a partial payload.
 */
export type AthenaServerSessionInput = {
  organization?: { activeId?: string | null } | null;
  user?: { id?: string | null } | null;
  session?: { id?: string | null; activeOrganizationId?: string | null } | null;
} | null;

/**
 * Explicit gateway identity for request-scoped server clients.
 *
 * Maps to `X-User-Id` / `X-Organization-Id` via {@link AthenaRequestContext}.
 * When both `session` and `scope` are provided, any field present on `scope`
 * overrides the session-derived value (including explicit `null` to clear).
 */
export interface AthenaServerScope {
  organizationId?: string | null;
  userId?: string | null;
}

export interface AthenaServerContextOptions extends AthenaServerRequestOptions {
  /**
   * First-class identity scope. Prefer this over a second `withContext(...)`
   * call when you already know user/org for the request.
   */
  scope?: AthenaServerScope;
  session?:
    | AthenaAuthSessionResponse
    | AthenaSessionData
    | AthenaServerSessionInput
    | null;
}

export interface AthenaResolvedServerContext {
  organizationId: string | null;
  request: AthenaRequestContext;
  session:
    | AthenaAuthSessionResponse
    | AthenaSessionData
    | AthenaServerSessionInput
    | null;
  userId: string | null;
}

function warnEmptyServerScope(): void {
  if (isNodeProductionEnv()) {
    return;
  }
  console.warn(
    "[athena] createAthenaServerClient/resolveAthenaServerContext: `scope` was provided without userId or organizationId. " +
      "Gateway identity headers will not be set from scope. Pass at least one field, or omit scope."
  );
}

function resolveServerIdentity(options: {
  session?:
    | AthenaAuthSessionResponse
    | AthenaSessionData
    | AthenaServerSessionInput
    | null;
  scope?: AthenaServerScope;
}): { userId: string | null; organizationId: string | null } {
  const session = options.session ?? null;
  const sessionUserId = session?.user?.id ?? null;
  const sessionOrganizationId =
    (session as AthenaSessionData | null)?.organization?.activeId ??
    session?.session?.activeOrganizationId ??
    null;

  const scope = options.scope;
  if (scope === undefined) {
    return {
      organizationId: sessionOrganizationId,
      userId: sessionUserId,
    };
  }

  const scopeHasUserId = Object.hasOwn(scope, "userId");
  const scopeHasOrganizationId = Object.hasOwn(scope, "organizationId");

  if (!(scopeHasUserId || scopeHasOrganizationId)) {
    warnEmptyServerScope();
  }

  return {
    organizationId: scopeHasOrganizationId
      ? (scope.organizationId ?? null)
      : sessionOrganizationId,
    userId: scopeHasUserId ? (scope.userId ?? null) : sessionUserId,
  };
}

export async function resolveAthenaServerContext(
  options: AthenaServerContextOptions = {}
): Promise<AthenaResolvedServerContext> {
  const request = await resolveNextRequestContext(options);
  const session = options.session ?? null;
  const { userId, organizationId } = resolveServerIdentity({
    scope: options.scope,
    session,
  });

  return {
    organizationId,
    request: {
      ...request,
      organizationId,
      userId,
    },
    session,
    userId,
  };
}

type AthenaBaseServerOptions = AthenaServerRequestOptions & {
  session?:
    | AthenaAuthSessionResponse
    | AthenaSessionData
    | AthenaServerSessionInput
    | null;
  scope?: AthenaServerScope;
};

/**
 * Explicit server config: require url + key at the call site.
 */
export type AthenaExplicitServerConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBaseServerOptions &
  AthenaClientConfig<TModels> & {
    url: string;
    key: string;
  };

/**
 * Environment server config: require an explicit env object (no silent global process.env).
 */
export type AthenaEnvironmentServerConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBaseServerOptions &
  Omit<AthenaClientConfig<TModels>, "url" | "key"> & {
    env: Record<string, string | undefined>;
  };

/**
 * Structural layered-client surface — avoid `AthenaClient` generics (TS2589).
 *
 * `withContext` must return an opaque value. Comparing the full request-client
 * database surface (db.delete table unions, findMany, model registries) against
 * an unparameterized `AthenaClient` rejects strongly typed roots and can
 * explode into TS2589. The implementation casts the opaque result internally.
 */
export type AthenaLayeredServerClient = {
  withContext: (context: AthenaRequestContext) => unknown;
};

/**
 * Layer a request view over an existing root client (P12).
 */
export type AthenaLayeredServerConfig = AthenaBaseServerOptions & {
  client: AthenaLayeredServerClient;
};

/**
 * Local PostgreSQL Next server config. Same `databaseUrl` as `createClient`.
 */
export type AthenaLocalDatabaseServerConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaBaseServerOptions &
  Omit<AthenaClientConfig<TModels>, "url" | "key"> & {
    databaseUrl: string;
  };

/**
 * Flat Next server client options: client config fields + request context options.
 * Requires `{ url, key }`, `{ env }`, `{ databaseUrl }`, or `{ client }`.
 */
export type AthenaServerClientConfig<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> =
  | AthenaExplicitServerConfig<TModels>
  | AthenaEnvironmentServerConfig<TModels>
  | AthenaLocalDatabaseServerConfig<TModels>
  | AthenaLayeredServerConfig;

function isAthenaClientInstance(
  value: unknown
): value is Pick<AthenaClient, "withContext"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { withContext?: unknown }).withContext === "function"
  );
}

/**
 * Request-scoped Next server faÃ§ade over {@link createClient}.
 *
 * Resolves cookies, bearer tokens, optional session/`scope` identity, and cache
 * policy on every invocation, merges with any application-level context, then
 * materializes the client through the singular `createClient` primitive.
 *
 * Does not cache clients. Call once per Server Component / Server Action /
 * Route Handler request (or pass explicit requestHeaders/requestCookies).
 *
 * Prefer `session` and/or `scope` for identity headers instead of a follow-up
 * `withContext({})` that drops org/user fields.
 */
export async function createAthenaServerClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  options: AthenaServerClientConfig<TModels>
): Promise<AthenaRequestClient<AthenaClient<TModels>>> {
  const {
    requestHeaders,
    requestCookies,
    forceNoCache,
    session,
    scope,
    headers: requestScopedHeaders,
    ...clientConfig
  } = options;

  if (
    !isAthenaClientInstance((options as { client?: unknown }).client) &&
    "databaseUrl" in options &&
    !isNodeProductionEnv()
  ) {
    console.warn(
      "[athena] createAthenaServerClient({ databaseUrl }) constructs a request façade, not the process root. " +
        "Create the root with createClient({ databaseUrl }) from @xylex-group/athena/server and pass { client: root }."
    );
  }

  if (isAthenaClientInstance((options as { client?: unknown }).client)) {
    const resolved = await resolveAthenaServerContext({
      forceNoCache,
      headers: requestScopedHeaders,
      requestCookies,
      requestHeaders,
      scope,
      session,
    });
    // Default layered client is unparameterized; TModels overlap fails
    // (withTransaction contravariance) and can recurse (TS2589).
    return (options as AthenaLayeredServerConfig).client.withContext(
      resolved.request
    ) as unknown as AthenaRequestClient<AthenaClient<TModels>>;
  }

  const resolved = await resolveAthenaServerContext({
    forceNoCache,
    headers: requestScopedHeaders,
    requestCookies,
    requestHeaders,
    scope,
    session,
  });

  const configuredContext =
    "context" in clientConfig ? clientConfig.context : undefined;

  // Avoid evaluating createClient generics during dts emit (TS2589).
  const config = {
    ...(clientConfig as AthenaClientConfig<TModels>),
    context: async () => {
      const configured =
        typeof configuredContext === "function"
          ? await configuredContext()
          : configuredContext;
      return mergeAthenaRequestContexts(configured, resolved.request);
    },
  };
  const factory = createClient as unknown as (
    c: AthenaClientConfig<TModels>
  ) => AthenaClient<TModels>;
  // Unique-symbol brand is compile-time only; the constructed client has no
  // runtime field that overlaps AthenaRequestClientBrand.
  return factory(config as AthenaClientConfig<TModels>) as unknown as AthenaRequestClient<
    AthenaClient<TModels>
  >;
}

export type {
  AthenaRequestClient,
  AthenaRequestClientBrand,
  AthenaRootClient,
  AthenaRootClientBrand,
} from "../client-brands.ts";
export {
  AthenaRuntimeOwnershipError,
  getAthenaRuntimeDiagnostics,
} from "../runtime/client-internals.ts";
export type { AthenaRuntimeDiagnostics } from "../runtime/client-internals.ts";
export {
  type AthenaDataHandlers,
  type AthenaNextHandlers,
  type AthenaRootClientForHandlers,
  type CreateAthenaDataHandlersConfig,
  type CreateAthenaDataHandlersFromClient,
  type CreateAthenaNextHandlersConfig,
  createAthenaDataHandlers,
  createAthenaNextHandlers,
} from "./data-handlers.ts";
export {
  type AthenaAuthProxyFromClientOptions,
  type AthenaAuthProxyHandlersOptions,
  type AthenaAuthProxyOptions,
  type AthenaAuthProxyTransportOptions,
  athenaAuthHandlers,
  createAthenaAuthHandlers,
  createAthenaAuthProxyHandlers,
} from "./auth-proxy.ts";
export {
  hasAuthSessionCookie,
  SESSION_COOKIE_PATTERNS,
} from "../cookies/session-cookie-detection.ts";
export {
  type ActiveOrganizationSessionLike,
  type EnsureActiveOrganizationOptions,
  type EnsureActiveOrganizationResult,
  ensureActiveOrganization,
  type OrganizationLike,
} from "../organization/ensure-active-organization.ts";
/**
 * Table schema catalog route helpers for App Router handlers such as
 * `app/api/tables/schema/route.ts`.
 */
export {
  ATHENA_TABLE_SCHEMA_ROUTE,
  type AthenaTableCatalogColumn,
  type AthenaTableCatalogQueryClient,
  type AthenaTableCatalogRelation,
  type AthenaTableCatalogResponse,
  type AthenaTableCatalogTable,
  type AthenaTableSchemaConfig,
  type AthenaTableSchemaHandlerOptions,
  type AthenaTableShowcaseConfig,
  buildAthenaTableCatalogQueries,
  createAthenaTableSchemaHandlers,
  type FetchAthenaTableCatalogOptions,
  fetchAthenaTableCatalog,
  fetchTableCatalog,
  handleAthenaTableSchemaPost,
  hasAthenaTableSchemaCredentials,
  isAthenaTableSchemaConfig,
  parseAthenaTableSchemaScope,
  type TableCatalogColumn,
  type TableCatalogRelation,
  type TableCatalogResponse,
  type TableCatalogTable,
} from "../tables/index.ts";
/**
 * Server-side auth URL / session helpers commonly used in RSC, middleware,
 * and Route Handlers. Re-exported so Next apps can import from one entry.
 */
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
  ResolvedRequestHeaderOverrides,
} from "../utils/athena-request-headers.ts";
export {
  applyAthenaApiKeyHeaders,
  applyAthenaAuthContextHeaders,
  applyAthenaPgUriHeaders,
  buildAthenaGatewayHeaders,
  buildAthenaRequestHeaders,
  buildServiceRequestHeaders,
  hasHeaderIgnoreCase,
  resolveHeaderValue,
  resolveRequestHeaderOverrides,
} from "../utils/athena-request-headers.ts";

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
export { proxyRequestHeaders } from "../utils/proxy-request-headers.ts";
export {
  type GetOriginFromHeadersOptions,
  getOriginFromHeaders,
  isDynamicServerUsageError,
} from "../utils/request-origin.ts";
export { readEnv, requireEnv } from "../utils/require-env.ts";
export type {
  AthenaSessionData,
  ToSessionDataOptions,
} from "../auth/session-data.ts";
export { toSessionData } from "../auth/session-data.ts";
export type {
  AthenaSessionErrorCode,
  AthenaSessionErrorContext,
  ToAthenaSessionErrorKind,
} from "../auth/session-errors.ts";
export {
  AthenaAuthConfigurationError,
  AthenaAuthProtocolError,
  AthenaAuthUpstreamError,
  AthenaSessionError,
  AthenaSessionOrganizationError,
  AthenaUnauthenticatedError,
  isAbortError,
  toAthenaSessionError,
} from "../auth/session-errors.ts";
export type { DerivedSessionView } from "../auth/session-view.ts";
export { deriveSessionView } from "../auth/session-view.ts";
export {
  type EnsureActiveConfig,
  type EnsureActiveStrategy,
  type GetServerSessionEnsureActiveOptions,
  type GetServerSessionOptions,
  type GetServerSessionResult,
  getServerSession,
  getServerSessionOrNull,
  type OrganizationResolution,
  type ParseSessionDataHeaderResult,
  parseAthenaSessionDataHeader,
  parseAthenaSessionDataHeaderResult,
  classifyGetSessionPayload,
  mapGetServerSessionOrNull,
  mapRequireServerSession,
  throwFromServerSessionResult,
  SESSION_ERROR_HINT,
  type RequireServerSessionOptions,
  requireServerSession,
  type ResolveActiveOrganizationIdArgs,
  type ServerSessionClientLike,
  type ServerSessionMeta,
} from "./get-server-session.ts";
export {
  type CreateServerSessionResolverConfig,
  createServerSessionResolver,
  type ServerSessionCacheMode,
  type ServerSessionResolver,
} from "./server-session-resolver.ts";
export {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  ATHENA_AUTH_SESSION_COOKIE_NAMES,
  type AthenaAuthSessionBridgeClientOptions,
  type AthenaAuthSessionBridgeOptions,
  type AthenaAuthSessionBridgePathOptions,
  type AthenaAuthSessionBridgePayload,
  type AthenaAuthSessionBridgeSource,
  clearAthenaAuthSessionOnAppHost,
  createAthenaAuthSessionBridgeHandlers,
  createAthenaAuthSessionBridgePathHandlers,
  handleAthenaAuthSessionBridgeDelete,
  handleAthenaAuthSessionBridgePost,
  isAthenaAuthSessionBridgePath,
  persistAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
} from "./session-bridge/index.ts";
export {
  type AthenaRequestCookiesBag,
  type AthenaRequestCookiesInput,
  type AthenaRequestHeadersBag,
  type AthenaRequestHeadersInput,
  type AthenaServerRequestOptions,
  resolveNextRequestContext,
} from "./shared.ts";
