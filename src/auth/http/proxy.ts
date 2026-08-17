/**
 * Same-origin Athena Auth HTTP proxy (framework-agnostic).
 *
 * Next.js App Router is one consumer; the implementation is not a Next adapter.
 *
 * Prefer:
 *   createAthenaAuthProxyHandlers({ client: athena })
 *
 * Advanced (no client — mutually exclusive):
 *   createAthenaAuthProxyHandlers({ upstreamUrl: "https://auth.example.com" })
 */

import { getAttachedAthenaAuthRouting } from "../resolve-routing.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";
import {
  ATHENA_AUTH_PATH,
  resolveAthenaAuthUpstreamUrl,
  type AthenaAuthUpstreamEnv,
} from "../../utils/athena-auth-url.ts";

/** Options for a single proxy hop (no client). */
export interface AthenaAuthProxyTransportOptions {
  fetchImplementation?: typeof fetch;
  /**
   * When true (default for handler factories), strip Domain and relax Secure/SameSite
   * for local http so the browser stores cookies on the app host.
   */
  rewriteSetCookiesToRequestOrigin?: boolean;
  /** Local route prefix to strip before appending to upstream (default `/api/auth`). */
  routePrefix?: string;
  /** Absolute upstream base (preferred explicit advanced form). */
  upstreamUrl?: string | AthenaAuthUpstreamEnv;
  /** Already-resolved upstream origin/base (advanced). */
  upstreamBaseUrl?: string;
}

/**
 * Preferred: derive upstream from a configured Athena client.
 * Do not pass upstreamUrl alongside client — dual authorities are rejected.
 */
export interface AthenaAuthProxyFromClientOptions {
  client: object;
  fetchImplementation?: typeof fetch;
  rewriteSetCookiesToRequestOrigin?: boolean;
  routePrefix?: string;
}

export type AthenaAuthProxyOptions =
  | AthenaAuthProxyFromClientOptions
  | AthenaAuthProxyTransportOptions;

type AthenaAuthProxyHandler = (request: Request) => Promise<Response>;

type HeadersWithGetSetCookie = Headers & {
  getSetCookie?: () => string[];
};

const ATHENA_AUTH_SESSION_COOKIE_NAMES = [
  "athena-auth.session_token",
  "athena-auth.session-token",
] as const;

const STRIP_PROXY_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/g, "");
}

function isLocalProxyHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRoutePrefix(pathname: string, routePrefix: string) {
  const normalizedPrefix = stripTrailingSlashes(routePrefix.trim()) || "/";
  const prefixPattern = new RegExp(`^${escapeRegex(normalizedPrefix)}\\/?`);
  return pathname.replace(prefixPattern, "").replace(/^\/+/, "");
}

function isFromClientOptions(
  options: AthenaAuthProxyOptions
): options is AthenaAuthProxyFromClientOptions {
  return (
    typeof options === "object" &&
    options !== null &&
    "client" in options &&
    (options as AthenaAuthProxyFromClientOptions).client != null
  );
}

/**
 * Resolve proxy upstream base. Enforces mutual exclusion of client vs explicit upstream.
 */
export function resolveAthenaAuthProxyUpstreamBaseUrl(
  options: AthenaAuthProxyOptions = {}
): string {
  if (isFromClientOptions(options)) {
    if (
      "upstreamUrl" in options ||
      "upstreamBaseUrl" in options
    ) {
      const transport = options as AthenaAuthProxyFromClientOptions &
        AthenaAuthProxyTransportOptions;
      if (
        transport.upstreamBaseUrl?.trim() ||
        (typeof transport.upstreamUrl === "string"
          ? transport.upstreamUrl.trim()
          : transport.upstreamUrl)
      ) {
        throw new AthenaConfigurationError(
          "ATHENA_AUTH_PROXY_CONFIGURATION_INVALID",
          "createAthenaAuthProxyHandlers accepts either { client } or { upstreamUrl }, not both. " +
            "Configure upstream on the Athena client (auth.upstreamUrl / env) and pass only { client }.",
          "auth"
        );
      }
    }

    const routing = getAttachedAthenaAuthRouting(options.client);
    if (routing?.proxyUpstreamBaseUrl) {
      return stripTrailingSlashes(routing.proxyUpstreamBaseUrl);
    }
    // Prefer fail-closed: client is the authority. Do not silently proxy to the
    // hosted default when same-origin was chosen without an upstream.
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_UPSTREAM_REQUIRED",
      "createAthenaAuthProxyHandlers({ client }) needs a proxy upstream on the client. " +
        'Configure auth: { routing: "same-origin", upstreamUrl: "https://auth.example.com" } ' +
        "or set ATHENA_AUTH_UPSTREAM_URL (or aliases) before createClient.",
      "auth"
    );
  }

  const transport = options;
  if (transport.upstreamBaseUrl?.trim()) {
    return stripTrailingSlashes(transport.upstreamBaseUrl.trim());
  }
  if (
    transport.upstreamUrl !== undefined &&
    transport.upstreamUrl !== null &&
    !(typeof transport.upstreamUrl === "string" && !transport.upstreamUrl.trim())
  ) {
    return stripTrailingSlashes(
      resolveAthenaAuthUpstreamUrl(transport.upstreamUrl)
    );
  }
  // Empty advanced options: env + hosted default (scaffold DX).
  return stripTrailingSlashes(resolveAthenaAuthUpstreamUrl());
}

/** Decode a single cookie value; returns the raw string if decoding fails. */
export function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Read one named cookie from a `Cookie` header string.
 * Values are URI-decoded when possible.
 */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = cookie.slice(0, separatorIndex).trim();
    if (cookieName !== name) {
      continue;
    }

    return decodeCookieValue(cookie.slice(separatorIndex + 1).trim());
  }

  return undefined;
}

/** Convenience: read a cookie from a `Request`'s `cookie` header. */
export function readCookieValueFromRequest(request: Request, name: string) {
  return readCookieValue(request.headers.get("cookie"), name);
}

function readAthenaAuthSessionTokenCookie(
  cookieHeader: string | null | undefined
): string | undefined {
  for (const cookieName of ATHENA_AUTH_SESSION_COOKIE_NAMES) {
    const value = readCookieValue(cookieHeader, cookieName);
    const trimmedValue = value?.trim();

    if (trimmedValue) {
      return trimmedValue;
    }
  }
  return undefined;
}

function applySessionCookieAuthorizationHeader(headers: Headers) {
  if (headers.has("authorization")) {
    return;
  }

  const sessionToken = readAthenaAuthSessionTokenCookie(headers.get("cookie"));

  if (sessionToken) {
    headers.set("authorization", `Bearer ${sessionToken}`);
  }
}

function rewriteSetCookieForRequestOrigin(cookie: string, requestUrl: URL) {
  const parts = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return cookie;
  }

  const rewrittenParts = [parts[0]];
  const isInsecureLocalRequest =
    requestUrl.protocol === "http:" &&
    isLocalProxyHostname(requestUrl.hostname);

  for (const part of parts.slice(1)) {
    const separatorIndex = part.indexOf("=");
    const attributeName =
      separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    const attributeValue =
      separatorIndex === -1 ? "" : part.slice(separatorIndex + 1);
    const normalizedAttributeName = attributeName.trim().toLowerCase();

    if (normalizedAttributeName === "domain") {
      continue;
    }

    if (isInsecureLocalRequest && normalizedAttributeName === "secure") {
      continue;
    }

    if (
      isInsecureLocalRequest &&
      normalizedAttributeName === "samesite" &&
      attributeValue.trim().toLowerCase() === "none"
    ) {
      rewrittenParts.push("SameSite=Lax");
      continue;
    }

    rewrittenParts.push(part);
  }

  return rewrittenParts.join("; ");
}

function buildProxyResponseHeaders(
  source: Headers,
  requestUrl: URL,
  rewriteSetCookiesToRequestOrigin: boolean
) {
  const headers = new Headers();

  // Avoid Headers.entries() — not present on all DOM lib typings used by fixture tsc.
  source.forEach((value, key) => {
    if (STRIP_PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) {
      return;
    }
    headers.set(key, value);
  });

  const getSetCookie = (source as HeadersWithGetSetCookie).getSetCookie;
  const setCookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(source as HeadersWithGetSetCookie)
      : [];

  if (setCookies.length > 0) {
    for (const cookie of setCookies) {
      headers.append(
        "set-cookie",
        rewriteSetCookiesToRequestOrigin
          ? rewriteSetCookieForRequestOrigin(cookie, requestUrl)
          : cookie
      );
    }
  } else {
    const setCookie = source.get("set-cookie");
    if (setCookie) {
      headers.append(
        "set-cookie",
        rewriteSetCookiesToRequestOrigin
          ? rewriteSetCookieForRequestOrigin(setCookie, requestUrl)
          : setCookie
      );
    }
  }

  return headers;
}

function resolveRewriteFlag(options: AthenaAuthProxyOptions): boolean {
  if (isFromClientOptions(options)) {
    return options.rewriteSetCookiesToRequestOrigin ?? true;
  }
  return options.rewriteSetCookiesToRequestOrigin ?? true;
}

function resolveRoutePrefix(options: AthenaAuthProxyOptions): string {
  if (isFromClientOptions(options)) {
    return options.routePrefix ?? ATHENA_AUTH_PATH;
  }
  return options.routePrefix ?? ATHENA_AUTH_PATH;
}

function resolveFetch(options: AthenaAuthProxyOptions): typeof fetch {
  if (isFromClientOptions(options)) {
    return options.fetchImplementation ?? fetch;
  }
  return options.fetchImplementation ?? fetch;
}

/** Proxies one incoming request to the Athena Auth upstream and normalizes browser-facing headers. */
export async function proxyAthenaAuthRequest(
  request: Request,
  options: AthenaAuthProxyOptions = {}
) {
  const url = new URL(request.url);
  const upstreamBaseUrl = resolveAthenaAuthProxyUpstreamBaseUrl(options);
  const routePrefix = resolveRoutePrefix(options);
  const rewrite = resolveRewriteFlag(options);
  const pathname = stripRoutePrefix(url.pathname, routePrefix);
  const targetBase = `${stripTrailingSlashes(upstreamBaseUrl)}/`;
  const targetPathWithQuery = pathname
    ? `${pathname}${url.search}`
    : url.search;
  const target = new URL(targetPathWithQuery || "", targetBase);
  const headers = new Headers(request.headers);
  const fetchImplementation = resolveFetch(options);
  headers.delete("host");
  // Prevent compressed upstream bodies from being mis-forwarded as decoded JSON
  // (Formations / PR #337 class regression). Always request identity encoding.
  headers.set("accept-encoding", "identity");
  applySessionCookieAuthorizationHeader(headers);

  const canHaveBody = request.method !== "GET" && request.method !== "HEAD";
  const body = canHaveBody ? await request.text() : undefined;

  try {
    const upstreamResponse = await fetchImplementation(target, {
      body,
      headers,
      method: request.method,
    });

    return new Response(upstreamResponse.body, {
      headers: buildProxyResponseHeaders(
        upstreamResponse.headers,
        url,
        rewrite
      ),
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown upstream proxy error";
    return new Response(
      JSON.stringify({
        error: "Athena auth proxy request failed",
        message,
        target: target.toString(),
        upstream: upstreamBaseUrl,
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 502,
      }
    );
  }
}

/**
 * Static options, preferred `{ client }`, advanced `{ upstreamUrl }`, or per-request resolver.
 *
 * Prefer the client form so upstream is a single authority on the Athena client.
 */
export type AthenaAuthProxyHandlersOptions =
  | AthenaAuthProxyFromClientOptions
  | AthenaAuthProxyTransportOptions
  | ((
      request: Request
    ) =>
      | AthenaAuthProxyFromClientOptions
      | AthenaAuthProxyTransportOptions
      | Promise<
          AthenaAuthProxyFromClientOptions | AthenaAuthProxyTransportOptions
        >);

/**
 * Creates HTTP method handlers for Next.js route modules that proxy Athena Auth.
 *
 * @example
 * ```ts
 * // Preferred — upstream from createClient({ auth: { routing: "same-origin", ... } })
 * export const { DELETE, GET, HEAD, PATCH, POST, PUT } =
 *   createAthenaAuthProxyHandlers({ client: athena })
 * ```
 *
 * @example
 * ```ts
 * // Advanced — no client
 * export const { GET, POST, ... } = createAthenaAuthProxyHandlers({
 *   rewriteSetCookiesToRequestOrigin: true,
 *   upstreamUrl: process.env.ATHENA_AUTH_UPSTREAM_URL,
 * })
 * ```
 */
export function createAthenaAuthProxyHandlers(
  options: AthenaAuthProxyHandlersOptions = {}
) {
  // Eager validation for static preferred/advanced forms (not function resolvers).
  if (typeof options !== "function") {
    resolveAthenaAuthProxyUpstreamBaseUrl(options);
  }

  const handle: AthenaAuthProxyHandler = async (request) => {
    const resolved =
      typeof options === "function" ? await options(request) : options;
    return proxyAthenaAuthRequest(request, resolved);
  };

  return {
    DELETE: handle,
    GET: handle,
    HEAD: handle,
    PATCH: handle,
    POST: handle,
    PUT: handle,
  };
}

/**
 * Advanced Next.js App Router auth proxy handlers (client XOR upstreamUrl).
 * Prefer {@link createAthenaAuthHandlers} for the happy path.
 */
export const athenaAuthHandlers = createAthenaAuthProxyHandlers;

/**
 * Opinionated same-origin auth proxy: upstream is derived **only** from the
 * supplied Athena client. Dual-authority upstream overrides are rejected.
 *
 * @example
 * ```ts
 * export const { DELETE, GET, HEAD, PATCH, POST, PUT } =
 *   createAthenaAuthHandlers(athena)
 * ```
 */
export function createAthenaAuthHandlers(
  client: object,
  extras?: Omit<
    AthenaAuthProxyFromClientOptions,
    "client" | "upstreamUrl" | "upstreamBaseUrl"
  >
) {
  const localHandlers = (
    client as {
      auth?: { server?: { handlers?: Record<string, (request: Request) => Promise<Response>> } };
    }
  ).auth?.server?.handlers;
  if (localHandlers?.GET && localHandlers.POST) {
    return localHandlers;
  }

  if (
    extras &&
    ("upstreamUrl" in extras || "upstreamBaseUrl" in extras)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_PROXY_CONFIGURATION_INVALID",
      "createAthenaAuthHandlers(client) derives upstream solely from the client. " +
        "Do not pass upstreamUrl. Use createAthenaAuthProxyHandlers for advanced transport.",
      "auth"
    );
  }

  return createAthenaAuthProxyHandlers({
    ...(extras ?? {}),
    client,
  });
}
