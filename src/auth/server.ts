import {
  type AthenaAuthCookies,
  type AthenaCookieContextRuntime,
  type AthenaCookieOptions,
  type AthenaCookiesOptions,
  deleteSessionCookie,
  getCookieCache,
  getCookies,
  getSessionCookie,
  parseCookies,
  setSessionCookie,
} from "../cookies/index.ts";
import type { AthenaSessionPair } from "../cookies/types.ts";
import type { AuthSocialProvider } from "./types.ts";

type AthenaMaybePromise<T> = T | Promise<T>;
type AthenaAuthServerCookieOptions = Pick<
  AthenaCookiesOptions,
  "session" | "advanced"
>;

const DEFAULT_AUTH_BASE_PATH = "/api/auth";

export const ATHENA_AUTH_BASE_ERROR_CODES = {
  HANDLER_NOT_CONFIGURED: "HANDLER_NOT_CONFIGURED",
  INVALID_BASE_URL: "INVALID_BASE_URL",
  UNTRUSTED_HOST: "UNTRUSTED_HOST",
} as const;

export interface AthenaAuthSocialProviderConfig {
  clientId: string;
  clientSecret: string;
  scope?: string[];
  [key: string]: unknown;
}

export interface AthenaAuthPluginContext {
  context: {
    returned?: unknown;
    responseHeaders?: Headers;
    setSession?: AthenaSessionPair | null;
    clearSession?: boolean;
    dontRememberMe?: boolean;
    cookieOverrides?: Partial<AthenaCookieOptions>;
    [key: string]: unknown;
  };
  headers?: Headers;
  path?: string;
}

export interface AthenaAuthPluginHandlerContext
  extends AthenaAuthPluginContext {
  auth: AthenaAuthServer;
}

export interface AthenaAuthPlugin {
  $ERROR_CODES?: Record<string, string>;
  hooks?: {
    after?: Array<{
      matcher: (ctx: AthenaAuthPluginContext) => boolean;
      handler: (ctx: AthenaAuthPluginHandlerContext) => Promise<void> | void;
    }>;
  };
  id: string;
  version: string;
}

export interface AthenaAuthCookieRuntimeInput {
  cookies?: AthenaAuthCookies;
  getCookie?: (name: string) => string | null | undefined;
  getSignedCookie?: AthenaCookieContextRuntime["getSignedCookie"];
  headers?: Headers;
  logger?: AthenaCookieContextRuntime["logger"];
  responseHeaders?: Headers;
  setCookie?: (
    name: string,
    value: string,
    attributes: AthenaCookieOptions
  ) => void;
  setNewSession?: AthenaCookieContextRuntime["context"]["setNewSession"];
  setSignedCookie?: AthenaCookieContextRuntime["setSignedCookie"];
}

export interface AthenaAuthServerRuntimeOptions {
  basePath: string;
  baseURL?: string;
  cookies: AthenaAuthServerCookieOptions;
  secret: string;
}

export type AthenaAuthDatabaseFactory<TDatabase = unknown> = (
  options: AthenaAuthServerRuntimeOptions
) => TDatabase;

export type AthenaAuthBaseURLConfig = AthenaCookiesOptions["baseURL"];

export type AthenaAuthTrustedOrigins =
  | string[]
  | ((request?: Request) => AthenaMaybePromise<string[]>);

export type AthenaAuthTrustedProviders =
  | string[]
  | ((request?: Request) => AthenaMaybePromise<string[]>);

export interface AthenaAuthHandlerResult {
  clearSession?: boolean;
  cookieOverrides?: Partial<AthenaCookieOptions>;
  dontRememberMe?: boolean;
  response?: Response;
  returned?: unknown;
  setSession?: AthenaSessionPair | null;
}

export interface AthenaAuthServerConfig<TDatabase = unknown>
  extends AthenaAuthServerCookieOptions {
  api?: Record<string, unknown>;
  basePath?: string;
  baseURL?: AthenaAuthBaseURLConfig;
  database: TDatabase | AthenaAuthDatabaseFactory<TDatabase>;
  errorCodes?: Record<string, string>;
  handler?: (
    ctx: AthenaAuthRequestContext
  ) => AthenaMaybePromise<Response | AthenaAuthHandlerResult>;
  plugins?: AthenaAuthPlugin[];
  secret: string;
  socialProviders?: Partial<
    Record<AuthSocialProvider, AthenaAuthSocialProviderConfig>
  >;
  trustedOrigins?: AthenaAuthTrustedOrigins;
  trustedProviders?: AthenaAuthTrustedProviders;
}

type ResolveAthenaAuthDatabase<TConfig extends AthenaAuthServerConfig> =
  TConfig["database"] extends (...args: never[]) => infer TResult
    ? TResult
    : TConfig["database"];

export interface AthenaAuthRequestContext<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  auth: AthenaAuthServer<TConfig>;
  basePath: string;
  baseURL: string;
  cookies: AthenaAuthCookies;
  database: ResolveAthenaAuthDatabase<TConfig>;
  headers: Headers;
  options: TConfig;
  origin: string;
  path: string;
  request: Request;
  runtime: AthenaAuthServerRuntimeOptions;
  socialProviders: NonNullable<TConfig["socialProviders"]>;
  trustedOrigins: string[];
  trustedProviders: string[];
  url: URL;
}

export interface AthenaAuthContext<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  auth: AthenaAuthServer<TConfig>;
  basePath: string;
  baseURL?: string;
  cookies: AthenaAuthCookies;
  database: ResolveAthenaAuthDatabase<TConfig>;
  options: TConfig;
  origin?: string;
  plugins: AthenaAuthPlugin[];
  runtime: AthenaAuthServerRuntimeOptions;
  socialProviders: NonNullable<TConfig["socialProviders"]>;
  trustedOrigins: string[];
  trustedProviders: string[];
}

export interface AthenaAuthServerApi<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  applyResponseCookies: AthenaAuthServer<TConfig>["applyResponseCookies"];
  clearSession: AthenaAuthServer<TConfig>["clearSession"];
  createCookieContext: AthenaAuthServer<TConfig>["createCookieContext"];
  getCookieCache: typeof getCookieCache;
  getSessionCookie: typeof getSessionCookie;
  resolveRequestContext: AthenaAuthServer<TConfig>["resolveRequestContext"];
  runAfterHooks: AthenaAuthServer<TConfig>["runAfterHooks"];
  setSession: AthenaAuthServer<TConfig>["setSession"];
}

export interface AthenaAuthServer<
  TConfig extends AthenaAuthServerConfig = AthenaAuthServerConfig,
> {
  $context: Promise<AthenaAuthContext<TConfig>>;
  $ERROR_CODES: Record<string, string>;
  api: AthenaAuthServerApi<TConfig> & Record<string, unknown>;
  applyResponseCookies: (ctx: AthenaAuthPluginContext) => Promise<Headers>;
  clearSession: (
    input?: AthenaAuthCookieRuntimeInput,
    skipDontRememberMe?: boolean
  ) => void;
  config: TConfig;
  cookies: AthenaAuthCookies;
  createCookieContext: (
    input?: AthenaAuthCookieRuntimeInput
  ) => AthenaCookieContextRuntime;
  database: ResolveAthenaAuthDatabase<TConfig>;
  handler: (request: Request) => Promise<Response>;
  options: TConfig;
  plugins: AthenaAuthPlugin[];
  resolveRequestContext: (
    request: Request
  ) => Promise<AthenaAuthRequestContext<TConfig>>;
  runAfterHooks: (
    ctx: AthenaAuthPluginContext
  ) => Promise<AthenaAuthPluginContext>;
  runtime: AthenaAuthServerRuntimeOptions;
  setSession: (
    input: AthenaAuthCookieRuntimeInput | undefined,
    session: AthenaSessionPair,
    dontRememberMe?: boolean,
    overrides?: Partial<AthenaCookieOptions>
  ) => Promise<void>;
  socialProviders: NonNullable<TConfig["socialProviders"]>;
}

function capitalize(value: string): string {
  return value.length > 0
    ? `${value[0]?.toUpperCase()}${value.slice(1)}`
    : value;
}

function serializeSetCookieValue(
  name: string,
  value: string,
  attributes: AthenaCookieOptions
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  const knownKeys = new Set([
    "maxAge",
    "expires",
    "domain",
    "path",
    "secure",
    "httpOnly",
    "partitioned",
    "sameSite",
  ]);

  if (attributes.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(attributes.maxAge)}`);
  }
  if (attributes.expires instanceof Date) {
    parts.push(`Expires=${attributes.expires.toUTCString()}`);
  }
  if (attributes.domain) {
    parts.push(`Domain=${attributes.domain}`);
  }
  if (attributes.path) {
    parts.push(`Path=${attributes.path}`);
  }
  if (attributes.secure) {
    parts.push("Secure");
  }
  if (attributes.httpOnly) {
    parts.push("HttpOnly");
  }
  if (attributes.partitioned) {
    parts.push("Partitioned");
  }
  if (attributes.sameSite) {
    parts.push(`SameSite=${capitalize(attributes.sameSite)}`);
  }

  for (const [key, rawValue] of Object.entries(attributes)) {
    if (
      knownKeys.has(key) ||
      rawValue === undefined ||
      rawValue === null ||
      rawValue === false
    ) {
      continue;
    }
    if (rawValue === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}=${String(rawValue)}`);
  }

  return parts.join("; ");
}

function readCookieFromHeaders(
  headers: Headers | undefined,
  name: string
): string | undefined {
  const cookieHeader = headers?.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }
  return parseCookies(cookieHeader).get(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveSessionCandidate(value: unknown): AthenaSessionPair | null {
  if (!isRecord(value)) {
    return null;
  }

  const session = isRecord(value.session) ? value.session : undefined;
  const user = isRecord(value.user) ? value.user : undefined;
  if (
    session &&
    typeof session.token === "string" &&
    session.token.length > 0 &&
    user
  ) {
    return {
      session: session as Record<string, unknown> & { token: string },
      user: user as Record<string, unknown>,
    };
  }

  return null;
}

function inferSessionPair(returned: unknown): AthenaSessionPair | null {
  return (
    resolveSessionCandidate(returned) ??
    (isRecord(returned) ? resolveSessionCandidate(returned.data) : null) ??
    (isRecord(returned) ? resolveSessionCandidate(returned.session) : null)
  );
}

function resolveResponseHeaders(ctx: AthenaAuthPluginContext): Headers {
  if (ctx.context.responseHeaders instanceof Headers) {
    return ctx.context.responseHeaders;
  }

  const headers = new Headers();
  ctx.context.responseHeaders = headers;
  return headers;
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/$/, "");
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") {
    return DEFAULT_AUTH_BASE_PATH;
  }

  const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
}

function isDynamicBaseURLConfig(
  baseURL: AthenaAuthBaseURLConfig | undefined
): baseURL is Exclude<AthenaAuthBaseURLConfig, string | undefined> {
  return (
    typeof baseURL === "object" &&
    baseURL !== null &&
    "allowedHosts" in baseURL &&
    Array.isArray((baseURL as { allowedHosts?: unknown }).allowedHosts)
  );
}

function getRequestUrl(request: Request): URL {
  try {
    return new URL(request.url);
  } catch {
    return new URL("http://localhost");
  }
}

function getRequestHost(request: Request, url: URL): string | null {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  return host || null;
}

function getRequestProtocol(
  request: Request,
  configuredProtocol: "http" | "https" | "auto" | undefined,
  url: URL
): "http" | "https" {
  if (configuredProtocol === "http" || configuredProtocol === "https") {
    return configuredProtocol;
  }

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedProto === "http" || forwardedProto === "https") {
    return forwardedProto;
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.protocol.slice(0, -1) as "http" | "https";
  }

  return "http";
}

function resolveRequestBaseURL(
  baseURL: AthenaAuthBaseURLConfig | undefined,
  request: Request
): string | null {
  if (typeof baseURL === "string") {
    return normalizeBaseURL(baseURL);
  }

  const requestUrl = getRequestUrl(request);
  const host = getRequestHost(request, requestUrl);
  if (!host) {
    return null;
  }

  if (isDynamicBaseURLConfig(baseURL)) {
    const allowedHosts = baseURL.allowedHosts ?? [];
    if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
      return null;
    }
  }

  const protocol =
    typeof baseURL === "object" && baseURL !== null
      ? getRequestProtocol(request, baseURL.protocol, requestUrl)
      : getRequestProtocol(request, undefined, requestUrl);

  return `${protocol}://${host}`;
}

function getOrigin(baseURL: string | undefined): string | undefined {
  if (!baseURL) {
    return undefined;
  }

  try {
    return new URL(baseURL).origin;
  } catch {
    // Invalid baseURL is treated as no origin.
  }
  return undefined;
}

async function resolveTrustedOrigins(
  config: AthenaAuthServerConfig,
  baseURL: string | undefined,
  request?: Request
): Promise<string[]> {
  const resolved =
    typeof config.trustedOrigins === "function"
      ? await config.trustedOrigins(request)
      : (config.trustedOrigins ?? []);

  const values = [getOrigin(baseURL), ...resolved];

  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
    )
  );
}

async function resolveTrustedProviders(
  config: AthenaAuthServerConfig,
  request?: Request
): Promise<string[]> {
  const configured =
    typeof config.trustedProviders === "function"
      ? await config.trustedProviders(request)
      : (config.trustedProviders ?? []);

  const values = [...Object.keys(config.socialProviders ?? {}), ...configured];

  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
    )
  );
}

function createJsonResponse(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

function mergeResponseHeaders(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function defineAthenaAuthConfig<TConfig extends AthenaAuthServerConfig>(
  config: TConfig
): TConfig {
  return config;
}

export function athenaAuth<TConfig extends AthenaAuthServerConfig>(
  config: TConfig
): AthenaAuthServer<TConfig> {
  const normalizedBasePath = normalizeBasePath(config.basePath);
  const staticBaseURL =
    typeof config.baseURL === "string"
      ? normalizeBaseURL(config.baseURL)
      : undefined;
  const runtime: AthenaAuthServerRuntimeOptions = {
    basePath: normalizedBasePath,
    baseURL: staticBaseURL,
    cookies: {
      advanced: config.advanced,
      session: config.session,
    },
    secret: config.secret,
  };
  const resolvedDatabase = (
    typeof config.database === "function"
      ? config.database(runtime)
      : config.database
  ) as ResolveAthenaAuthDatabase<TConfig>;
  const cookies = getCookies({
    advanced: config.advanced,
    baseURL: staticBaseURL ?? config.baseURL,
    session: config.session,
  });

  const auth = {} as AthenaAuthServer<TConfig>;

  const createCookieContext: AthenaAuthServer<TConfig>["createCookieContext"] =
    (input = {}) => {
      const responseHeaders = input.responseHeaders ?? new Headers();
      const runtimeHeaders = input.headers;
      const authCookies = input.cookies ?? auth.cookies;

      const setCookie =
        input.setCookie ??
        ((name, value, attributes) => {
          responseHeaders.append(
            "set-cookie",
            serializeSetCookieValue(name, value, attributes)
          );
        });

      return {
        context: {
          authCookies,
          options: {
            account: {
              storeAccountCookie: true,
            },
            session: {
              cookieCache: config.session?.cookieCache,
            },
          },
          secret: runtime.secret,
          sessionConfig: {
            expiresIn: config.session?.expiresIn,
          },
          setNewSession: input.setNewSession,
        },
        getCookie:
          input.getCookie ??
          ((name) => readCookieFromHeaders(runtimeHeaders, name)),
        getSignedCookie: input.getSignedCookie,
        headers: runtimeHeaders,
        logger: input.logger,
        setCookie,
        setSignedCookie: input.setSignedCookie,
      };
    };

  const setSession: AthenaAuthServer<TConfig>["setSession"] = async (
    input,
    session,
    dontRememberMe,
    overrides
  ) => {
    const cookieContext = createCookieContext(input);
    await setSessionCookie(cookieContext, session, dontRememberMe, overrides);
  };

  const clearSession: AthenaAuthServer<TConfig>["clearSession"] = (
    input,
    skipDontRememberMe
  ) => {
    const cookieContext = createCookieContext(input);
    deleteSessionCookie(cookieContext, skipDontRememberMe);
  };

  const applyResponseCookies: AthenaAuthServer<TConfig>["applyResponseCookies"] =
    async (ctx) => {
      const responseHeaders = resolveResponseHeaders(ctx);
      const session =
        ctx.context.setSession ?? inferSessionPair(ctx.context.returned);

      if (ctx.context.clearSession) {
        clearSession({
          headers: ctx.headers,
          responseHeaders,
        });
      }

      if (session) {
        await setSession(
          {
            headers: ctx.headers,
            responseHeaders,
          },
          session,
          ctx.context.dontRememberMe,
          ctx.context.cookieOverrides
        );
      }

      return responseHeaders;
    };

  const runAfterHooks: AthenaAuthServer<TConfig>["runAfterHooks"] = async (
    ctx
  ) => {
    for (const plugin of auth.plugins) {
      for (const hook of plugin.hooks?.after ?? []) {
        if (!hook.matcher(ctx)) {
          continue;
        }
        await hook.handler({
          ...ctx,
          auth,
        });
      }
    }
    return ctx;
  };

  const resolveRequestContext: AthenaAuthServer<TConfig>["resolveRequestContext"] =
    async (request) => {
      const requestUrl = getRequestUrl(request);
      const resolvedBaseURL = resolveRequestBaseURL(config.baseURL, request);
      if (!resolvedBaseURL) {
        throw new Error(
          isDynamicBaseURLConfig(config.baseURL)
            ? "Could not resolve base URL from request. Check allowedHosts/baseURL."
            : "Could not resolve base URL from request."
        );
      }

      const requestCookies = getCookies({
        advanced: config.advanced,
        baseURL: resolvedBaseURL,
        session: config.session,
      });
      const trustedOrigins = await resolveTrustedOrigins(
        config,
        resolvedBaseURL,
        request
      );
      const trustedProviders = await resolveTrustedProviders(config, request);

      return {
        auth,
        basePath: normalizedBasePath,
        baseURL: resolvedBaseURL,
        cookies: requestCookies,
        database: auth.database,
        headers: request.headers,
        options: config,
        origin: getOrigin(resolvedBaseURL) ?? resolvedBaseURL,
        path: requestUrl.pathname,
        request,
        runtime: {
          ...runtime,
          baseURL: resolvedBaseURL,
        },
        socialProviders: auth.socialProviders,
        trustedOrigins,
        trustedProviders,
        url: requestUrl,
      };
    };

  const handler: AthenaAuthServer<TConfig>["handler"] = async (request) => {
    const requestContext = await resolveRequestContext(request);

    if (typeof config.handler !== "function") {
      return createJsonResponse(
        {
          basePath: requestContext.basePath,
          code: ATHENA_AUTH_BASE_ERROR_CODES.HANDLER_NOT_CONFIGURED,
          error:
            "No native auth handler was configured for this Athena auth instance.",
          ok: false,
          path: requestContext.path,
        },
        { status: 501 }
      );
    }

    const result = await config.handler(requestContext);
    if (result instanceof Response) {
      return result;
    }

    const response =
      result.response ??
      (result.returned === undefined
        ? new Response(null, { status: 204 })
        : createJsonResponse(result.returned));

    const responseHeaders = new Headers(response.headers);
    await runAfterHooks({
      context: {
        clearSession: result.clearSession,
        cookieOverrides: result.cookieOverrides,
        dontRememberMe: result.dontRememberMe,
        responseHeaders,
        returned: result.returned,
        setSession: result.setSession,
      },
      headers: request.headers,
      path: requestContext.path,
    });

    return mergeResponseHeaders(response, responseHeaders);
  };

  const api: AthenaAuthServer<TConfig>["api"] = Object.assign(
    {
      applyResponseCookies,
      clearSession,
      createCookieContext,
      getCookieCache,
      getSessionCookie,
      resolveRequestContext,
      runAfterHooks,
      setSession,
    } satisfies AthenaAuthServerApi<TConfig>,
    config.api ?? {}
  );

  const $ERROR_CODES = {
    ...auth.plugins?.reduce<Record<string, string>>((acc, plugin) => {
      if (plugin.$ERROR_CODES) {
        Object.assign(acc, plugin.$ERROR_CODES);
      }
      return acc;
    }, {}),
    ...(config.errorCodes ?? {}),
    ...ATHENA_AUTH_BASE_ERROR_CODES,
  };

  Object.assign(auth, {
    $ERROR_CODES,
    api,
    applyResponseCookies,
    clearSession,
    config,
    cookies,
    createCookieContext,
    database: resolvedDatabase,
    handler,
    options: config,
    plugins: [...(config.plugins ?? [])],
    resolveRequestContext,
    runAfterHooks,
    runtime,
    setSession,
    socialProviders: (config.socialProviders ?? {}) as NonNullable<
      TConfig["socialProviders"]
    >,
  } satisfies Omit<AthenaAuthServer<TConfig>, "$context">);

  auth.$context = Promise.all([
    resolveTrustedOrigins(config, staticBaseURL),
    resolveTrustedProviders(config),
  ]).then(([trustedOrigins, trustedProviders]) => ({
    auth,
    basePath: normalizedBasePath,
    baseURL: staticBaseURL,
    cookies: auth.cookies,
    database: auth.database,
    options: config,
    origin: getOrigin(staticBaseURL),
    plugins: auth.plugins,
    runtime,
    socialProviders: auth.socialProviders,
    trustedOrigins,
    trustedProviders,
  }));

  return auth;
}
