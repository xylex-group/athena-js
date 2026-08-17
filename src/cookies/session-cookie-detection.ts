/**
 * Cookie-header detection for Athena Auth / Better Auth session cookies.
 *
 * Used by Next.js middleware and edge guards to decide whether a request
 * already carries a session token **without** parsing the full cookie map.
 */

/**
 * Patterns that match a non-empty session token cookie assignment in a raw
 * `Cookie` request header.
 *
 * Covers:
 * - Better Auth: `better-auth.session_token`, `better-auth-session_token`
 * - Athena Auth (hyphen form): `athena-auth.session-token`, `athena-auth-session-token`
 * - Athena Auth (underscore form / default cookie helper): `athena-auth.session_token`,
 *   `athena-auth-session_token`
 * - Optional `__Secure-` prefix (HTTPS cookie prefixing)
 *
 * Each pattern requires a leading start-of-string or `; ` boundary and a
 * trailing `=` so bare name fragments do not false-positive.
 */
export const SESSION_COOKIE_PATTERNS = [
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/,
  /(?:^|;\s*)(?:__Secure-)?better-auth-session_token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth\.session-token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth-session-token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth\.session_token=/,
  /(?:^|;\s*)(?:__Secure-)?athena-auth-session_token=/,
] as const;

/**
 * Returns whether a raw `Cookie` header appears to include an auth session
 * token cookie (Athena Auth or Better Auth naming).
 *
 * This is a **presence** check only — it does not validate the token value,
 * signature, or expiry. Prefer {@link getSessionCookie} when you need the
 * actual token string.
 *
 * @param cookieHeader - Value of the `Cookie` request header, or `null`/`undefined`
 * @returns `true` if any {@link SESSION_COOKIE_PATTERNS} matches
 *
 * @example
 * ```ts
 * import { hasAuthSessionCookie } from '@xylex-group/athena/cookies'
 *
 * export function middleware(request: Request) {
 *   if (!hasAuthSessionCookie(request.headers.get('cookie'))) {
 *     return Response.redirect(new URL('/sign-in', request.url))
 *   }
 * }
 * ```
 */
export function hasAuthSessionCookie(
  cookieHeader: string | null | undefined
): boolean {
  if (!cookieHeader) {
    return false;
  }

  return SESSION_COOKIE_PATTERNS.some((pattern) => pattern.test(cookieHeader));
}
