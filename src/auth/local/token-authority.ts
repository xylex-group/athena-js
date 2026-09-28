import type { AthenaTokenAuthority } from "./athena-token-authority.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import type { TokenKeyStore } from "./token-key-store.ts";

const JWKS_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=300";

export interface LocalTokenAuthority {
  handle(
    path: string,
    method: string,
    request: Request,
    session: { session: AuthSessionRow; user: AuthUserRow } | null
  ): Promise<Response | undefined>;
}

export function buildOidcDiscoveryDocument(input: {
  issuer: string;
  jwksUri: string;
  tokenEndpoint: string;
}): {
  issuer: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  token_endpoint: string;
} {
  return {
    issuer: input.issuer,
    jwks_uri: input.jwksUri,
    response_types_supported: [],
    subject_types_supported: ["public"],
    token_endpoint: input.tokenEndpoint,
  };
}

export async function createLocalTokenAuthority(options: {
  audiences?: string[];
  signing: AthenaTokenAuthority;
  tokenEndpoint: string;
}): Promise<LocalTokenAuthority> {
  const allowlist = options.audiences ?? [];
  const identity = options.signing.identity;

  return {
    async handle(path, method, request, session) {
      if (path === "/.well-known/jwks.json" && method === "GET") {
        const headers = new Headers({
          "cache-control": JWKS_CACHE_CONTROL,
        });
        return jsonResponse(200, await options.signing.getJwks(), headers);
      }
      if (path === "/.well-known/openid-configuration" && method === "GET") {
        return jsonResponse(
          200,
          buildOidcDiscoveryDocument({
            issuer: identity.issuer,
            jwksUri: identity.jwksUri,
            tokenEndpoint: options.tokenEndpoint,
          })
        );
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
        const signed = await options.signing.signSessionToken({
          audiences,
          session: session.session,
          ttl,
          user: session.user,
        });
        return jsonResponse(200, {
          audience: audiences,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
          expiresIn: ttl,
          issuer: identity.issuer,
          kid: signed.kid,
          token: signed.token,
          tokenType: "Bearer",
        });
      }
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

export type { TokenKeyStore };
