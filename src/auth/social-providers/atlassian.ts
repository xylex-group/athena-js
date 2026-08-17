import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface AtlassianProfile {
  account_id: string;
  account_type?: string | undefined;
  email?: string | undefined;
  extended_profile?:
    | {
        job_title?: string;
        organization?: string;
        department?: string;
        location?: string;
      }
    | undefined;
  locale?: string | undefined;
  name: string;
  nickname?: string | undefined;
  picture?: string | undefined;
}
export interface AtlassianOptions extends ProviderOptions<AtlassianProfile> {
  clientId: string;
}

export const atlassian = (options: AtlassianOptions) => {
  const tokenEndpoint = "https://auth.atlassian.com/oauth/token";
  return {
    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      if (!(options.clientId && options.clientSecret)) {
        logger.error("Client Id and Secret are required for Atlassian");
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      if (!codeVerifier) {
        throw new AthenaAuthError("codeVerifier is required for Atlassian");
      }

      const _scopes = options.disableDefaultScope
        ? []
        : ["read:jira-user", "offline_access"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }

      return createAuthorizationURL({
        additionalParams: {
          audience: "api.atlassian.com",
        },
        authorizationEndpoint: "https://auth.atlassian.com/authorize",
        codeVerifier,
        id: "atlassian",
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

      try {
        const { data: profile } = await betterFetch<{
          account_id: string;
          name: string;
          email?: string | undefined;
          picture?: string | undefined;
        }>("https://api.atlassian.com/me", {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });

        if (!profile) {
          return null;
        }

        const userMap = await options.mapProfileToUser?.(profile);

        return {
          data: profile,
          user: {
            email: profile.email,
            emailVerified: false,
            id: profile.account_id,
            image: profile.picture,
            name: profile.name,
            ...userMap,
          },
        };
      } catch (error) {
        logger.error("Failed to fetch user info from Figma:", error);
        return null;
      }
    },
    id: "atlassian",
    name: "Atlassian",

    options,

    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) =>
          refreshAccessToken({
            options: {
              clientId: options.clientId,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint,
          }),

    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<AtlassianProfile>;
};
