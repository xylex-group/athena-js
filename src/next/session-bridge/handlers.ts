import { ATHENA_AUTH_SESSION_BRIDGE_ROUTE } from "./constants.ts";
import {
  appendClearSessionCookies,
  appendSessionCookie,
  resolveSessionCookieExpiresAt,
} from "./cookie.ts";
import type {
  AthenaAuthSessionBridgeOptions,
  AthenaAuthSessionBridgePathOptions,
} from "./types.ts";

/** JSON body accepted by the bridge POST handler. */
interface SessionBridgeRequestBody {
  expiresAt?: unknown;
  token?: unknown;
}

/**
 * Build a JSON `Response` with optional extra headers (e.g. Set-Cookie).
 *
 * @internal
 */
function json(
  body: unknown,
  init?: {
    status?: number;
    headers?: Headers;
  }
): Response {
  const headers = init?.headers ?? new Headers();
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), {
    headers,
    status: init?.status ?? 200,
  });
}

function resolveRoute(options?: AthenaAuthSessionBridgeOptions): string {
  return options?.route ?? ATHENA_AUTH_SESSION_BRIDGE_ROUTE;
}

/**
 * Handle bridge `POST` — set an httpOnly session cookie from JSON body.
 *
 * Expected body: `{ "token": string, "expiresAt"?: string }`.
 *
 * @param request - Incoming request (JSON body)
 * @param options - Cookie / route configuration
 * @returns `200` on success, `400` when token is missing
 */
export async function handleAthenaAuthSessionBridgePost(
  request: Request,
  options?: AthenaAuthSessionBridgeOptions
): Promise<Response> {
  const payload = (await request
    .json()
    .catch(() => null)) as SessionBridgeRequestBody | null;
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";

  if (!token) {
    return json(
      {
        error: "Missing Athena Auth session token",
      },
      { status: 400 }
    );
  }

  const headers = new Headers();
  appendSessionCookie(
    headers,
    request,
    token,
    resolveSessionCookieExpiresAt(payload?.expiresAt),
    options
  );

  return json(
    {
      ok: true,
      route: resolveRoute(options),
    },
    { headers }
  );
}

/**
 * Handle bridge `DELETE` — clear bridged session cookie name variants.
 *
 * @param request - Incoming request (used for Secure detection)
 * @param options - Cookie / route configuration
 * @returns `200` with clear `Set-Cookie` headers
 */
export function handleAthenaAuthSessionBridgeDelete(
  request: Request,
  options?: AthenaAuthSessionBridgeOptions
): Response {
  const headers = new Headers();
  appendClearSessionCookies(headers, request, options);

  return json(
    {
      ok: true,
      route: resolveRoute(options),
    },
    { headers }
  );
}

/**
 * Create dedicated App Router handlers for the session bridge.
 *
 * Drop into a route file with no additional wiring:
 *
 * @example
 * ```ts
 * // app/api/athena-auth/session/route.ts
 * import { createAthenaAuthSessionBridgeHandlers } from '@xylex-group/athena/next/server'
 *
 * export const { POST, DELETE } = createAthenaAuthSessionBridgeHandlers()
 * ```
 *
 * @param options - Optional cookie name, path, SameSite, Secure overrides
 * @returns Object with `POST` and `DELETE` route handlers
 */
export function createAthenaAuthSessionBridgeHandlers(
  options?: AthenaAuthSessionBridgeOptions
) {
  return {
    DELETE: (request: Request) =>
      handleAthenaAuthSessionBridgeDelete(request, options),
    POST: (request: Request) =>
      handleAthenaAuthSessionBridgePost(request, options),
  };
}

/**
 * Normalize trailing slashes for path comparison.
 *
 * @internal
 */
function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname || "/";
}

/**
 * Whether this request should be handled as a session bridge call.
 *
 * Returns true when:
 * - the pathname equals the configured `route`, or
 * - the final path segment is listed in `matchPaths` (default `session`)
 *
 * @param request - Incoming request
 * @param options - Route + matchPaths configuration
 */
export function isAthenaAuthSessionBridgePath(
  request: Request,
  options?: AthenaAuthSessionBridgePathOptions
): boolean {
  const pathname = normalizePathname(new URL(request.url).pathname);
  const route = normalizePathname(resolveRoute(options));
  if (pathname === route) {
    return true;
  }

  const matchPaths = options?.matchPaths ?? ["session"];
  const segments = pathname.split("/").filter(Boolean);
  const tail = segments.at(-1);
  return typeof tail === "string" && matchPaths.includes(tail);
}

/**
 * Create catch-all / `[path]` handlers that only service session-bridge paths.
 *
 * Non-matching paths return `404` with `{ error: 'Not found' }` so you can
 * mount under `/api/auth/[...path]` without implementing a full auth proxy.
 *
 * @example
 * ```ts
 * // app/api/auth/[...path]/route.ts
 * import { createAthenaAuthSessionBridgePathHandlers } from '@xylex-group/athena/next/server'
 *
 * export const { POST, DELETE } = createAthenaAuthSessionBridgePathHandlers({
 *   route: '/api/auth/session',
 * })
 * ```
 *
 * @param options - Bridge options plus `matchPaths`
 * @returns Object with `POST` and `DELETE` route handlers
 */
export function createAthenaAuthSessionBridgePathHandlers(
  options?: AthenaAuthSessionBridgePathOptions
) {
  const notFound = () =>
    json(
      {
        error: "Not found",
      },
      { status: 404 }
    );

  return {
    DELETE: (request: Request) => {
      if (!isAthenaAuthSessionBridgePath(request, options)) {
        return notFound();
      }
      return handleAthenaAuthSessionBridgeDelete(request, options);
    },
    POST: async (request: Request) => {
      if (!isAthenaAuthSessionBridgePath(request, options)) {
        return notFound();
      }
      return handleAthenaAuthSessionBridgePost(request, options);
    },
  };
}
