import type { JWTPayload } from "jose";
import { decodeProtectedHeader, jwtVerify } from "jose";
import { getGooglePublicKey } from "./google-keys.ts";
import {
  GOOGLE_ID_TOKEN_MAX_AGE,
  type VerifyGoogleIdTokenOptions,
} from "./google-types.ts";

/**
 * Verifies a Google ID token against Google's issuer, audience, signature,
 * expiry, and maximum token age.
 */
export const verifyGoogleIdToken = async ({
  token,
  audience,
  nonce,
}: VerifyGoogleIdTokenOptions): Promise<JWTPayload | null> => {
  try {
    const { kid, alg: jwtAlg } = decodeProtectedHeader(token);
    if (!(kid && jwtAlg)) {
      return null;
    }

    const publicKey = await getGooglePublicKey(kid);
    const { payload: jwtClaims } = await jwtVerify(token, publicKey, {
      algorithms: [jwtAlg],
      audience,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      maxTokenAge: GOOGLE_ID_TOKEN_MAX_AGE,
    });

    if (nonce && jwtClaims.nonce !== nonce) {
      return null;
    }

    return jwtClaims;
  } catch {
    return null;
  }
};

/**
 * Checks whether Google's verified `hd` claim satisfies the configured hosted
 * domain restriction. `hd: "*"` accepts any Google Workspace hosted domain.
 */
export const isGoogleHostedDomainAllowed = (
  configuredHostedDomain: string | undefined,
  tokenHostedDomain: unknown
) => {
  if (!configuredHostedDomain) {
    return true;
  }
  if (typeof tokenHostedDomain !== "string" || !tokenHostedDomain) {
    return false;
  }
  if (configuredHostedDomain === "*") {
    return true;
  }
  return tokenHostedDomain === configuredHostedDomain;
};
