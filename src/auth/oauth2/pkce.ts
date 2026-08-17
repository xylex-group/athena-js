import { base64Url } from "../utils/base64.ts";

/**
 * Compute the S256 PKCE `code_challenge` for a given `code_verifier`.
 *
 * Uses Web Crypto `SHA-256` then Base64URL without padding
 * (RFC 7636 §4.2).
 *
 * @param codeVerifier - High-entropy verifier string from the client
 * @returns Base64URL-encoded challenge suitable for the authorize request
 */
export async function generateCodeChallenge(codeVerifier: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64Url.encode(new Uint8Array(hash), {
    padding: false,
  });
}
