import {
  decodeProtectedHeader,
  importJWK,
  type JWTPayload,
  jwtVerify,
} from "jose";
import type {
  OAuthAccessTokenClaims,
  OAuthAuthorizationGrant,
  OAuthClient,
  VerifiedOAuthAccessToken,
} from "../../auth/authorization-server/types.ts";
import type { AthenaTokenAuthority } from "../../auth/local/athena-token-authority.ts";
import type { OAuthAuthorizationServerStores } from "../../auth/local/authorization-server/store.ts";
import type { AuthClock } from "../../auth/local/clock.ts";
import { systemAuthClock } from "../../auth/local/clock.ts";
import type { TokenKeyStore } from "../../auth/local/token-key-store.ts";
import type {
  AthenaPrincipal,
  AthenaResolvedPrincipal,
  AthenaRuntimeJwtVerifier,
} from "../data/principal.ts";

export interface OAuthAccessTokenPrincipalInput {
  claims: OAuthAccessTokenClaims;
  client: OAuthClient;
  grant: OAuthAuthorizationGrant;
  organizationId: string | null;
  resource: string;
  scopes: readonly string[];
  userId: string;
}

export interface CreateOAuthAccessTokenVerifierOptions {
  clock?: AuthClock;
  issuer: string;
  keyStore: TokenKeyStore;
  resolvePrincipal: (
    input: OAuthAccessTokenPrincipalInput
  ) => Promise<AthenaPrincipal | null> | AthenaPrincipal | null;
  signing?: AthenaTokenAuthority;
  stores: OAuthAuthorizationServerStores;
}

type VerifiedOAuthAccessTokenWithPrincipal = VerifiedOAuthAccessToken & {
  principal: AthenaPrincipal;
};

function accessTokenClaims(payload: JWTPayload): OAuthAccessTokenClaims | null {
  if (
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.aud !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.client_id !== "string" ||
    typeof payload.athena_grant_id !== "string" ||
    typeof payload.scope !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.nbf !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  const organization =
    typeof payload.athena_organization_id === "string"
      ? payload.athena_organization_id
      : undefined;
  const family =
    typeof payload.athena_token_family_id === "string"
      ? payload.athena_token_family_id
      : undefined;
  const identityScopes = payload.athena_identity_scopes;
  const allowedIdentityScopes = new Set(["openid", "profile", "email"]);
  if (
    identityScopes != null &&
    (!Array.isArray(identityScopes) ||
      identityScopes.some(
        (scope) => typeof scope !== "string" || !allowedIdentityScopes.has(scope)
      ))
  ) {
    return null;
  }
  return {
    athena_grant_id: payload.athena_grant_id,
    aud: payload.aud,
    ...(Array.isArray(identityScopes)
      ? { athena_identity_scopes: identityScopes as OAuthAccessTokenClaims["athena_identity_scopes"] }
      : {}),
    ...(organization ? { athena_organization_id: organization } : {}),
    ...(family ? { athena_token_family_id: family } : {}),
    client_id: payload.client_id,
    exp: payload.exp,
    iat: payload.iat,
    iss: payload.iss,
    jti: payload.jti,
    nbf: payload.nbf,
    scope: payload.scope,
    sub: payload.sub,
  };
}

export function createOAuthAccessTokenVerifier(
  options: CreateOAuthAccessTokenVerifierOptions
): (input: {
  resource: string;
  token: string;
}) => Promise<VerifiedOAuthAccessTokenWithPrincipal> {
  return async ({ resource, token }) => {
    const now = options.clock ?? systemAuthClock;
    const payload = options.signing
      ? await options.signing.verifyAthenaToken({
        audience: resource,
        token,
      })
      : await verifyWithKeyStore(options, token, resource, now.now());
    const claims = accessTokenClaims(payload);
    if (!claims || claims.aud !== resource) {
      throw new Error("OAuth access token claims are invalid");
    }
    if (await options.stores.accessTokens.isRevoked(claims.jti)) {
      throw new Error("OAuth access token has been revoked");
    }
    const client = await options.stores.clients.get(claims.client_id);
    const grant = await options.stores.grants.get(claims.athena_grant_id);
    if (
      !(client?.isActive && grant) ||
      grant.status !== "active" ||
      (grant.expiresAt !== null &&
        grant.expiresAt.getTime() <= now.now().getTime()) ||
      grant.revokedAt !== null ||
      grant.userId !== claims.sub ||
      grant.clientId !== client.id ||
      grant.resource !== resource
    ) {
      throw new Error("OAuth access token grant is no longer active");
    }
    const scopes = claims.scope.split(" ").filter(Boolean).sort();
    if (scopes.some((scope) => !grant.scopes.includes(scope))) {
      throw new Error("OAuth access token scope exceeds its grant");
    }
    const organizationId = grant.organizationId;
    if ((claims.athena_organization_id ?? null) !== organizationId) {
      throw new Error("OAuth access token organization is invalid");
    }
    const principal = await options.resolvePrincipal({
      claims,
      client,
      grant,
      organizationId,
      resource,
      scopes,
      userId: claims.sub,
    });
    if (!principal) {
      throw new Error("OAuth access token subject is not eligible");
    }
    return {
      claims,
      client,
      grant,
      organizationId,
      principal,
      resource,
      scopes,
      userId: claims.sub,
    };
  };
}

async function verifyWithKeyStore(
  options: CreateOAuthAccessTokenVerifierOptions,
  token: string,
  resource: string,
  now: Date
): Promise<JWTPayload> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "ES256" || typeof header.kid !== "string") {
    throw new Error("OAuth access token algorithm or kid is invalid");
  }
  const keys = await options.keyStore.listVerificationKeys(now);
  const key = keys.find((entry) => entry.kid === header.kid);
  if (!key) {
    throw new Error("OAuth access token signing key is unknown");
  }
  const cryptoKey = await importJWK(key.publicJwk, "ES256");
  return (
    await jwtVerify(token, cryptoKey, {
      algorithms: ["ES256"],
      audience: resource,
      currentDate: now,
      issuer: options.issuer,
    })
  ).payload;
}

export function asJwtPrincipalVerifier(
  verifier: ReturnType<typeof createOAuthAccessTokenVerifier>,
  resource: string
): (input: {
  headers: Headers;
  request?: Request;
  requestId?: string;
}) => Promise<AthenaResolvedPrincipal | null> {
  return async (input) => {
    const authorization = input.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === authorization) {
      return null;
    }
    const verified = await verifier({ resource, token });
    return { authority: "jwt", principal: verified.principal };
  };
}

export function createOAuthRuntimeJwtVerifier(
  options: CreateOAuthAccessTokenVerifierOptions & { resource: string }
): AthenaRuntimeJwtVerifier {
  const verifier = createOAuthAccessTokenVerifier(options);
  return asJwtPrincipalVerifier(verifier, options.resource);
}
