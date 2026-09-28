import { generateCodeChallenge } from "../oauth2/pkce.ts";
import { OAuthProtocolError } from "./errors.ts";

const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function assertS256CodeChallenge(
  codeChallenge: string,
  codeChallengeMethod: string
): void {
  if (codeChallengeMethod !== "S256") {
    throw new OAuthProtocolError(
      "invalid_request",
      "code_challenge_method must be S256"
    );
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw new OAuthProtocolError(
      "invalid_request",
      "code_challenge must be a valid base64url value"
    );
  }
}

export function assertCodeVerifier(codeVerifier: string): void {
  if (!CODE_VERIFIER_PATTERN.test(codeVerifier)) {
    throw new OAuthProtocolError(
      "invalid_grant",
      "The code verifier is invalid."
    );
  }
}

export async function verifyCodeVerifier(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: string
): Promise<void> {
  assertCodeVerifier(codeVerifier);
  if (codeChallengeMethod !== "S256") {
    throw new OAuthProtocolError(
      "invalid_grant",
      "The authorization code does not support the requested PKCE method."
    );
  }
  const computed = await generateCodeChallenge(codeVerifier);
  if (computed !== codeChallenge) {
    throw new OAuthProtocolError(
      "invalid_grant",
      "The authorization code is invalid or expired."
    );
  }
}
