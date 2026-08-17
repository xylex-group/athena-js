import {
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  ATHENA_AUTH_SESSION_COOKIE_NAMES,
} from "./constants.ts";
import type { AthenaAuthSessionBridgeOptions } from "./types.ts";

/** Cookie expiry used when clearing (expire immediately). */
const EXPIRED_AT = new Date(0);

/**
 * Detect whether the request should be treated as HTTPS for the `Secure` flag.
 *
 * Prefers the first value of `x-forwarded-proto` (common behind proxies /
 * Cloudflare / Vercel), then falls back to `request.url` protocol.
 *
 * @param request - Incoming Web Fetch request
 * @returns `true` when cookies should include `Secure`
 */
export function resolveRequestIsSecure(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
  if (forwardedProto) {
    const first = forwardedProto.split(",")[0]?.trim().toLowerCase();
    if (first === "https") {
      return true;
    }
    if (first === "http") {
      return false;
    }
  }
  return new URL(request.url).protocol === "https:";
}

/**
 * Parse an optional ISO-8601 `expiresAt` string into a `Date`.
 *
 * @param value - Unknown JSON field (usually a string)
 * @returns Valid `Date`, or `undefined` when missing / invalid
 */
export function resolveSessionCookieExpiresAt(
  value: unknown
): Date | undefined {
  if (typeof value !== "string") {
    return;
  }
  const expiresAt = new Date(value);
  return Number.isNaN(expiresAt.getTime()) ? undefined : expiresAt;
}

/**
 * Serialize a single `Set-Cookie` header value.
 *
 * @internal
 */
function serializeCookie(
  name: string,
  value: string,
  options: {
    path: string;
    sameSite: "lax" | "strict" | "none";
    secure: boolean;
    httpOnly: boolean;
    expires?: Date | undefined;
  }
): string {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    "HttpOnly",
    `SameSite=${options.sameSite === "none" ? "None" : options.sameSite === "strict" ? "Strict" : "Lax"}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  return parts.join("; ");
}

/**
 * Resolve cookie name / path / SameSite defaults from bridge options.
 *
 * @param options - Optional bridge configuration
 */
export function resolveBridgeCookieConfig(
  options?: AthenaAuthSessionBridgeOptions
) {
  return {
    cookieName: options?.cookieName ?? ATHENA_AUTH_SESSION_COOKIE_NAME,
    cookieNames: options?.cookieNames ?? ATHENA_AUTH_SESSION_COOKIE_NAMES,
    cookiePath: options?.cookiePath ?? "/",
    sameSite: options?.sameSite ?? "lax",
  } as const;
}

/**
 * Append a `Set-Cookie` header for the bridged session token.
 *
 * @param headers - Response headers (mutated)
 * @param request - Used for Secure detection when `options.secure` is omitted
 * @param token - Session token value (may be empty when clearing a single name)
 * @param expiresAt - Optional cookie expiry
 * @param options - Bridge cookie options
 */
export function appendSessionCookie(
  headers: Headers,
  request: Request,
  token: string,
  expiresAt: Date | undefined,
  options?: AthenaAuthSessionBridgeOptions
): void {
  const config = resolveBridgeCookieConfig(options);
  const secure = options?.secure ?? resolveRequestIsSecure(request);
  headers.append(
    "set-cookie",
    serializeCookie(config.cookieName, token, {
      expires: expiresAt,
      httpOnly: true,
      path: config.cookiePath,
      sameSite: config.sameSite,
      secure,
    })
  );
}

/**
 * Expire all known Athena Auth session cookie name variants.
 *
 * Always includes both the primary `cookieName` and every entry in
 * `cookieNames` so leftover underscore/hyphen aliases are removed.
 *
 * @param headers - Response headers (mutated)
 * @param request - Used for Secure detection
 * @param options - Bridge cookie options
 */
export function appendClearSessionCookies(
  headers: Headers,
  request: Request,
  options?: AthenaAuthSessionBridgeOptions
): void {
  const config = resolveBridgeCookieConfig(options);
  const secure = options?.secure ?? resolveRequestIsSecure(request);
  const names = new Set<string>([config.cookieName, ...config.cookieNames]);
  for (const name of names) {
    headers.append(
      "set-cookie",
      serializeCookie(name, "", {
        expires: EXPIRED_AT,
        httpOnly: true,
        path: config.cookiePath,
        sameSite: config.sameSite,
        secure,
      })
    );
  }
}
