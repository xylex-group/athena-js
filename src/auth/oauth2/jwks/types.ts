import type { JSONWebKeySet } from "jose";

export interface JwksCacheEntry {
  fetchedAt: number;
  jwks: JSONWebKeySet;
  noKidRefetchedAt?: number | undefined;
}

export interface JwksFetchOptions {
  /**
   * Stable object to cache the result of a function `jwksFetch` under,
   * with the same TTL and kid-miss refetch rules as string sources.
   * Without it, a function source is fetched on every verification.
   */
  jwksCacheKey?: object;
  /** Jwks url or promise of a Jwks */
  jwksFetch: string | (() => Promise<JSONWebKeySet | undefined>);
}

export interface ResolvedJwks {
  fromCache: boolean;
  jwks: JSONWebKeySet;
  kid: string | undefined;
  noKidRefetchedAt?: number | undefined;
}

export interface VerifyAccessTokenRemote {
  /**
   * Accept introspection responses that omit the `aud` claim even when a
   * required `audience` is configured in `verifyOptions`.
   *
   * @default false
   */
  allowMissingAudience?: boolean;
  clientId: string;
  clientSecret: string;
  /**
   * Forces remote verification of a token.
   * This ensures attached session (if applicable) is also still active.
   */
  force?: boolean;
  /** Full url of the introspect endpoint. Should end with `/oauth2/introspect` */
  introspectUrl: string;
}
