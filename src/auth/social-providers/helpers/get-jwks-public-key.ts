import { importJWK } from "jose";
import { APIError } from "../../error.ts";
import { athenaFetch } from "../../fetch.ts";

/** Minimal JWK fields used when selecting a key from a JWKS document. */
export interface JwkLike {
  alg: string;
  e?: string;
  kid: string;
  kty: string;
  n?: string;
  use?: string;
  x5c?: string[];
  x5t?: string;
  [key: string]: unknown;
}

/**
 * Fetch a JWKS document, find the key by `kid`, and import it for JWT verify.
 *
 * Shared by Apple, Google, Microsoft, Cognito, PayPal, and other OIDC providers
 * that publish RSA/EC public keys at a well-known JWKS URL.
 *
 * @param jwksUrl - Absolute URL of the provider JWKS (`/.well-known/jwks.json` or equivalent)
 * @param kid - Key id from the JWT protected header
 * @returns Key material suitable for `jose` `jwtVerify`
 * @throws {APIError} When the JWKS response has no `keys` array
 * @throws {Error} When no key matches `kid`
 */
export async function getJwksPublicKey(
  jwksUrl: string,
  kid: string
): Promise<Awaited<ReturnType<typeof importJWK>>> {
  const { data } = await athenaFetch<{ keys: JwkLike[] }>(jwksUrl);

  if (!data?.keys) {
    throw new APIError("BAD_REQUEST", {
      message: "Keys not found",
    });
  }

  const jwk = data.keys.find((key) => key.kid === kid);
  if (!jwk) {
    throw new Error(`JWK with kid ${kid} not found`);
  }

  return await importJWK(jwk, jwk.alg);
}
