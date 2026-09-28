import { readSessionTokenFromCookies } from "../../auth/local/cookies.ts";
import type { AthenaRuntimeHttpSecurity } from "./types.ts";

export function extraAllowedAppHttpOrigins(
  clientConfig: { app?: { url?: string | null } },
  security?: { http?: AthenaRuntimeHttpSecurity }
): string[] {
  const origins: string[] = [];
  if (security?.http?.allowedOrigins) {
    origins.push(...security.http.allowedOrigins);
  }
  const appUrl = clientConfig.app?.url?.trim();
  if (appUrl) {
    origins.push(appUrl);
  }
  return origins;
}

export function requestCarriesSessionCookie(request: Request): boolean {
  return (
    readSessionTokenFromCookies(request.headers.get("cookie")) !== undefined
  );
}

/**
 * Cookie-session HTTP always Origin-checks, even when `security.mode` is
 * `trusted`. Bearer / process callers with no session cookie may skip Origin
 * only when trusted is explicit.
 */
export function shouldEnforceCookieAwareRequestOrigin(
  request: Request,
  explicitTrusted: boolean
): boolean {
  if (requestCarriesSessionCookie(request)) {
    return true;
  }
  return !explicitTrusted;
}
