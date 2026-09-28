/**
 * Default App Router path for the Athena Auth session cookie bridge.
 *
 * Mount as `app/api/athena-auth/session/route.ts`, or configure another path
 * such as `/api/auth/session` when using catch-all handlers.
 *
 * @see {@link createAthenaAuthSessionBridgeHandlers}
 * @see {@link createAthenaAuthSessionBridgePathHandlers}
 */
export const ATHENA_AUTH_SESSION_BRIDGE_ROUTE = "/api/athena-auth/session";

/**
 * Primary host-app session cookie written by the bridge.
 *
 * Hyphen form (`session-token`) matches Athena Auth UI and several consumer
 * apps. Underscore form is also cleared on DELETE for cookie-helper parity.
 *
 * @see {@link ATHENA_AUTH_SESSION_COOKIE_NAMES}
 */
export const ATHENA_AUTH_SESSION_COOKIE_NAME = "athena-auth.session-token";

/**
 * Cookie names cleared on logout / bridge `DELETE`.
 *
 * Includes both hyphen and underscore variants so bridge clear stays aligned
 * with `@xylex-group/athena/cookies` session token lookup.
 */
export const ATHENA_AUTH_SESSION_COOKIE_NAMES = [
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  "athena-auth.session_token",
] as const;
