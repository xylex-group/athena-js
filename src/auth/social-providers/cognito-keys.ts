import { logger } from "../env/index.ts";
import { getJwksPublicKey } from "./helpers/get-jwks-public-key.ts";

/**
 * Fetch the Cognito User Pool JWKS and import the key for `kid`.
 *
 * @param kid - JWT header key id
 * @param region - AWS region of the pool (e.g. `us-east-1`)
 * @param userPoolId - Cognito User Pool id
 */
export const getCognitoPublicKey = async (
  kid: string,
  region: string,
  userPoolId: string
) => {
  const jwksUri = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  try {
    return await getJwksPublicKey(jwksUri, kid);
  } catch (error) {
    logger.error("Failed to fetch Cognito public key:", error);
    throw error;
  }
};
