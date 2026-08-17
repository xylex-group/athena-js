import type { JWTPayload, JWTVerifyOptions, JWTVerifyResult } from "jose";
import { createLocalJWKSet, jwtVerify } from "jose";
import { shouldRefetchCachedJwksWithoutKid } from "./cache.ts";
import { getJwksForVerification } from "./get-jwks.ts";
import type { JwksFetchOptions } from "./types.ts";

/**
 * Performs local verification of an access token for your APIs.
 */
export async function verifyJwsAccessToken(
  token: string,
  opts: JwksFetchOptions & {
    verifyOptions: JWTVerifyOptions &
      Required<Pick<JWTVerifyOptions, "audience" | "issuer">>;
  }
) {
  try {
    const resolved = await getJwksForVerification(token, opts);
    let jwt: JWTVerifyResult<JWTPayload>;
    try {
      jwt = await jwtVerify<JWTPayload>(
        token,
        createLocalJWKSet(resolved.jwks),
        opts.verifyOptions
      );
    } catch (error) {
      if (shouldRefetchCachedJwksWithoutKid(error, resolved)) {
        const refreshed = await getJwksForVerification(token, {
          ...opts,
          forceRefresh: true,
        });
        jwt = await jwtVerify<JWTPayload>(
          token,
          createLocalJWKSet(refreshed.jwks),
          opts.verifyOptions
        );
      } else {
        throw error;
      }
    }
    // Return the JWT payload in introspection format (RFC 7662 §2.2)
    if (jwt.payload.azp) {
      jwt.payload.client_id = jwt.payload.azp;
    }
    return jwt.payload;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error), { cause: error });
  }
}
