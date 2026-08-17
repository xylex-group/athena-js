import { logger } from "../env/index.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";
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
   * Override the authorization endpoint. Defaults to `{issuer}/oauth2/authorize`.
   */
  authorizationEndpoint?: string | undefined;
  clientId: string;
  /**
   * Base issuer URL for the Athena identity provider
   * (e.g. `https://auth.example.com` or a tenant-specific auth root).
   *
   * Defaults for authorization, token, userinfo, and JWKS endpoints are
   * derived from this issuer when the explicit endpoint overrides are omitted.
   */
  issuer?: string | undefined;
  /**
   * Override the token endpoint. Defaults to `{issuer}/oauth2/token`.
   */
  tokenEndpoint?: string | undefined;
  /**
   * Override the userinfo endpoint. Defaults to `{issuer}/oauth2/userinfo`.
   */
  userInfoEndpoint?: string | undefined;
}

function resolveIssuer(options: AthenaOptions): string {
  if (options.issuer) {
    return trimTrailingSlash(options.issuer);
  }
  // Allow deriving issuer from an explicit authorization endpoint host.
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
 * Athena Auth will expose an Athena identity provider; this client module is
 * ready so apps can configure `socialProviders.athena` the same way as Google,
 * GitHub, etc. Defaults endpoints to `{issuer}/oauth2/authorize|token|userinfo`.
 *
 * @param options - Client credentials and issuer (or full endpoint overrides)
 */
export const athena = (options: AthenaOptions) => {
  const issuer = () => resolveIssuer(options);
  const authorizationEndpoint = () =>
    options.authorizationEndpoint || `${issuer()}/oauth2/authorize`;
  const tokenEndpoint = () =>
    options.tokenEndpoint || `${issuer()}/oauth2/token`;
  const userInfoEndpoint = () =>
    options.userInfoEndpoint || `${issuer()}/oauth2/userinfo`;

  return {
    createAuthorizationURL({
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
        authorizationEndpoint: authorizationEndpoint(),
        codeVerifier,
        display,
        id: "athena",
        loginHint,
        options,
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
      const { data: profile, error } = await betterFetch<AthenaProfile>(
        userInfoEndpoint(),
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
      : async (refreshToken: string) =>
          refreshAccessToken({
            options: {
              clientId: options.clientId,
              clientKey: options.clientKey,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint: tokenEndpoint(),
          }),
    validateAuthorizationCode: async ({
      code,
      codeVerifier,
      redirectURI,
    }: {
      code: string;
      redirectURI: string;
      codeVerifier?: string | undefined;
      deviceId?: string | undefined;
    }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint: tokenEndpoint(),
      }),
  } satisfies OAuthProvider<AthenaProfile, AthenaOptions>;
};
