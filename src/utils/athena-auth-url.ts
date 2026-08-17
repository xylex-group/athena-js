/**
 * Resolve Athena Auth base / upstream URLs from env or explicit config.
 *
 * Mirrors the Athena Auth UI base-url contract so apps and the SDK share one
 * precedence order for `ATHENA_AUTH_*` environment variables.
 */

/** Default browser/proxy path for same-origin auth routing. */
export const ATHENA_AUTH_PATH = "/api/auth";

/** Fallback origin when no absolute upstream is configured (server-side). */
export const LOCAL_DEV_ORIGIN = "http://localhost:3000";

/**
 * Hosted Athena Auth origin used when no upstream override is supplied.
 * Origin only — no `/api/auth` suffix.
 */
export const DEFAULT_ATHENA_AUTH_ORIGIN = "https://auth.athena-auth.com";

/**
 * @deprecated Prefer {@link DEFAULT_ATHENA_AUTH_ORIGIN}.
 * Kept for callers that used the older name.
 */
export const DEFAULT_ATHENA_AUTH_UPSTREAM_URL = DEFAULT_ATHENA_AUTH_ORIGIN;

/**
 * Environment keys checked (in order) for the Athena Auth upstream URL.
 *
 * Prefer server-only keys first so private upstream hosts are not forced to
 * rely on `NEXT_PUBLIC_*` values.
 */
export const ATHENA_AUTH_UPSTREAM_ENV_KEYS = [
  "ATHENA_AUTH_UPSTREAM_URL",
  "ATHENA_AUTH_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_URL",
] as const;

/**
 * Auth UI naming parity (`base-url.ts`).
 * Same ordered list as {@link ATHENA_AUTH_UPSTREAM_ENV_KEYS}.
 */
export const ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES = ATHENA_AUTH_UPSTREAM_ENV_KEYS;

export type AthenaAuthUpstreamEnvKey =
  (typeof ATHENA_AUTH_UPSTREAM_ENV_KEYS)[number];

/** Loose env map (Node `process.env` or a test fixture). */
export type EnvLike = Record<string, string | undefined>;

export type AthenaAuthUpstreamEnv = Partial<
  Record<AthenaAuthUpstreamEnvKey, string | undefined>
> &
  EnvLike;

export interface AthenaAuthClientBaseUrlOptions {
  /**
   * When `true` (default), ensure the client base ends with `/api/auth`.
   * Set `false` when the auth server is mounted at a custom path or root.
   */
  appendAuthPath?: boolean;
}

const LEADING_SLASHES_REGEX = /^\/+/;

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, "");
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function ensureAthenaAuthPath(pathname: string): string {
  const normalizedPath = stripTrailingSlashes(
    ensureLeadingSlash(pathname.trim())
  );

  if (!normalizedPath || normalizedPath === "/") {
    return ATHENA_AUTH_PATH;
  }

  if (normalizedPath.endsWith(ATHENA_AUTH_PATH)) {
    return normalizedPath;
  }

  return `${normalizedPath}${ATHENA_AUTH_PATH}`;
}

function stripAthenaAuthPath(pathname: string): string {
  const normalizedPath = stripTrailingSlashes(
    ensureLeadingSlash(pathname.trim())
  );

  if (!normalizedPath || normalizedPath === "/") {
    return "/";
  }

  if (normalizedPath === ATHENA_AUTH_PATH) {
    return "/";
  }

  if (normalizedPath.endsWith(ATHENA_AUTH_PATH)) {
    const withoutAuthPath = normalizedPath.slice(0, -ATHENA_AUTH_PATH.length);
    return withoutAuthPath ? ensureLeadingSlash(withoutAuthPath) : "/";
  }

  return normalizedPath;
}

function readProcessEnv(): EnvLike | undefined {
  try {
    const maybeProcess = (globalThis as { process?: { env?: EnvLike } })
      .process;
    return maybeProcess?.env;
  } catch {
    // Restricted runtimes may throw when reading process.
  }
  return undefined;
}

function getBrowserOrigin(): string | undefined {
  try {
    const origin = (
      globalThis as { window?: { location?: { origin?: string } } }
    ).window?.location?.origin;
    return typeof origin === "string" && origin.length > 0 ? origin : undefined;
  } catch {
    // Non-browser or restricted runtimes may throw on window access.
  }
  return undefined;
}

/**
 * Returns `true` when the value is an absolute `http://` or `https://` URL.
 */
export function isAbsoluteUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

/**
 * Read the first non-empty Athena Auth upstream URL from an env-like map.
 *
 * @returns Trimmed URL string, or `undefined` when none of the keys are set
 */
export function readAthenaAuthUpstreamUrlFromEnv(
  env: EnvLike
): string | undefined {
  for (const key of ATHENA_AUTH_UPSTREAM_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveConfiguredAthenaAuthUpstreamUrl(
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv
): string | undefined {
  if (typeof rawUpstreamUrl === "string") {
    const trimmed = rawUpstreamUrl.trim();
    return trimmed || undefined;
  }

  if (rawUpstreamUrl) {
    return readAthenaAuthUpstreamUrlFromEnv(rawUpstreamUrl);
  }

  const processEnv = readProcessEnv();
  return processEnv ? readAthenaAuthUpstreamUrlFromEnv(processEnv) : undefined;
}

/**
 * Normalize a consumer-supplied auth base URL so it targets `/api/auth`
 * (unless the path already ends with that segment).
 *
 * Absolute URLs keep origin and rewrite pathname; relative paths are ensured
 * to end with `/api/auth`.
 *
 * @example
 * ```ts
 * normalizeAthenaAuthBaseUrl('https://auth.example.com')
 * // => 'https://auth.example.com/api/auth'
 *
 * normalizeAthenaAuthBaseUrl('/api/auth')
 * // => '/api/auth'
 * ```
 */
export function normalizeAthenaAuthBaseUrl(urlOrPath: string): string {
  const trimmed = urlOrPath.trim();

  if (!trimmed) {
    return ATHENA_AUTH_PATH;
  }

  if (isAbsoluteUrl(trimmed)) {
    const url = new URL(trimmed);
    url.pathname = ensureAthenaAuthPath(url.pathname);
    url.search = "";
    url.hash = "";
    return stripTrailingSlashes(url.toString());
  }

  return ensureAthenaAuthPath(trimmed);
}

/**
 * Resolve the **server-side** Athena Auth upstream origin (no `/api/auth` suffix).
 *
 * Used when proxying or calling the auth host directly from Node / edge.
 *
 * @param rawUpstreamUrl - Explicit URL, env map, or omit to read `process.env`
 * @returns Origin like `https://auth.example.com` (no trailing slash)
 */
export function resolveAthenaAuthUpstreamUrl(
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv
): string {
  const configuredUpstream =
    resolveConfiguredAthenaAuthUpstreamUrl(rawUpstreamUrl) ||
    DEFAULT_ATHENA_AUTH_ORIGIN;

  if (isAbsoluteUrl(configuredUpstream)) {
    const upstreamUrl = new URL(configuredUpstream);
    upstreamUrl.pathname = stripAthenaAuthPath(upstreamUrl.pathname);
    upstreamUrl.search = "";
    upstreamUrl.hash = "";
    return stripTrailingSlashes(upstreamUrl.toString());
  }

  const normalizedPath = stripAthenaAuthPath(configuredUpstream);
  return stripTrailingSlashes(
    new URL(normalizedPath, LOCAL_DEV_ORIGIN).toString()
  );
}

function resolveBrowserFacingOrigin(
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv
): string {
  if (resolveConfiguredAthenaAuthUpstreamUrl(rawUpstreamUrl)) {
    return `${resolveAthenaAuthUpstreamUrl(rawUpstreamUrl)}/`;
  }

  const browserOrigin = getBrowserOrigin();
  if (browserOrigin) {
    return `${browserOrigin}/`;
  }

  return `${LOCAL_DEV_ORIGIN}/`;
}

function resolvePreservedAthenaAuthBaseUrl(
  configuredAuthBaseUrl: string,
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv
): string {
  const trimmed = configuredAuthBaseUrl.trim();
  const preservedConfiguredBaseUrl = trimmed || ATHENA_AUTH_PATH;

  if (isAbsoluteUrl(preservedConfiguredBaseUrl)) {
    return stripTrailingSlashes(preservedConfiguredBaseUrl);
  }

  return stripTrailingSlashes(
    new URL(
      ensureLeadingSlash(preservedConfiguredBaseUrl),
      resolveBrowserFacingOrigin(rawUpstreamUrl)
    ).toString()
  );
}

/**
 * Resolve the **browser-facing** auth client base URL.
 *
 * Default behavior appends `/api/auth` for same-origin proxying. Pass
 * `{ appendAuthPath: false }` to keep a custom path or root mount.
 *
 * Overloads match common call styles from Athena Auth UI and app code:
 * - `resolveAthenaAuthClientBaseUrl("https://auth.example.com")`
 * - `resolveAthenaAuthClientBaseUrl(process.env)`
 * - `resolveAthenaAuthClientBaseUrl(undefined)` → env + defaults
 * - `resolveAthenaAuthClientBaseUrl(path, upstream, { appendAuthPath: false })`
 */
export function resolveAthenaAuthClientBaseUrl(
  configuredAuthBaseUrl?: string | EnvLike,
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv,
  options?: AthenaAuthClientBaseUrlOptions
): string;
export function resolveAthenaAuthClientBaseUrl(
  configuredAuthBaseUrl: string,
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv,
  options?: AthenaAuthClientBaseUrlOptions
): string;
export function resolveAthenaAuthClientBaseUrl(
  configuredAuthBaseUrl?: string | EnvLike,
  rawUpstreamUrl?: string | AthenaAuthUpstreamEnv,
  options: AthenaAuthClientBaseUrlOptions = {}
): string {
  let baseInput: string;

  if (typeof configuredAuthBaseUrl === "string") {
    baseInput = configuredAuthBaseUrl;
  } else if (configuredAuthBaseUrl) {
    baseInput =
      readAthenaAuthUpstreamUrlFromEnv(configuredAuthBaseUrl) ??
      ATHENA_AUTH_PATH;
  } else {
    const fromEnv = resolveConfiguredAthenaAuthUpstreamUrl(rawUpstreamUrl);
    baseInput = fromEnv ?? ATHENA_AUTH_PATH;
  }

  if (options.appendAuthPath === false) {
    return resolvePreservedAthenaAuthBaseUrl(baseInput, rawUpstreamUrl);
  }

  const normalizedConfiguredBaseUrl = normalizeAthenaAuthBaseUrl(baseInput);

  if (isAbsoluteUrl(normalizedConfiguredBaseUrl)) {
    return normalizedConfiguredBaseUrl;
  }

  const browserOrigin = getBrowserOrigin();
  if (browserOrigin) {
    return stripTrailingSlashes(
      new URL(normalizedConfiguredBaseUrl, browserOrigin).toString()
    );
  }

  if (resolveConfiguredAthenaAuthUpstreamUrl(rawUpstreamUrl)) {
    // Direct upstream without proxy path: origin only (no /api/auth) when
    // the configured base was relative — server-side absolute upstream.
    const upstream = resolveAthenaAuthUpstreamUrl(rawUpstreamUrl);
    return stripTrailingSlashes(
      new URL(ATHENA_AUTH_PATH, `${upstream}/`).toString()
    );
  }

  return stripTrailingSlashes(
    new URL(normalizedConfiguredBaseUrl, LOCAL_DEV_ORIGIN).toString()
  );
}

/**
 * Build an absolute Athena Auth request URL for a path under the client base.
 *
 * Resolves at **call time** (reads env when `rawBaseUrl` is omitted) so module
 * load order does not freeze a stale URL.
 *
 * @param path - Path relative to the auth base (leading slashes stripped)
 * @param rawBaseUrl - Optional base string or env map
 *
 * @example
 * ```ts
 * resolveAthenaAuthRequestUrl('get-session', 'https://auth.example.com')
 * // => 'https://auth.example.com/api/auth/get-session'
 * ```
 */
export function resolveAthenaAuthRequestUrl(
  path: string,
  rawBaseUrl?: string | EnvLike
): string {
  const normalizedPath = path.replace(LEADING_SLASHES_REGEX, "");
  const base = resolveAthenaAuthClientBaseUrl(rawBaseUrl);
  return new URL(normalizedPath, `${base}/`).toString();
}

/** Relative auth path for email verification (`GET /verify-email`). */
export const ATHENA_AUTH_VERIFY_EMAIL_PATH = "verify-email";

/**
 * Relative segment for session lookup (`GET /get-session`).
 * Prefer with {@link resolveAthenaAuthRequestUrl} when `base` already ends in `/api/auth`.
 */
export const ATHENA_AUTH_GET_SESSION_PATH = "get-session";

/**
 * Absolute app/proxy path for session lookup.
 * Use with `new URL(ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH, appOrigin)` when
 * `baseUrl` is the **app origin** (e.g. `https://app.example.com`), not the auth client base.
 */
export const ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH = `${ATHENA_AUTH_PATH}/get-session`;

/**
 * @deprecated Alias of {@link ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH} for drop-in
 * replacement of app-local `AUTH_SESSION_PATH` constants. Prefer the `ATHENA_` name.
 */
export const AUTH_SESSION_PATH = ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH;

/**
 * Query param that forces Athena Auth / Better Auth style session handlers to
 * skip cookie cache and re-read the live session cookie.
 */
export const ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM =
  "disableCookieCache";

/**
 * @deprecated Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM}.
 */
export const DISABLE_COOKIE_CACHE_QUERY_PARAM =
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM;

/** Value paired with {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM}. */
export const ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE = "true";

/**
 * @deprecated Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE}.
 */
export const DISABLE_COOKIE_CACHE_QUERY_VALUE =
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE;

/**
 * Optional request/response header some apps use to pass serialized session
 * payload between edge middleware and the app (not set by the SDK itself).
 */
export const ATHENA_SESSION_DATA_HEADER = "x-session-data";

/**
 * @deprecated Alias of {@link ATHENA_SESSION_DATA_HEADER}.
 */
export const SESSION_DATA_HEADER = ATHENA_SESSION_DATA_HEADER;

/**
 * Absolute callback URL for email verification.
 *
 * Equivalent to `resolveAthenaAuthRequestUrl("verify-email")` — use this in
 * sign-up / send-verification payloads as `callbackURL` instead of a local
 * wrapper around Auth UI `base-url` helpers.
 *
 * @param rawBaseUrl - Optional base string or env map (defaults to process env)
 * @returns e.g. `https://auth.example.com/api/auth/verify-email`
 *
 * @example
 * ```ts
 * import { resolveEmailVerificationCallbackUrl } from "@xylex-group/athena/utils"
 *
 * await client.auth.signUp.email({
 *   email,
 *   password,
 *   name,
 *   callbackURL: resolveEmailVerificationCallbackUrl(),
 * })
 * ```
 */
export function resolveEmailVerificationCallbackUrl(
  rawBaseUrl?: string | EnvLike
): string {
  return resolveAthenaAuthRequestUrl(ATHENA_AUTH_VERIFY_EMAIL_PATH, rawBaseUrl);
}

/**
 * Build a same-origin (or absolute) **fresh** get-session URL.
 *
 * Appends `disableCookieCache=true` so middleware / RSC session probes do not
 * reuse a stale cookie-cache entry.
 *
 * @param baseUrl - App origin (`https://app.example.com`) or any base accepted by
 *   the `URL` constructor. Resolves {@link ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH}
 *   (`/api/auth/get-session`) against that base.
 * @returns URL such as `https://app.example.com/api/auth/get-session?disableCookieCache=true`
 *
 * @example
 * ```ts
 * import { createFreshSessionLookupUrl } from "@xylex-group/athena/utils"
 *
 * const url = createFreshSessionLookupUrl("https://app.example.com")
 * await fetch(url, { headers: { cookie: requestHeaders.get("cookie") ?? "" } })
 * ```
 *
 * For auth-client base URLs that already include `/api/auth`, prefer:
 * `resolveAthenaAuthRequestUrl("get-session", authBase) + "?disableCookieCache=true"`
 * or pass the **app** origin into this helper when you proxy `/api/auth/*` locally.
 */
export function createFreshSessionLookupUrl(baseUrl: string | URL): URL {
  const url = new URL(ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH, baseUrl);
  url.searchParams.set(
    ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
    ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE
  );
  return url;
}
