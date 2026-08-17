import { isLocalHostname } from "./hostname.ts";

/**
 * Cookie name prefixes treated as Athena Auth / Better Auth session material.
 *
 * Used by {@link clearAuthCookies} when matching `document.cookie` names
 * (including `__Secure-` prefixed variants).
 *
 * | Prefix | Typical cookies |
 * |--------|-----------------|
 * | `athena-auth` | `athena-auth.session_token`, `athena-auth.session-token`, chunked `session_data.*` |
 * | `__Secure-athena-auth` | HTTPS-prefixed Athena cookies |
 * | `better-auth` | Legacy Better Auth session cookies |
 * | `__Secure-better-auth` | HTTPS-prefixed Better Auth cookies |
 *
 * @see {@link clearAuthCookies}
 * @see docs/auth-cookies.md
 */
export const ATHENA_AUTH_COOKIE_PREFIXES = [
  "athena-auth",
  "__Secure-athena-auth",
  "better-auth",
  "__Secure-better-auth",
] as const;

/** @deprecated Prefer {@link ATHENA_AUTH_COOKIE_PREFIXES}. */
export const DEFAULT_AUTH_COOKIE_PREFIXES = ATHENA_AUTH_COOKIE_PREFIXES;

export interface ClearAuthCookiesOptions {
  /**
   * Override cookie header to scan (tests). Defaults to `document.cookie`.
   */
  cookieHeader?: string;
  /**
   * Hostname used to build domain candidates (host + parent domains).
   * Defaults to `window.location.hostname` when available.
   */
  hostname?: string;
  /**
   * Cookie path attribute when expiring cookies.
   * @default `/`
   */
  path?: string;
  /**
   * Name prefixes to clear. Defaults to {@link ATHENA_AUTH_COOKIE_PREFIXES}.
   */
  prefixes?: string[];
}

interface BrowserCookieStore {
  cookie: string;
}

function extractCookieNames(cookieHeader: string): string[] {
  const names = new Set<string>();
  for (const rawCookie of cookieHeader.split(";")) {
    const trimmed = rawCookie.trim();
    if (!trimmed) {
      continue;
    }

    const eqPos = trimmed.indexOf("=");
    const name = (eqPos > -1 ? trimmed.slice(0, eqPos) : trimmed).trim();
    if (name) {
      names.add(name);
    }
  }
  return Array.from(names);
}

function buildCookieDomainCandidates(hostname: string): string[] {
  const normalized = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!normalized || isLocalHostname(normalized)) {
    return [];
  }

  const labels = normalized.split(".").filter(Boolean);
  if (labels.length < 2) {
    return [normalized, `.${normalized}`];
  }

  const domains = new Set<string>();
  for (let index = 0; index <= labels.length - 2; index += 1) {
    const domain = labels.slice(index).join(".");
    domains.add(domain);
    domains.add(`.${domain}`);
  }
  return Array.from(domains);
}

function getCookieStore(): BrowserCookieStore | null {
  const candidate = (globalThis as { document?: BrowserCookieStore }).document;
  if (!candidate || typeof candidate.cookie !== "string") {
    return null;
  }
  return candidate;
}

function getRuntimeHostname(): string {
  const fromWindow = (
    globalThis as { window?: { location?: { hostname?: string } } }
  ).window?.location?.hostname;
  if (typeof fromWindow === "string") {
    return fromWindow;
  }

  const fromLocation = (globalThis as { location?: { hostname?: string } })
    .location?.hostname;
  if (typeof fromLocation === "string") {
    return fromLocation;
  }

  return "";
}

function writeExpiredCookie(
  cookieStore: BrowserCookieStore,
  name: string,
  path: string,
  domain?: string
) {
  const domainClause = domain ? ` domain=${domain};` : "";
  cookieStore.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=${path};${domainClause}`;
}

/**
 * Clears Athena Auth / Better Auth browser cookies by name prefix.
 *
 * Safe to call from server/SSR: returns `[]` when `document` is unavailable.
 * Prefer this over local copies of cookie-clearing loops in app `signOut`
 * helpers.
 *
 * Compared to a minimal `document.cookie = …; path=/` wipe, this helper also:
 * - expires with `Max-Age=0`
 * - tries host + parent domain attributes (for subdomain deployments)
 * - skips domain attributes on localhost / local hostnames
 *
 * For the **app-host bridge** httpOnly cookie written by
 * `createAthenaAuthSessionBridgeHandlers`, also call
 * `clearAthenaAuthSessionOnAppHost()` from `@xylex-group/athena/next/client`
 * (that cookie is not always visible to `document.cookie`).
 *
 * @param options - Optional prefixes, hostname, path, or cookie header override
 * @returns Cookie names that matched and were targeted for deletion
 *
 * @example
 * ```ts
 * import { clearAuthCookies } from "@xylex-group/athena/utils"
 *
 * export async function signOut(options?: { redirect?: boolean }) {
 *   try {
 *     await authClient.signOut({ fetchOptions: { throw: true } })
 *   } catch (error) {
 *     console.error("[auth] Sign out failed:", error)
 *   } finally {
 *     clearAuthCookies()
 *     if (options?.redirect !== false && typeof window !== "undefined") {
 *       window.location.href = "/sign-in"
 *     }
 *   }
 * }
 * ```
 */
export interface SignOutAndClearAthenaSessionOptions {
  /**
   * Optional app-host session bridge clear
   * (`clearAthenaAuthSessionOnAppHost` from `@xylex-group/athena/next/client`).
   */
  clearBridge?: () => Promise<unknown> | unknown;
  clearCookieOptions?: ClearAuthCookiesOptions;
  /**
   * When false, skip `window.location` even if `redirectTo` is set.
   * @default true when `redirectTo` is a non-empty string
   */
  hardRedirect?: boolean;
  /**
   * When set and running in a browser, hard-redirect after clearing cookies.
   * Pass `null` / omit to skip navigation (caller uses soft navigate).
   */
  redirectTo?: string | null;
  /**
   * Call the auth client's sign-out (or equivalent). Failures are swallowed so
   * cookies still clear; rethrow by setting `throwOnSignOutError`.
   */
  signOut: () => Promise<unknown> | unknown;
  throwOnSignOutError?: boolean;
}

export interface SignOutAndClearAthenaSessionResult {
  clearedCookies: string[];
  signOutError: unknown | null;
}

/**
 * Sign out, clear Athena/Better Auth cookies, optionally clear the app-host
 * session bridge cookie, then optionally hard-redirect.
 *
 * Prefer this over per-app `try/finally` copy-paste of clear + redirect.
 *
 * @example
 * ```ts
 * import { signOutAndClearAthenaSession } from "@xylex-group/athena/utils"
 * import { clearAthenaAuthSessionOnAppHost } from "@xylex-group/athena/next/client"
 *
 * await signOutAndClearAthenaSession({
 *   signOut: () => authClient.signOut({ fetchOptions: { throw: true } }),
 *   clearBridge: () => clearAthenaAuthSessionOnAppHost(),
 *   redirectTo: "/sign-in",
 * })
 * ```
 */
export async function signOutAndClearAthenaSession(
  options: SignOutAndClearAthenaSessionOptions
): Promise<SignOutAndClearAthenaSessionResult> {
  let signOutError: unknown | null = null;
  try {
    await options.signOut();
  } catch (error) {
    signOutError = error;
    if (options.throwOnSignOutError) {
      throw error;
    }
  }

  const clearedCookies = clearAuthCookies(options.clearCookieOptions);

  if (options.clearBridge) {
    try {
      await options.clearBridge();
    } catch {
      // Bridge clear is best-effort after cookies are wiped.
    }
  }

  const redirectTo = options.redirectTo?.trim();
  if (redirectTo && options.hardRedirect !== false) {
    try {
      const location = (
        globalThis as {
          window?: { location?: { href: string } };
        }
      ).window?.location;
      if (location) {
        location.href = redirectTo;
      }
    } catch {
      // Non-browser runtimes have no navigation surface.
    }
  }

  return { clearedCookies, signOutError };
}

export function clearAuthCookies(
  options: ClearAuthCookiesOptions = {}
): string[] {
  const cookieStore = getCookieStore();
  if (!cookieStore) {
    return [];
  }

  const cookieHeader = options.cookieHeader ?? cookieStore.cookie;
  if (!cookieHeader?.trim()) {
    return [];
  }

  const prefixes = options.prefixes?.length
    ? options.prefixes
    : [...ATHENA_AUTH_COOKIE_PREFIXES];
  const cookieNames = extractCookieNames(cookieHeader);
  const namesToClear = cookieNames.filter((name) =>
    prefixes.some((prefix) => name.startsWith(prefix))
  );
  if (namesToClear.length === 0) {
    return [];
  }

  const path = options.path?.trim() || "/";
  const hostname = options.hostname ?? getRuntimeHostname();
  const domainCandidates = buildCookieDomainCandidates(hostname);

  for (const name of namesToClear) {
    writeExpiredCookie(cookieStore, name, path);
    for (const domain of domainCandidates) {
      writeExpiredCookie(cookieStore, name, path, domain);
    }
  }

  return namesToClear;
}
