import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface FigmaProfile {
  email: string;
  handle: string;
  id: string;
  img_url: string;
}

export interface FigmaOptions extends ProviderOptions<FigmaProfile> {
  clientId: string;
}

export const figma = (options: FigmaOptions) => {
  const tokenEndpoint = "https://api.figma.com/v1/oauth/token";
  return {
    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      if (!(options.clientId && options.clientSecret)) {
        logger.error(
          "Client Id and Client Secret are required for Figma. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      if (!codeVerifier) {
        throw new AthenaAuthError("codeVerifier is required for Figma");
      }

      const _scopes = options.disableDefaultScope ? [] : ["current_user:read"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }

      const url = await createAuthorizationURL({
        authorizationEndpoint: "https://www.figma.com/oauth",
        codeVerifier,
        id: "figma",
        options,
        redirectURI,
        scopes: _scopes,
        state,
      });

      return url;
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }

      try {
        const { data: profile } = await betterFetch<FigmaProfile>(
          "https://api.figma.com/v1/me",
          {
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
            },
          }
        );

        if (!profile) {
          logger.error("Failed to fetch user from Figma");
          return null;
        }

        const userMap = await options.mapProfileToUser?.(profile);

        return {
          data: profile,
          user: {
            email: profile.email,
            emailVerified: false,
            id: profile.id,
            image: profile.img_url,
            name: profile.handle,
            ...userMap,
          },
        };
      } catch (error) {
        logger.error("Failed to fetch user info from Figma:", error);
        return null;
      }
    },
    id: "figma",
    name: "Figma",
    options,
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) =>
          refreshAccessToken({
            authentication: "basic",
            options: {
              clientId: options.clientId,
              clientKey: options.clientKey,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint,
          }),
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) =>
      validateAuthorizationCode({
        authentication: "basic",
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<FigmaProfile>;
};
