/**
 * Athena Auth session cookie bridge for Next.js and Web Fetch runtimes.
 *
 * ## Problem
 *
 * When the browser signs in on an Athena Auth origin that differs from your
 * Next.js app origin, middleware and Server Components on the **app** host
 * cannot read the auth host cookie. This module exposes a small same-origin
 * bridge route that stores the session token as an httpOnly cookie on the app
 * host.
 *
 * ## Entrypoints
 *
 * - Route handlers: `@xylex-group/athena/next/server`
 * - Browser helpers: `@xylex-group/athena/next/client`
 *
 * ## Quick mount
 *
 * ```ts
 * // app/api/athena-auth/session/route.ts
 * import { createAthenaAuthSessionBridgeHandlers } from '@xylex-group/athena/next/server'
 * export const { POST, DELETE } = createAthenaAuthSessionBridgeHandlers()
 * ```
 *
 * @module session-bridge
 * @see docs/auth-session-bridge.md
 * @see README.md
 */

export {
  type AthenaAuthSessionBridgeClientOptions,
  clearAthenaAuthSessionOnAppHost,
  persistAthenaAuthSessionOnAppHost,
} from "./client.ts";
export {
  ATHENA_AUTH_SESSION_BRIDGE_ROUTE,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  ATHENA_AUTH_SESSION_COOKIE_NAMES,
} from "./constants.ts";
export {
  createAthenaAuthSessionBridgeHandlers,
  createAthenaAuthSessionBridgePathHandlers,
  handleAthenaAuthSessionBridgeDelete,
  handleAthenaAuthSessionBridgePost,
  isAthenaAuthSessionBridgePath,
} from "./handlers.ts";
export { resolveSessionBridgePayload } from "./payload.ts";
export type {
  AthenaAuthSessionBridgeOptions,
  AthenaAuthSessionBridgePathOptions,
  AthenaAuthSessionBridgePayload,
  AthenaAuthSessionBridgeSource,
} from "./types.ts";
