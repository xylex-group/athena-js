/**
 * EXAMPLE: App-host session cookie bridge (cross-origin auth → app cookie).
 *
 * Server route (App Router):
 *
 * ```ts
 * // app/api/athena-auth/session/route.ts
 * export { POST, DELETE } from './session-bridge' // or:
 * import { createExampleSessionBridgeHandlers } from './session-bridge'
 * export const { POST, DELETE } = createExampleSessionBridgeHandlers()
 * ```
 *
 * Browser after login:
 *
 * ```ts
 * const { data, ok } = await athena.auth.getSession()
 * if (ok) {
 *   await persistExampleSessionOnAppHost(
 *     resolveExampleSessionBridgePayload(data)
 *   )
 * }
 * ```
 *
 * @see docs/auth-session-bridge.md
 */
import {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  type AthenaAuthSessionBridgeOptions,
  type AthenaAuthSessionBridgePathOptions,
  type AthenaAuthSessionBridgePayload,
  type AthenaAuthSessionBridgeSource,
  clearAthenaAuthSessionOnAppHost,
  createAthenaAuthSessionBridgeHandlers,
  createAthenaAuthSessionBridgePathHandlers,
  persistAthenaAuthSessionOnAppHost,
  resolveSessionBridgePayload,
} from "@xylex-group/athena/next/server";

/** Default bridge route constant — keep app routes in sync with this. */
export const EXAMPLE_SESSION_BRIDGE_ROUTE = ATHENA_AUTH_SESSION_BRIDGE_ROUTE;

/** Default httpOnly cookie name written by the bridge. */
export const EXAMPLE_SESSION_BRIDGE_COOKIE = ATHENA_AUTH_SESSION_COOKIE_NAME;

/**
 * Drop-in App Router handlers for `/api/athena-auth/session`.
 */
export function createExampleSessionBridgeHandlers(
  options?: AthenaAuthSessionBridgeOptions
) {
  return createAthenaAuthSessionBridgeHandlers(options);
}

/**
 * Catch-all mount under `/api/auth/[...path]` that only services `session`.
 */
export function createExampleSessionBridgePathHandlers(
  options?: AthenaAuthSessionBridgePathOptions
) {
  return createAthenaAuthSessionBridgePathHandlers({
    route: "/api/auth/session",
    ...options,
  });
}

/**
 * Extract `{ token, expiresAt? }` from `auth.getSession()` data for POST body.
 */
export function resolveExampleSessionBridgePayload(
  source: AthenaAuthSessionBridgeSource | null | undefined
): AthenaAuthSessionBridgePayload | null {
  return resolveSessionBridgePayload(source);
}

/**
 * Browser helper: POST payload to the app-host bridge (no-op off-window / SSR).
 */
export async function persistExampleSessionOnAppHost(
  payload: AthenaAuthSessionBridgePayload | null
): Promise<void> {
  if (!payload) {
    return;
  }
  await persistAthenaAuthSessionOnAppHost(payload);
}

/** Browser helper: DELETE bridge cookie variants (no-op off-window / SSR). */
export async function clearExampleSessionOnAppHost(): Promise<void> {
  await clearAthenaAuthSessionOnAppHost();
}

/**
 * Build a Request for unit-testing the POST handler without a real browser.
 */
export function createExampleBridgePostRequest(
  body: { token?: string; expiresAt?: string },
  url = `https://app.example.com${EXAMPLE_SESSION_BRIDGE_ROUTE}`
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
