import type { JWK } from "jose";
import { exportJWK, generateKeyPair } from "jose";

export interface OAuthFixtureKeys {
  jwks: { keys: JWK[] };
  privateKey: CryptoKey;
}

export async function createOAuthFixtureKeys(): Promise<OAuthFixtureKeys> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  jwk.alg = "RS256";
  jwk.kid = "oauth-fixture";
  jwk.use = "sig";
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicJwk } = jwk;
  void _d;
  void _p;
  void _q;
  void _dp;
  void _dq;
  void _qi;
  return {
    jwks: { keys: [publicJwk] },
    privateKey: pair.privateKey,
  };
}

export function handleJwks(keys: OAuthFixtureKeys): Response {
  return Response.json(keys.jwks);
}
