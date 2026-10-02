import { logger } from "../env/index.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";
import {
  type ResolvedOidcProviderMetadata,
  resolveOidcProviderEndpoints,
} from "../oidc-discovery.ts";
import { trimTrailingSlash } from "./helpers/trim-trailing-slash.ts";

/**
 * Standard OIDC-style profile claims returned by an Athena identity provider.
 *
 * Field names follow common OIDC claim names so Athena Auth can stay compatible
 * with generic OIDC clients while remaining first-class in this SDK.
 */
export interface AthenaProfile {
  aud?: string | string[] | undefined;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  exp?: number | undefined;
  family_name?: string | undefined;
  given_name?: string | undefined;
  iat?: number | undefined;
  iss?: string | undefined;
  locale?: string | undefined;
  name?: string | undefined;
  picture?: string | undefined;
  preferred_username?: string | undefined;
  sub: string;
  updated_at?: number | undefined;
  [key: string]: unknown;
}

export interface AthenaOptions extends ProviderOptions<AthenaProfile> {
  /**
   * Override the authorization endpoint. When omitted, Athena discovery
   * supplies `/oauth/authorize`.
   */
  authorizationEndpoint?: string | undefined;
  clientId: string;
  resource?: string | undefined;
  /**
   * Base issuer URL for the Athena identity provider
   * (e.g. `https://auth.example.com` or a tenant-specific auth root).
   *
   * Defaults for authorization, token, userinfo, and JWKS endpoints are
   * derived from validated issuer discovery when the explicit endpoint
   * overrides are omitted.
   */
  issuer?: string | undefined;
  /**
   * Override the token endpoint. When omitted, Athena discovery supplies
   * `/oauth/token`.
   */
  tokenEndpoint?: string | undefined;
  /**
   * Override the userinfo endpoint. UserInfo remains optional for this lane.
   */
  userInfoEndpoint?: string | undefined;
}

function resolveIssuer(options: AthenaOptions): string {
  if (options.issuer) {
    return trimTrailingSlash(options.issuer);
  }
  if (options.authorizationEndpoint) {
    try {
      const url = new URL(options.authorizationEndpoint);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }
  throw new Error(
    "Athena social provider requires `issuer` (or a full `authorizationEndpoint`) in options."
  );
}

/**
 * Athena first-party OAuth / OIDC social provider factory.
 *
 * Resolves authorization and token endpoints from validated issuer discovery
 * (`/.well-known/openid-configuration`) unless both endpoints are overridden.
 * Athena authorization-server defaults are `/oauth/authorize` and `/oauth/token`.
 *
 * @param options - Client credentials and issuer (or full endpoint overrides)
 */
export const athena = (options: AthenaOptions) => {
  const cache = new Map<string, ResolvedOidcProviderMetadata>();
  const resolveEndpoints = () =>
    resolveOidcProviderEndpoints({
      cache,
      issuer: resolveIssuer(options),
      overrides: {
        authorizationEndpoint: options.authorizationEndpoint,
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
    }: {
      state: string;
      codeVerifier: string;
      scopes?: string[] | undefined;
      redirectURI: string;
      display?: string | undefined;
      loginHint?: string | undefined;
    }) {
      const endpoints = await resolveEndpoints();
      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "profile", "email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: endpoints.authorizationEndpoint,
        codeVerifier,
        display,
        id: "athena",
        loginHint,
        options,
        ...(options.resource
          ? { additionalParams: { resource: options.resource } }
          : {}),
        prompt: options.prompt,
        redirectURI,
        scopes: _scopes,
        state,
      });
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      if (!token.accessToken) {
        return null;
      }
      const endpoints = await resolveEndpoints();
      if (!endpoints.userinfoEndpoint) {
        return null;
      }
      const { data: profile, error } = await betterFetch<AthenaProfile>(
        endpoints.userinfoEndpoint,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token.accessToken}`,
            "User-Agent": "athena-auth",
          },
        }
      );
      if (error || !profile) {
        logger.error("Athena OAuth userinfo failed:", error);
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: profile.email_verified ?? false,
          id: profile.sub,
          image: profile.picture,
          name: profile.name,
          ...userMap,
        },
      };
    },
    id: "athena" as const,
    name: "Athena",
    options,
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken: string) => {
          const endpoints = await resolveEndpoints();
          return refreshAccessToken({
            options: {
              clientId: options.clientId,
              clientKey: options.clientKey,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            ...(options.resource
              ? { extraParams: { resource: options.resource } }
              : {}),
            tokenEndpoint: endpoints.tokenEndpoint,
          });
        },
    validateAuthorizationCode: async ({
      code,
      codeVerifier,
      redirectURI,
    }: {
      code: string;
      redirectURI: string;
      codeVerifier?: string | undefined;
      deviceId?: string | undefined;
    }) => {
      const endpoints = await resolveEndpoints();
      return validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        resource: options.resource,
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
        if (typeof payload.sub !== "string" || payload.sub.length === 0) {
          return false;
        }
        if (nonce && payload.nonce !== nonce) {
          return false;
        }
        return { claims: payload };
      } catch {
        return false;
      }
    },
  } satisfies OAuthProvider<AthenaProfile, AthenaOptions>;
};
