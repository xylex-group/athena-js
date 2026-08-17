import { getJwksPublicKey } from "./helpers/get-jwks-public-key.ts";

/**
 * Import the Microsoft Entra ID JWKS public key for the given JWT `kid`.
 *
 * @param kid - JWT protected-header key id
 * @param tenant - Tenant id or common/organizations/consumers
 * @param authority - Authority host (no trailing slash), e.g. login.microsoftonline.com
 */
export const getMicrosoftPublicKey = async (
  kid: string,
  tenant: string,
  authority: string
) => getJwksPublicKey(`${authority}/${tenant}/discovery/v2.0/keys`, kid);
