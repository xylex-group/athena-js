import { getJwksPublicKey } from "./helpers/get-jwks-public-key.ts";

export const getGooglePublicKey = async (kid: string) =>
  getJwksPublicKey("https://www.googleapis.com/oauth2/v3/certs", kid);
