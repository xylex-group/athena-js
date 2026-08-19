/**
 * Athena Auth routing policy (single authority).
 *
 * Dependency direction (do not invert):
 *   primitive URL helpers (athena-auth-url.ts)
 *           ↓
 *   this module (mode / upstream / browser base policy)
 *           ↓
 *   createClient / Next proxy / inspectAuth
 */

import type { AthenaAuthCredentials } from "./types.ts";
import { AthenaConfigurationError } from "../config/errors.ts";
import { isNodeProductionEnv } from "../node-env.ts";
import {
  ATHENA_AUTH_PATH,
  DEFAULT_ATHENA_AUTH_ORIGIN,
  isAbsoluteUrl,
  normalizeAthenaAuthBaseUrl,
  readAthenaAuthUpstreamUrlFromEnv,
  type EnvLike,
} from "../utils/athena-auth-url.ts";

export type AthenaAuthRoutingMode =
  | "same-origin"
  | "direct"
  | "custom"
  | "legacy";

export type AthenaAuthRoutingIntent = "same-origin" | "direct" | "custom";

/**
 * Normalized auth routing for one createClient config.
 * Names are consumer-oriented to avoid "client" ambiguity.
 */
export interface ResolvedAthenaAuthRouting {
  mode: AthenaAuthRoutingMode;
  /** Browser auth module base (e.g. `/api/auth` or absolute direct host). */
  browserRequestBaseUrl: string;
  /** Absolute app-origin auth base when request origin is known. */
  serverRequestBaseUrl?: string;
  /** Upstream origin for the same-origin proxy (no trailing slash). */
  proxyUpstreamBaseUrl?: string;
  credentials: AthenaAuthCredentials;
  warnings: string[];
}

export interface ResolveAthenaAuthRoutingInput {
  /** Execution runtime. Local mode is same-origin without a remote upstream. */
  execution?: "local" | "remote";
  /** Explicit auth.url from createClient config. */
  url?: string | null;
  /** Explicit same-origin proxy upstream. */
  upstreamUrl?: string | null;
  routing?: AthenaAuthRoutingIntent;
  credentials?: AthenaAuthCredentials;
  env?: EnvLike;
  /**
   * Unified gateway root used by legacy resolveService path
   * (`${root}/auth` when no explicit auth url/env).
   */
  rootUrl?: string | null;
  /**
   * When true, explicit absolute root wins over env service URLs
   * (matches createClient resolveCore).
   */
  explicitRootWinsOverEnvServices?: boolean;
  /** Public app origin for serverRequestBaseUrl (e.g. https://app.example.com). */
  requestOrigin?: string | null;
  /** Emit console warnings for deprecations (default: non-production). */
  emitWarnings?: boolean;
}

const DUPLICATE_AUTH_PATH =
  /(?:\/api\/auth){2,}|\/auth\/auth(?:\/|$)/i;
const LEADING_SLASHES = /^\/+/;

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, "");
}

function normalizeOptional(
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

function readFirstEnvHttpUrl(
  env: EnvLike | undefined,
  keys: readonly string[]
): string | undefined {
  if (!env) {
    return undefined;
  }
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value && isAbsoluteHttpUrl(value)) {
      return value;
    }
  }
  return undefined;
}

/** createClient legacy auth env keys (absolute only). */
export const LEGACY_CREATE_CLIENT_AUTH_ENV_KEYS = [
  "ATHENA_AUTH_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_URL",
] as const;

/**
 * Detect doubled auth path segments that would produce `/api/auth/api/auth`.
 */
export function hasDuplicateAthenaAuthPath(urlOrPath: string): boolean {
  const trimmed = urlOrPath.trim();
  if (!trimmed) {
    return false;
  }
  if (DUPLICATE_AUTH_PATH.test(trimmed)) {
    return true;
  }
  try {
    if (isAbsoluteUrl(trimmed)) {
      const path = new URL(trimmed).pathname;
      return DUPLICATE_AUTH_PATH.test(path) || /(?:\/api\/auth){2,}/i.test(path);
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Assert a user-supplied auth URL/path is structurally valid.
 * Throws {@link AthenaConfigurationError} with ATHENA_AUTH_INVALID_URL or DUPLICATE_PATH.
 */
export function assertValidAthenaAuthUrlShape(
  value: string,
  label = "Athena auth URL"
): void {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_INVALID_URL",
      `${label} is empty or invalid. Received ${JSON.stringify(value)}.`,
      "auth"
    );
  }
  if (
    trimmed === "http://" ||
    trimmed === "https://" ||
    trimmed.startsWith("undefined/") ||
    trimmed.startsWith("null/")
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_INVALID_URL",
      `${label} is not a usable URL. Received ${JSON.stringify(value)}.`,
      "auth"
    );
  }
  if (hasDuplicateAthenaAuthPath(trimmed)) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_DUPLICATE_PATH",
      `${label} contains a duplicated auth path segment (e.g. /api/auth/api/auth). Received ${JSON.stringify(value)}.`,
      "auth"
    );
  }
  if (isAbsoluteUrl(trimmed) && !isAbsoluteHttpUrl(trimmed)) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_INVALID_URL",
      `${label} must use http or https. Received ${JSON.stringify(value)}.`,
      "auth"
    );
  }
  if (isAbsoluteUrl(trimmed)) {
    try {
      // eslint-disable-next-line no-new
      new URL(trimmed);
    } catch {
      throw new AthenaConfigurationError(
        "ATHENA_AUTH_INVALID_URL",
        `${label} is not a valid absolute URL. Received ${JSON.stringify(value)}.`,
        "auth"
      );
    }
  }
}

/**
 * Strip trailing `/api/auth` from an absolute upstream URL → origin (+ optional base path).
 * Relative paths return as-is after slash normalize.
 */
export function toProxyUpstreamBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_ATHENA_AUTH_ORIGIN;
  }
  if (isAbsoluteHttpUrl(trimmed)) {
    const url = new URL(trimmed);
    const path = stripTrailingSlashes(url.pathname || "/");
    if (path === ATHENA_AUTH_PATH || path.endsWith(ATHENA_AUTH_PATH)) {
      url.pathname =
        path === ATHENA_AUTH_PATH
          ? "/"
          : path.slice(0, -ATHENA_AUTH_PATH.length) || "/";
    }
    url.search = "";
    url.hash = "";
    return stripTrailingSlashes(url.toString());
  }
  return stripTrailingSlashes(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

/**
 * Legacy createClient auth base (matches resolveService before routing modes).
 *
 * Precedence:
 * 1. explicit `auth.url` (any non-empty string, including relative — historically
 *    only absolute survived gateway normalize; relative now rejected later or accepted for same-origin)
 * 2. when explicit absolute root wins: `${root}/auth`
 * 3. env `ATHENA_AUTH_URL` | `NEXT_PUBLIC_ATHENA_AUTH_URL` (absolute http(s) only)
 * 4. `${root}/auth` when root is set
 */
export function resolveLegacyCreateClientAuthUrl(input: {
  explicitUrl?: string | null;
  env?: EnvLike;
  rootUrl?: string | null;
  explicitRootWinsOverEnvServices?: boolean;
}): string | undefined {
  const explicit = normalizeOptional(input.explicitUrl);
  if (explicit) {
    return explicit;
  }
  const root = normalizeOptional(input.rootUrl);
  if (input.explicitRootWinsOverEnvServices && root && isAbsoluteHttpUrl(root)) {
    return appendPath(root, "auth");
  }
  const fromEnv = readFirstEnvHttpUrl(
    input.env,
    LEGACY_CREATE_CLIENT_AUTH_ENV_KEYS
  );
  if (fromEnv) {
    return fromEnv;
  }
  if (root && isAbsoluteHttpUrl(root)) {
    return appendPath(root, "auth");
  }
  return undefined;
}

function resolveUpstreamCandidate(input: ResolveAthenaAuthRoutingInput): {
  value?: string;
  source: "upstreamUrl" | "url-compat" | "env" | "default" | "none";
} {
  const explicitUpstream = normalizeOptional(input.upstreamUrl);
  if (explicitUpstream) {
    return { source: "upstreamUrl", value: explicitUpstream };
  }

  const explicitUrl = normalizeOptional(input.url);
  if (explicitUrl && isAbsoluteHttpUrl(explicitUrl)) {
    return { source: "url-compat", value: explicitUrl };
  }

  if (input.env) {
    const fromEnv = readAthenaAuthUpstreamUrlFromEnv(input.env);
    if (fromEnv) {
      return { source: "env", value: fromEnv };
    }
  }

  return { source: "none" };
}

function buildServerRequestBaseUrl(
  browserRequestBaseUrl: string,
  requestOrigin?: string | null
): string | undefined {
  const origin = normalizeOptional(requestOrigin);
  if (!origin) {
    return undefined;
  }
  if (isAbsoluteHttpUrl(browserRequestBaseUrl)) {
    return stripTrailingSlashes(browserRequestBaseUrl);
  }
  const path = browserRequestBaseUrl.startsWith("/")
    ? browserRequestBaseUrl
    : `/${browserRequestBaseUrl}`;
  return stripTrailingSlashes(new URL(path, `${origin}/`).toString());
}

function defaultCredentials(
  explicit?: AthenaAuthCredentials
): AthenaAuthCredentials {
  // Cookie sessions are the default for all routing modes (matches callAuthEndpoint).
  // Mode-specific defaults can be layered here later if needed.
  return explicit ?? "include";
}

function emitWarning(message: string, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  console.warn(`[athena] ${message}`);
}

/**
 * Resolve auth routing policy for createClient and Next adapters.
 *
 * Policy lives only here — URL string helpers remain policy-free.
 */
export function resolveAthenaAuthRouting(
  input: ResolveAthenaAuthRoutingInput = {}
): ResolvedAthenaAuthRouting {
  const warnings: string[] = [];
  const emit =
    input.emitWarnings ?? !isNodeProductionEnv();
  const credentials = defaultCredentials(input.credentials);

  if (input.execution === "local") {
    const browserRequestBaseUrl = ATHENA_AUTH_PATH;
    return {
      browserRequestBaseUrl,
      credentials,
      mode: "same-origin",
      serverRequestBaseUrl: buildServerRequestBaseUrl(
        browserRequestBaseUrl,
        input.requestOrigin
      ),
      warnings,
    };
  }

  const routing = input.routing;
  const mode: AthenaAuthRoutingMode = routing ?? "legacy";

  if (mode === "same-origin") {
    const browserRequestBaseUrl = ATHENA_AUTH_PATH;
    assertValidAthenaAuthUrlShape(browserRequestBaseUrl, "Same-origin auth base");

    const upstream = resolveUpstreamCandidate(input);
    let proxyUpstreamBaseUrl: string | undefined;

    if (upstream.value) {
      assertValidAthenaAuthUrlShape(upstream.value, "Athena auth upstream URL");
      proxyUpstreamBaseUrl = toProxyUpstreamBaseUrl(upstream.value);

      if (upstream.source === "url-compat") {
        const message =
          "Deprecated interpretation: auth.url is being treated as auth.upstreamUrl under same-origin routing. " +
          'Use auth: { routing: "same-origin", upstreamUrl: "https://auth.example.com" } instead.';
        warnings.push(message);
        emitWarning(message, emit);
      }
    } else {
      // No silent hosted default: same-origin without upstream is a config gap.
      // Browser can still call `/api/auth`; the proxy fails with
      // ATHENA_AUTH_UPSTREAM_REQUIRED until upstreamUrl / env is set.
      const message =
        'auth.routing "same-origin" has no proxy upstream. Set auth.upstreamUrl ' +
        "or ATHENA_AUTH_UPSTREAM_URL (or aliases) before mounting createAthenaAuthProxyHandlers.";
      warnings.push(message);
      emitWarning(message, emit);
    }

    const serverRequestBaseUrl = buildServerRequestBaseUrl(
      browserRequestBaseUrl,
      input.requestOrigin
    );

    return {
      browserRequestBaseUrl,
      credentials,
      mode: "same-origin",
      proxyUpstreamBaseUrl,
      serverRequestBaseUrl,
      warnings,
    };
  }

  if (mode === "direct") {
    const explicitUrl = normalizeOptional(input.url);
    if (!explicitUrl) {
      throw new AthenaConfigurationError(
        "ATHENA_AUTH_INVALID_URL",
        'auth.routing "direct" requires auth.url (absolute Athena Auth base).',
        "auth"
      );
    }
    assertValidAthenaAuthUrlShape(explicitUrl, "auth.url");
    // Guaranteed by policy (not only by normalize): direct never accepts relative bases.
    if (!isAbsoluteHttpUrl(explicitUrl)) {
      throw new AthenaConfigurationError(
        "ATHENA_AUTH_INVALID_URL",
        'auth.routing "direct" requires an absolute http(s) auth.url. ' +
          `Received ${JSON.stringify(explicitUrl)}. Use routing: "same-origin" for relative /api/auth.`,
        "auth"
      );
    }
    const browserRequestBaseUrl = normalizeAthenaAuthBaseUrl(explicitUrl);
    assertValidAthenaAuthUrlShape(
      browserRequestBaseUrl,
      "Resolved direct auth base"
    );

    return {
      browserRequestBaseUrl,
      credentials,
      mode: "direct",
      serverRequestBaseUrl: buildServerRequestBaseUrl(
        browserRequestBaseUrl,
        input.requestOrigin
      ),
      warnings,
    };
  }

  if (mode === "custom") {
    const explicitUrl = normalizeOptional(input.url);
    const browserRequestBaseUrl = explicitUrl
      ? explicitUrl.replace(/\/+$/, "") || ATHENA_AUTH_PATH
      : ATHENA_AUTH_PATH;
    if (explicitUrl) {
      assertValidAthenaAuthUrlShape(explicitUrl, "auth.url");
    }
    const upstream = normalizeOptional(input.upstreamUrl);
    return {
      browserRequestBaseUrl,
      credentials,
      mode: "custom",
      proxyUpstreamBaseUrl: upstream
        ? toProxyUpstreamBaseUrl(upstream)
        : undefined,
      serverRequestBaseUrl: buildServerRequestBaseUrl(
        browserRequestBaseUrl,
        input.requestOrigin
      ),
      warnings,
    };
  }

  // --- legacy (routing omitted) ---
  const legacyUrl = resolveLegacyCreateClientAuthUrl({
    env: input.env,
    explicitRootWinsOverEnvServices: input.explicitRootWinsOverEnvServices,
    explicitUrl: input.url,
    rootUrl: input.rootUrl,
  });

  if (!legacyUrl) {
    // No auth configured — callers decide whether auth is required.
    return {
      browserRequestBaseUrl: "",
      credentials,
      mode: "legacy",
      warnings,
    };
  }

  if (legacyUrl && (legacyUrl.includes("undefined") || legacyUrl === "null")) {
    assertValidAthenaAuthUrlShape(legacyUrl, "auth.url");
  }
  // Relative legacy bases were historically rejected later by gateway normalize;
  // still validate absolute shapes and duplicate paths when absolute.
  if (isAbsoluteUrl(legacyUrl) || legacyUrl.startsWith("/")) {
    try {
      assertValidAthenaAuthUrlShape(legacyUrl, "auth.url");
    } catch (error) {
      // Preserve legacy: empty/invalid relative strings that never reached auth
      // still throw on use; only hard-fail clear absolute garbage.
      if (
        error instanceof AthenaConfigurationError &&
        (error.code === "ATHENA_AUTH_DUPLICATE_PATH" ||
          (isAbsoluteUrl(legacyUrl) && error.code === "ATHENA_AUTH_INVALID_URL"))
      ) {
        throw error;
      }
    }
  }

  return {
    browserRequestBaseUrl: legacyUrl,
    credentials,
    mode: "legacy",
    serverRequestBaseUrl: buildServerRequestBaseUrl(
      legacyUrl,
      input.requestOrigin
    ),
    warnings,
  };
}

/** WeakMap so request views / proxies can read routing without public config leaks. */
const authRoutingByClient = new WeakMap<object, ResolvedAthenaAuthRouting>();

/** Survives duplicate `@xylex-group/athena` copies (root vs `next/server` webpack graphs). */
const AUTH_ROUTING = Symbol.for("@xylex-group/athena.authRouting");

type ClientWithRouting = object & {
  [AUTH_ROUTING]?: ResolvedAthenaAuthRouting;
};

export function attachAthenaAuthRouting(
  client: object,
  routing: ResolvedAthenaAuthRouting
): void {
  authRoutingByClient.set(client, routing);
  try {
    Object.defineProperty(client, AUTH_ROUTING, {
      configurable: true,
      enumerable: false,
      value: routing,
      writable: true,
    });
  } catch {
    // Frozen withContext() views still keep routing on the WeakMap.
  }
}

export function getAttachedAthenaAuthRouting(
  client: object
): ResolvedAthenaAuthRouting | undefined {
  return (
    authRoutingByClient.get(client) ?? (client as ClientWithRouting)[AUTH_ROUTING]
  );
}

/**
 * Safe public diagnostics snapshot (no secrets).
 */
export interface AthenaAuthDiagnostics {
  authConfigured: boolean;
  browserRequestBaseUrl: string | null;
  credentials: AthenaAuthCredentials | null;
  mode: AthenaAuthRoutingMode | null;
  proxyUpstreamBaseUrl: string | null;
  requestOrigin: string | null;
  serverRequestBaseUrl: string | null;
  bearerDetected: boolean;
  cookieDetected: boolean;
  sessionTokenDetected: boolean;
  warnings: string[];
}

export function toAthenaAuthDiagnostics(
  routing: ResolvedAthenaAuthRouting | undefined,
  context?: {
    requestOrigin?: string | null;
    cookie?: string | null;
    bearerToken?: string | null;
    sessionToken?: string | null;
  }
): AthenaAuthDiagnostics {
  const requestOrigin = normalizeOptional(context?.requestOrigin) ?? null;
  const browser = routing?.browserRequestBaseUrl
    ? routing.browserRequestBaseUrl
    : null;
  const server =
    routing && requestOrigin
      ? buildServerRequestBaseUrl(routing.browserRequestBaseUrl, requestOrigin) ??
        routing.serverRequestBaseUrl ??
        null
      : (routing?.serverRequestBaseUrl ?? null);

  return {
    authConfigured: Boolean(browser),
    bearerDetected: Boolean(normalizeOptional(context?.bearerToken)),
    browserRequestBaseUrl: browser,
    cookieDetected: Boolean(normalizeOptional(context?.cookie)),
    credentials: routing?.credentials ?? null,
    mode: routing?.mode ?? null,
    proxyUpstreamBaseUrl: routing?.proxyUpstreamBaseUrl ?? null,
    requestOrigin,
    serverRequestBaseUrl: server,
    sessionTokenDetected: Boolean(normalizeOptional(context?.sessionToken)),
    warnings: routing?.warnings ? [...routing.warnings] : [],
  };
}

/**
 * Thin extract of explicit `auth.routing` / `auth.url` / `auth: false`.
 * Does not infer embedded Auth or invent Next discovery endpoints.
 */
export function resolveExplicitAuthRouting(
  auth?:
    | false
    | {
        credentials?: AthenaAuthCredentials;
        routing?: AthenaAuthRoutingIntent;
        upstreamUrl?: string | null;
        url?: string | null;
      }
    | null
): ResolvedAthenaAuthRouting | undefined {
  if (auth === false || auth == null || typeof auth !== "object") {
    return undefined;
  }
  if (
    auth.routing === "same-origin" ||
    auth.routing === "direct" ||
    auth.routing === "custom"
  ) {
    return resolveAthenaAuthRouting({
      credentials: auth.credentials,
      emitWarnings: false,
      routing: auth.routing,
      upstreamUrl: auth.upstreamUrl,
      url: auth.url,
    });
  }
  const explicitUrl = normalizeOptional(auth.url);
  if (!explicitUrl) {
    return undefined;
  }
  return resolveAthenaAuthRouting({
    credentials: auth.credentials,
    emitWarnings: false,
    routing: "custom",
    upstreamUrl: auth.upstreamUrl,
    url: explicitUrl,
  });
}

/** @internal re-export helper for path joins without policy */
export function joinAuthPath(base: string, segment: string): string {
  const path = segment.replace(LEADING_SLASHES, "");
  if (isAbsoluteHttpUrl(base) || base.startsWith("http")) {
    return new URL(path, `${stripTrailingSlashes(base)}/`).toString();
  }
  const root = base.startsWith("/") ? base : `/${base}`;
  return `${stripTrailingSlashes(root)}/${path}`;
}
