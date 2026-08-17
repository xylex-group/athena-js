import { getJwksPublicKey } from "./helpers/get-jwks-public-key.ts";

/**
 * Fetch Apple's JWKS and import the key for the given JWT `kid`.
 * @see https://appleid.apple.com/auth/keys
 */
export const getApplePublicKey = async (kid: string) =>
  getJwksPublicKey("https://appleid.apple.com/auth/keys", kid);
