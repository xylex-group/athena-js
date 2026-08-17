import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

import { jsonResponse } from "./errors.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";

const JWKS_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=300";

export interface LocalTokenAuthority {
  handle(
    path: string,
    method: string,
    request: Request,
    session: { session: AuthSessionRow; user: AuthUserRow } | null
  ): Promise<Response | undefined>;
}

export async function createLocalTokenAuthority(options: {
  audiences?: string[];
  issuer: string;
  tokenEndpoint: string;
}): Promise<LocalTokenAuthority> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const kid = `athena-local-${new Date().toISOString().slice(0, 10)}`;
  const jwk = await exportJWK(publicKey);
  const publicJwk: JWK = {
    ...jwk,
    alg: "ES256",
    kid,
    use: "sig",
  };
  const allowlist = options.audiences ?? [];

  return {
    async handle(path, method, request, session) {
      if (path === "/.well-known/jwks.json" && method === "GET") {
        const headers = new Headers({
          "cache-control": JWKS_CACHE_CONTROL,
        });
        return jsonResponse(200, { keys: [publicJwk] }, headers);
      }
      if (path === "/.well-known/openid-configuration" && method === "GET") {
        return jsonResponse(200, {
          id_token_signing_alg_values_supported: ["ES256"],
          issuer: options.issuer,
          jwks_uri: `${options.issuer}/.well-known/jwks.json`,
          response_types_supported: [],
          subject_types_supported: ["public"],
          token_endpoint: options.tokenEndpoint,
        });
      }
      if (
        (path === "/token" ||
          path === "/get-access-token" ||
          path === "/refresh-token") &&
        method === "POST"
      ) {
        if (!session) {
          throw AthenaAuthRuntimeError.unauthenticated();
        }
        if (session.user.banned) {
          throw AthenaAuthRuntimeError.forbidden("User is banned");
        }
        const body = (await request.json().catch(() => ({}))) as {
          audience?: string | string[];
          expiresIn?: number;
        };
        const requested = normalizeAudiences(body.audience);
        const audiences =
          requested.length > 0 ? requested : allowlist.slice(0, 1);
        if (audiences.length === 0) {
          throw AthenaAuthRuntimeError.badRequest("audience is required");
        }
        if (allowlist.length > 0) {
          for (const audience of audiences) {
            if (!allowlist.includes(audience)) {
              throw AthenaAuthRuntimeError.forbidden(
                `audience ${audience} is not in the configured allowlist`
              );
            }
          }
        }
        const ttl = Math.min(Math.max(body.expiresIn ?? 900, 1), 3600);
        const token = await signSessionJwt({
          audiences,
          issuer: options.issuer,
          kid,
          privateKey,
          session: session.session,
          ttl,
          user: session.user,
        });
        return jsonResponse(200, {
          audience: audiences,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
          expiresIn: ttl,
          issuer: options.issuer,
          kid,
          token,
          tokenType: "Bearer",
        });
      }
      return undefined;
    },
  };
}

function normalizeAudiences(audience: string | string[] | undefined): string[] {
  if (audience == null) {
    return [];
  }
  return (Array.isArray(audience) ? audience : [audience])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function signSessionJwt(input: {
  audiences: string[];
  issuer: string;
  kid: string;
  privateKey: CryptoKey;
  session: AuthSessionRow;
  ttl: number;
  user: AuthUserRow;
}): Promise<string> {
  return new SignJWT({
    sid: input.session.id,
  })
    .setProtectedHeader({ alg: "ES256", kid: input.kid, typ: "JWT" })
    .setIssuer(input.issuer)
    .setSubject(input.user.id)
    .setAudience(input.audiences)
    .setIssuedAt()
    .setNotBefore(0)
    .setExpirationTime(`${input.ttl}s`)
    .setJti(crypto.randomUUID())
    .sign(input.privateKey);
}