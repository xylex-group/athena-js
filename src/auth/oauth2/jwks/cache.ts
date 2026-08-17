import type { JSONWebKeySet } from "jose";
import { errors as joseErrors } from "jose";
import type { JwksCacheEntry, ResolvedJwks } from "./types.ts";

/**
 * @internal URL-keyed JWKS cache.
 */
export const jwksCache = new Map<string, JwksCacheEntry>();

/**
 * Cache for function jwks sources, keyed by a caller-provided stable object.
 */
export const functionJwksCache = new WeakMap<object, JwksCacheEntry>();

/** How long a cached JWKS is trusted before it is refetched. */
export const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
export const JWKS_NO_KID_REFETCH_COOLDOWN_MS = 30 * 1000;

/**
 * Returns the cached key set when it is within the TTL. When the token carries
 * `kid`, the cached set must contain that key id.
 */
export function getFreshJwksWithKid(
  cached: JwksCacheEntry | undefined,
  kid: string | undefined
): JSONWebKeySet | undefined {
  if (!cached) {
    return;
  }
  if (Date.now() - cached.fetchedAt >= JWKS_CACHE_TTL_MS) {
    return;
  }
  if (kid && !cached.jwks.keys.some((jwk) => jwk.kid === kid)) {
    return;
  }
  return cached.jwks;
}

export function shouldRefetchCachedJwksWithoutKid(
  error: unknown,
  resolved: ResolvedJwks
): boolean {
  const isRetryableNoKidFailure =
    resolved.fromCache &&
    !resolved.kid &&
    (error instanceof joseErrors.JWKSNoMatchingKey ||
      error instanceof joseErrors.JWSSignatureVerificationFailed);
  if (!isRetryableNoKidFailure) {
    return false;
  }
  if (!resolved.noKidRefetchedAt) {
    return true;
  }
  return (
    Date.now() - resolved.noKidRefetchedAt >= JWKS_NO_KID_REFETCH_COOLDOWN_MS
  );
}
