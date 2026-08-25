import { ATHENA_AUTH_SESSION_BRIDGE_ROUTE } from "./constants.ts";
import {
	appendClearSessionCookies,
	appendSessionCookie,
	resolveSessionCookieExpiresAt,
} from "./cookie.ts";
import type {
	AthenaAuthBridgeExchangeInput,
	AthenaAuthBridgeExchangeResult,
	AthenaAuthBridgeHandlerOptions,
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
	},
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
	options?: AthenaAuthSessionBridgeOptions,
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
			{ status: 400 },
		);
	}

	const headers = new Headers();
	appendSessionCookie(
		headers,
		request,
		token,
		resolveSessionCookieExpiresAt(payload?.expiresAt),
		options,
	);

	return json(
		{
			ok: true,
			route: resolveRoute(options),
		},
		{ headers },
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
	options?: AthenaAuthSessionBridgeOptions,
): Response {
	const headers = new Headers();
	appendClearSessionCookies(headers, request, options);

	return json(
		{
			ok: true,
			route: resolveRoute(options),
		},
		{ headers },
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
	options?: AthenaAuthSessionBridgeOptions,
) {
	return {
		DELETE: (request: Request) =>
			handleAthenaAuthSessionBridgeDelete(request, options),
		POST: (request: Request) =>
			handleAthenaAuthSessionBridgePost(request, options),
	};
}

const DEFAULT_BRIDGE_REDIRECT = "/";

function resolveSafeRedirectTarget(
	rawValue: string | null,
	defaultRedirectTo: string,
): string {
	const trimmed = rawValue?.trim();
	if (!trimmed) {
		return defaultRedirectTo;
	}
	try {
		const url = new URL(trimmed, "http://localhost");
		if (url.origin !== "http://localhost" || !url.pathname.startsWith("/")) {
			return defaultRedirectTo;
		}
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return defaultRedirectTo;
	}
}

/**
 * App-origin GET exchange: `?bridge_code=` → native consume → HttpOnly cookie + 303.
 *
 * The `exchange` callback must call Athena Auth `POST /session/bridge/exchange`
 * (or an equivalent server-side consume). Do not accept a session bearer here.
 */
export async function handleAthenaAuthBridgeGet(
	request: Request,
	options: AthenaAuthBridgeHandlerOptions,
): Promise<Response> {
	const requestUrl = new URL(request.url);
	const code = (
		requestUrl.searchParams.get("bridge_code") ??
		requestUrl.searchParams.get("code") ??
		""
	).trim();
	const redirectTo = resolveSafeRedirectTarget(
		requestUrl.searchParams.get("redirectTo"),
		options.defaultRedirectTo ?? DEFAULT_BRIDGE_REDIRECT,
	);
	const location = new URL(redirectTo, request.url).toString();
	const headers = new Headers({ location });

	if (code) {
		const exchanged: AthenaAuthBridgeExchangeResult | null | undefined =
			await options.exchange({
				code,
				destinationOrigin: requestUrl.origin,
			} satisfies AthenaAuthBridgeExchangeInput);
		const sessionToken = exchanged?.sessionToken.trim() ?? "";
		if (sessionToken) {
			appendSessionCookie(
				headers,
				request,
				sessionToken,
				resolveSessionCookieExpiresAt(exchanged?.expiresAt),
				options,
			);
		}
	}

	return new Response(null, { headers, status: 303 });
}

/**
 * Dedicated App Router handlers for native one-time bridge-code exchange.
 *
 * @example
 * ```ts
 * // app/api/auth/bridge-session/route.ts
 * import { createAthenaAuthBridgeHandlers } from '@xylex-group/athena/next/server'
 *
 * export const { GET } = createAthenaAuthBridgeHandlers({
 *   exchange: async ({ code, destinationOrigin }) => {
 *     const response = await fetch(`${authBaseUrl}/session/bridge/exchange`, {
 *       method: 'POST',
 *       headers: { 'content-type': 'application/json' },
 *       body: JSON.stringify({ code, destinationOrigin }),
 *     })
 *     if (!response.ok) return null
 *     return response.json()
 *   },
 * })
 * ```
 */
export function createAthenaAuthBridgeHandlers(
	options: AthenaAuthBridgeHandlerOptions,
) {
	return {
		GET: (request: Request) => handleAthenaAuthBridgeGet(request, options),
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
	options?: AthenaAuthSessionBridgePathOptions,
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
	options?: AthenaAuthSessionBridgePathOptions,
) {
	const notFound = () =>
		json(
			{
				error: "Not found",
			},
			{ status: 404 },
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
