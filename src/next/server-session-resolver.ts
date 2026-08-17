import type { AthenaSessionData } from "../auth/session-data.ts";
import { toAthenaSessionError } from "../auth/session-errors.ts";
import {
  type GetServerSessionOptions,
  type GetServerSessionResult,
  type RequireServerSessionOptions,
  type ServerSessionClientLike,
  getServerSession,
  mapGetServerSessionOrNull,
  mapRequireServerSession,
} from "./get-server-session.ts";

export type ServerSessionCacheMode = "request" | "none";

export interface CreateServerSessionResolverConfig
  extends Omit<GetServerSessionOptions, "client"> {
  /**
   * Request-scoped dedupe via React `cache()` when `"request"`.
   * Default `"none"`. Prefer `"request"` in RSC apps.
   *
   * The cached callback always resolves options *inside* the cache scope so
   * request headers/cookies/client are never captured across requests.
   */
  cache?: ServerSessionCacheMode;
  client:
    | ServerSessionClientLike
    | (() => ServerSessionClientLike | Promise<ServerSessionClientLike>);
  /**
   * When `"next"` (default), omit explicit headers so `resolveNextRequestContext`
   * owns Next `headers()` / cookies. Pass `"none"` only with explicit inputs.
   */
  request?: "next" | "none";
  /**
   * Optional cache implementation (defaults to React.cache when available).
   * Injected for tests / non-React runtimes. Must be request-scoped by the host.
   */
  cacheImpl?: <T extends (...args: never[]) => unknown>(fn: T) => T;
  getRequestContext?: () => Promise<
    Pick<
      GetServerSessionOptions,
      "requestHeaders" | "requestCookies" | "appOrigin" | "headers"
    >
  >;
}

export interface ServerSessionResolver {
  getSession: (
    override?: Partial<GetServerSessionOptions>
  ) => Promise<GetServerSessionResult>;
  getSessionOrNull: (
    override?: Partial<GetServerSessionOptions>
  ) => Promise<AthenaSessionData | null>;
  requireSession: (
    override?: Partial<RequireServerSessionOptions>
  ) => Promise<AthenaSessionData>;
}

async function resolveClient(
  client: CreateServerSessionResolverConfig["client"]
): Promise<ServerSessionClientLike> {
  if (typeof client === "function") {
    return await client();
  }
  return client;
}

/**
 * Application binding for Next server session resolution.
 * Returns an ordinary object of bound helpers (not a callable).
 *
 * All helpers share one detailed-result authority (`getSession`) so
 * request-cache / in-flight work is not duplicated across OrNull/require.
 */
export function createServerSessionResolver(
  config: CreateServerSessionResolverConfig
): ServerSessionResolver {
  if (config.client == null) {
    throw toAthenaSessionError("configuration", {
      message: "createServerSessionResolver requires a client",
    });
  }

  const cacheMode = config.cache ?? "none";
  const requestMode = config.request ?? "next";

  const run = async (
    override: Partial<GetServerSessionOptions> = {}
  ): Promise<GetServerSessionOptions> => {
    const client = await resolveClient(config.client);
    const fromGetter = config.getRequestContext
      ? await config.getRequestContext()
      : {};

    const merged: GetServerSessionOptions = {
      appOrigin: config.appOrigin,
      authSessionUrl: config.authSessionUrl,
      ensureActiveOrganization: config.ensureActiveOrganization,
      fetchImpl: config.fetchImpl,
      forceNoCache: config.forceNoCache,
      headers: config.headers,
      organization: config.organization,
      resolveActiveOrganizationId: config.resolveActiveOrganizationId,
      sessionDataHeader: config.sessionDataHeader,
      skipFetchWithoutCredentials: config.skipFetchWithoutCredentials,
      requestCookies: config.requestCookies,
      requestHeaders: config.requestHeaders,
      ...fromGetter,
      ...override,
      client,
    };

    if (
      requestMode === "none" &&
      merged.requestHeaders === undefined &&
      merged.requestCookies === undefined &&
      merged.sessionDataHeader === undefined
    ) {
      merged.requestHeaders = {};
      merged.requestCookies = "";
    }

    return merged;
  };

  // React cache wrapper is created once per resolver, but must not close over
  // any request-derived promise — only call run() inside the cached fn.
  let cachedZeroArg: (() => Promise<GetServerSessionResult>) | null = null;
  let cacheInitAttempted = false;

  const ensureCachedZeroArg = async (): Promise<
    (() => Promise<GetServerSessionResult>) | null
  > => {
    if (cacheInitAttempted) {
      return cachedZeroArg;
    }
    cacheInitAttempted = true;
    try {
      let cacheFn = config.cacheImpl;
      if (typeof cacheFn !== "function") {
        const react = await import("react");
        cacheFn = (
          react as {
            cache?: <T extends (...args: never[]) => unknown>(fn: T) => T;
          }
        ).cache;
      }
      if (typeof cacheFn === "function") {
        cachedZeroArg = cacheFn(async () => {
          // Resolve options inside the cached callback only — never close over
          // a request-derived promise created outside cache scope.
          const base = await run();
          return getServerSession(base);
        });
      }
    } catch {
      cachedZeroArg = null;
    }
    return cachedZeroArg;
  };

  const getSessionImpl = async (
    override?: Partial<GetServerSessionOptions>
  ): Promise<GetServerSessionResult> => {
    const hasOverride = Boolean(override && Object.keys(override).length > 0);
    if (cacheMode === "request" && !hasOverride) {
      const cached = await ensureCachedZeroArg();
      if (cached) {
        return cached();
      }
    }
    const opts = await run(override);
    return getServerSession(opts);
  };

  return {
    getSession: getSessionImpl,
    getSessionOrNull: async (override) => {
      const result = await getSessionImpl(override);
      return mapGetServerSessionOrNull(result);
    },
    requireSession: async (override) => {
      const result = await getSessionImpl(override);
      return mapRequireServerSession(result, override ?? {});
    },
  };
}