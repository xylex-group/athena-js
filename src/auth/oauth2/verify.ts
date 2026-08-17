/**
 * Barrel for JWKS / access-token verification helpers.
 * Implementation lives under `./jwks/*`.
 */

export type { VerifyAccessTokenRemote } from "./jwks/index.ts";
export {
  getJwks,
  jwksCache,
  verifyAccessToken,
  verifyJwsAccessToken,
} from "./jwks/index.ts";
