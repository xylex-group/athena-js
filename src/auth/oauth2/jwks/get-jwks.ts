import type { ProtectedHeaderParameters } from "jose";
import { decodeProtectedHeader } from "jose";
import { functionJwksCache, getFreshJwksWithKid, jwksCache } from "./cache.ts";
import { fetchJwks } from "./fetch-jwks.ts";
import type { JwksFetchOptions, ResolvedJwks } from "./types.ts";

export async function getJwksForVerification(
  token: string,
  opts: JwksFetchOptions & { forceRefresh?: boolean }
): Promise<ResolvedJwks> {
  let jwtHeaders: ProtectedHeaderParameters | undefined;
  try {
    jwtHeaders = decodeProtectedHeader(token);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error), { cause: error });
  }

  const kid = jwtHeaders.kid;

  if (typeof opts.jwksFetch !== "string") {
    const cacheKey = opts.jwksCacheKey;
    if (!cacheKey) {
      const jwks = await opts.jwksFetch();
      if (!jwks) {
        throw new Error("No jwks found");
      }
      return { fromCache: false, jwks, kid };
    }
    const cached = functionJwksCache.get(cacheKey);
    const cachedJwks = opts.forceRefresh
      ? undefined
      : getFreshJwksWithKid(cached, kid);
    if (cachedJwks) {
      return {
        fromCache: true,
        jwks: cachedJwks,
        kid,
        noKidRefetchedAt: cached?.noKidRefetchedAt,
      };
    }
    const jwks = await opts.jwksFetch();
    if (!jwks) {
      throw new Error("No jwks found");
    }
    const fetchedAt = Date.now();
    functionJwksCache.set(cacheKey, {
      fetchedAt,
      jwks,
      ...(opts.forceRefresh && !kid ? { noKidRefetchedAt: fetchedAt } : {}),
    });
    return { fromCache: false, jwks, kid };
  }

  const cacheKey = opts.jwksFetch;
  const cached = jwksCache.get(cacheKey);
  const cachedJwks = opts.forceRefresh
    ? undefined
    : getFreshJwksWithKid(cached, kid);
  if (!cachedJwks) {
    const jwks = await fetchJwks(opts.jwksFetch);
    const fetchedAt = Date.now();
    jwksCache.set(cacheKey, {
      fetchedAt,
      jwks,
      ...(opts.forceRefresh && !kid ? { noKidRefetchedAt: fetchedAt } : {}),
    });
    return { fromCache: false, jwks, kid };
  }

  return {
    fromCache: true,
    jwks: cachedJwks,
    kid,
    noKidRefetchedAt: cached?.noKidRefetchedAt,
  };
}

export async function getJwks(token: string, opts: JwksFetchOptions) {
  return (await getJwksForVerification(token, opts)).jwks;
}
