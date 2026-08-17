import { getJwksPublicKey } from "./helpers/get-jwks-public-key.ts";

/**
 * Import the PayPal JWKS public key matching `kid` for RS256 ID-token verify.
 *
 * @param kid - Key id from the JWT protected header
 * @param jwksUri - Sandbox or live JWKS endpoint
 */
export const getPayPalPublicKey = async (kid: string, jwksUri: string) =>
  getJwksPublicKey(jwksUri, kid);
