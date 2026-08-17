/**
 * Minimal session shape accepted when deriving a bridge payload from
 * `auth.getSession()`-style responses.
 *
 * Either nested `session.token` or a top-level `token` may be present depending
 * on the Athena Auth response envelope version.
 */
export interface AthenaAuthSessionBridgeSource {
  session?: {
    /** ISO-8601 expiry when provided by the auth server. */
    expiresAt?: string | null;
    /** Opaque session token string. */
    token?: string | null;
  } | null;
  /** Some clients surface the token at the envelope root. */
  token?: string | null;
}

/**
 * Body accepted by the session bridge `POST` handler and by
 * {@link persistAthenaAuthSessionOnAppHost}.
 */
export interface AthenaAuthSessionBridgePayload {
  /**
   * Optional cookie `Expires` value (ISO-8601 string).
   * When omitted, the cookie is a session cookie (browser-lifetime).
   */
  expiresAt?: string | undefined;
  /** Non-empty session token to store in the app-host httpOnly cookie. */
  token: string;
}

/**
 * Configuration for bridge route handlers and cookie attributes.
 *
 * All fields are optional; defaults match speedrun-formations /
 * Athena Auth UI conventions.
 */
export interface AthenaAuthSessionBridgeOptions {
  /**
   * Cookie name written on successful `POST`.
   *
   * @defaultValue `athena-auth.session-token`
   */
  cookieName?: string | undefined;
  /**
   * Cookie names cleared on `DELETE` (aliases).
   *
   * @defaultValue hyphen + underscore session token names
   */
  cookieNames?: readonly string[] | undefined;
  /**
   * Path attribute for the session cookie.
   *
   * @defaultValue `/`
   */
  cookiePath?: string | undefined;
  /**
   * Route reported in JSON responses and used by client helpers when not
   * overridden.
   *
   * @defaultValue `/api/athena-auth/session`
   */
  route?: string | undefined;
  /**
   * Cookie SameSite attribute.
   *
   * @defaultValue `lax`
   */
  sameSite?: "lax" | "strict" | "none" | undefined;
  /**
   * Force the `Secure` flag. When omitted, the handlers derive Secure from the
   * request URL scheme and `x-forwarded-proto`.
   */
  secure?: boolean | undefined;
}

/**
 * Options for catch-all / dynamic-segment handlers under `/api/auth/*`.
 *
 * Extends {@link AthenaAuthSessionBridgeOptions} with path matching.
 */
export interface AthenaAuthSessionBridgePathOptions
  extends AthenaAuthSessionBridgeOptions {
  /**
   * Pathname suffixes (final URL segments) that activate the bridge.
   *
   * @defaultValue `['session']` — covers `/api/auth/session` and
   * `/api/athena-auth/session`
   */
  matchPaths?: readonly string[] | undefined;
}
