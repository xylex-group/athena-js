/**
 * SHA-256 hex digest of a UTF-8 string (used for Apple nonce comparison).
 * Apple may place either the raw nonce or its SHA-256 hash in the ID token.
 */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Whether the JWT `nonce` claim matches the expected OAuth nonce
 * (raw equality or SHA-256 hex of the original nonce).
 */
export async function nonceMatches(
  jwtNonce: unknown,
  nonce: string
): Promise<boolean> {
  if (typeof jwtNonce !== "string") {
    return false;
  }
  if (jwtNonce === nonce) {
    return true;
  }
  return jwtNonce === (await sha256Hex(nonce));
}
