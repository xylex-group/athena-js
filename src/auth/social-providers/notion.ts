import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface NotionProfile {
  avatar_url?: string | undefined;
  id: string;
  name?: string | undefined;
  object: "user";
  person?:
    | {
        email?: string;
      }
    | undefined;
  type: "person" | "bot";
}

export interface NotionOptions extends ProviderOptions<NotionProfile> {
  clientId: string;
}

export const notion = (options: NotionOptions) => {
  const tokenEndpoint = "https://api.notion.com/v1/oauth/token";
  return {
    createAuthorizationURL({ state, scopes, loginHint, redirectURI }) {
      const _scopes: string[] = options.disableDefaultScope ? [] : [];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        additionalParams: {
          owner: "user",
        },
        authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
        id: "notion",
        loginHint,
        options,
        redirectURI,
        scopes: _scopes,
        state,
      });
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      const { data: profile, error } = await betterFetch<{
        bot: {
          owner: {
            user: NotionProfile;
          };
        };
      }>("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (error || !profile) {
        return null;
      }
      const userProfile = profile.bot?.owner?.user;
      if (!userProfile) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(userProfile);
      return {
        data: userProfile,
        user: {
          email: userProfile.person?.email || null,
          emailVerified: false,
          id: userProfile.id,
          image: userProfile.avatar_url,
          name: userProfile.name || "",
          ...userMap,
        },
      };
    },
    id: "notion",
    name: "Notion",
    options,
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) =>
          refreshAccessToken({
            options: {
              clientId: options.clientId,
              clientKey: options.clientKey,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint,
          }),
    validateAuthorizationCode: async ({ code, redirectURI }) =>
      validateAuthorizationCode({
        authentication: "basic",
        code,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<NotionProfile>;
};
