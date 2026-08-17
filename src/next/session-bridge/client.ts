import { ATHENA_AUTH_SESSION_BRIDGE_ROUTE } from "./constants.ts";
import type { AthenaAuthSessionBridgePayload } from "./types.ts";

const JSON_CONTENT_TYPE = "application/json";

/**
 * `true` when a DOM `window` global is present (browser / browser-like).
 * Used to no-op client helpers during SSR.
 */
function isBrowserRuntime(): boolean {
  // Require a real window object. `"window" in globalThis` stays true after
  // tests assign `window = undefined`, which incorrectly looked browser-like.
  const win = (globalThis as { window?: unknown }).window;
  return typeof win === "object" && win !== null;
}

/**
 * Options for browser-side bridge fetch helpers.
 */
export interface AthenaAuthSessionBridgeClientOptions {
  /**
   * Optional fetch implementation (defaults to global `fetch`).
   * Useful in tests.
   */
  fetch?: typeof fetch | undefined;
  /**
   * Bridge route on the app host.
   *
   * @defaultValue {@link ATHENA_AUTH_SESSION_BRIDGE_ROUTE}
   */
  route?: string | undefined;
}

/**
 * Persist an Athena Auth session token on the app host via the bridge `POST` route.
 *
 * Sends a same-origin JSON POST with `credentials: "same-origin"`. No-ops when
 * `payload` is null/undefined or when not running in a browser.
 *
 * @param payload - Token (+ optional expiry) from {@link resolveSessionBridgePayload}
 * @param options - Route override and fetch implementation
 * @throws {Error} When the bridge responds with a non-OK status
 *
 * @example
 * ```ts
 * await persistAthenaAuthSessionOnAppHost({
 *   token: session.session.token,
 *   expiresAt: session.session.expiresAt,
 * })
 * ```
 */
export async function persistAthenaAuthSessionOnAppHost(
  payload: AthenaAuthSessionBridgePayload | null,
  options?: AthenaAuthSessionBridgeClientOptions
): Promise<void> {
  if (!(payload && isBrowserRuntime())) {
    return;
  }

  const route = options?.route ?? ATHENA_AUTH_SESSION_BRIDGE_ROUTE;
  const fetchImpl = options?.fetch ?? fetch;
  const response = await fetchImpl(route, {
    body: JSON.stringify(payload),
    credentials: "same-origin",
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      "Failed to persist the Athena Auth session on the app host"
    );
  }
}

/**
 * Clear the bridged session cookie on the app host via `DELETE`.
 *
 * No-ops outside the browser. Pair with `auth.signOut()` so the app-host
 * cookie does not outlive the auth session.
 *
 * @param options - Route override and fetch implementation
 * @throws {Error} When the bridge responds with a non-OK status
 */
export async function clearAthenaAuthSessionOnAppHost(
  options?: AthenaAuthSessionBridgeClientOptions
): Promise<void> {
  if (!isBrowserRuntime()) {
    return;
  }

  const route = options?.route ?? ATHENA_AUTH_SESSION_BRIDGE_ROUTE;
  const fetchImpl = options?.fetch ?? fetch;
  const response = await fetchImpl(route, {
    credentials: "same-origin",
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to clear the Athena Auth session on the app host");
  }
}
