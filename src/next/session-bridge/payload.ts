import type {
  AthenaAuthSessionBridgePayload,
  AthenaAuthSessionBridgeSource,
} from "./types.ts";

/**
 * Extract a bridge payload from a session response envelope.
 *
 * Preference order for the token:
 * 1. `payload.session.token`
 * 2. `payload.token`
 *
 * Returns `null` when no non-empty token string is available after trim.
 *
 * @param payload - Result of `auth.getSession()` data or a compatible object
 * @returns Payload suitable for bridge `POST`, or `null`
 *
 * @example
 * ```ts
 * const { data, ok } = await client.auth.getSession()
 * if (ok) {
 *   await persistAthenaAuthSessionOnAppHost(resolveSessionBridgePayload(data))
 * }
 * ```
 */
export function resolveSessionBridgePayload(
  payload: AthenaAuthSessionBridgeSource | null | undefined
): AthenaAuthSessionBridgePayload | null {
  const token = payload?.session?.token ?? payload?.token;

  if (typeof token !== "string") {
    return null;
  }

  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return null;
  }

  return {
    expiresAt:
      typeof payload?.session?.expiresAt === "string"
        ? payload.session.expiresAt
        : undefined,
    token: normalizedToken,
  };
}
