import { createRemoteJWKSet, jwtVerify } from "jose";
import { athenaFetch as betterFetch } from "../../fetch.ts";
import type { OAuthProvider } from "../../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../../oauth2/index.ts";
import {
  type ResolvedOidcProviderMetadata,
  resolveOidcProviderEndpoints,
} from "../../oidc-discovery.ts";
import { AthenaSocialServerError } from "./errors.ts";
import type { AthenaAuthSocialProviderOptions } from "./social-config.ts";

export function isGenericOidcProviderOptions(
  options: AthenaAuthSocialProviderOptions
): boolean {
  if (options.issuer?.trim()) {
    return true;
  }
  return Boolean(
    options.authorizationEndpoint?.trim() && options.tokenEndpoint?.trim()
  );
}

function resolveConfiguredIssuer(
  options: AthenaAuthSocialProviderOptions
): string {
  if (options.issuer?.trim()) {
    return options.issuer.trim();
  }
  if (options.authorizationEndpoint?.trim()) {
    try {
      const url = new URL(options.authorizationEndpoint);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }
  throw new AthenaSocialServerError(
    "ATHENA_AUTH_OAUTH_PROVIDER_UNKNOWN",
    "generic social provider requires issuer or authorizationEndpoint"
  );
}

/**
 * Declarative OIDC/OAuth2 provider for configured ids that are not in the
 * built-in `socialProviders` registry (`testProvider`, custom issuers).
 * Endpoint authority is the shared discovery resolver — not synthesized paths.
 */
export function createGenericOidcSocialProvider(
  providerId: string,
  options: AthenaAuthSocialProviderOptions
): OAuthProvider {
  const cache = new Map<string, ResolvedOidcProviderMetadata>();
  const resolveEndpoints = () =>
    resolveOidcProviderEndpoints({
      cache,
      issuer: resolveConfiguredIssuer(options),
      overrides: {
        authorizationEndpoint: options.authorizationEndpoint,
        jwksEndpoint: options.jwksEndpoint,
        tokenEndpoint: options.tokenEndpoint,
        userInfoEndpoint: options.userInfoEndpoint,
      },
    });

  return {
    async createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint,
      display,
    }) {
      const endpoints = await resolveEndpoints();
      const resolvedScopes = options.scope?.length
        ? [...options.scope]
        : ["openid", "profile", "email"];
      if (scopes) {
        resolvedScopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: endpoints.authorizationEndpoint,
        codeVerifier,
        display,
        id: providerId,
        loginHint,
        options: {
          clientId: options.clientId,
          clientSecret: options.clientSecret,
        },
        redirectURI,
        scopes: resolvedScopes,
        state,
      });
    },
    async getUserInfo(token) {
      if (!token.accessToken) {
        return null;
      }
      const endpoints = await resolveEndpoints();
      if (!endpoints.userinfoEndpoint) {
        return null;
      }
      const { data: profile, error } = await betterFetch<
        Record<string, unknown>
      >(endpoints.userinfoEndpoint, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token.accessToken}`,
          "User-Agent": "athena-auth",
        },
      });
      if (error || !profile) {
        return null;
      }
      const sub = profile.sub ?? profile.id;
      if (sub === undefined || sub === null || String(sub).length === 0) {
        return null;
      }
      return {
        data: profile,
        user: {
          email: typeof profile.email === "string" ? profile.email : undefined,
          emailVerified: profile.email_verified === true,
          id: String(sub),
          image:
            typeof profile.picture === "string" ? profile.picture : undefined,
          name: typeof profile.name === "string" ? profile.name : undefined,
        },
      };
    },
    id: providerId,
    name: providerId,
    options: {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    },
    refreshAccessToken: async (refreshToken: string) => {
      const endpoints = await resolveEndpoints();
      return refreshAccessToken({
        options: {
          clientId: options.clientId,
          clientSecret: options.clientSecret,
        },
        refreshToken,
        tokenEndpoint: endpoints.tokenEndpoint,
      });
    },
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
      const endpoints = await resolveEndpoints();
      return validateAuthorizationCode({
        code,
        codeVerifier,
        options: {
          clientId: options.clientId,
          clientSecret: options.clientSecret,
        },
        redirectURI,
        tokenEndpoint: endpoints.tokenEndpoint,
      });
    },
    verifyIdToken: async (token: string, nonce?: string) => {
      try {
        const endpoints = await resolveEndpoints();
        if (!endpoints.jwksUri) {
          return false;
        }
        const jwks = createRemoteJWKSet(new URL(endpoints.jwksUri));
        const { payload } = await jwtVerify(token, jwks, {
          audience: options.clientId,
          issuer: endpoints.issuer,
        });
        if (nonce && payload.nonce !== nonce) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
