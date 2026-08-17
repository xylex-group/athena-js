import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface LinkedInProfile {
  email?: string;
  email_verified?: boolean;
  family_name: string;
  given_name: string;
  locale: {
    country: string;
    language: string;
  };
  name: string;
  picture: string;
  sub: string;
}

export interface LinkedInOptions extends ProviderOptions<LinkedInProfile> {
  clientId: string;
}

export const linkedin = (options: LinkedInOptions) => {
  const authorizationEndpoint =
    "https://www.linkedin.com/oauth/v2/authorization";
  const tokenEndpoint = "https://www.linkedin.com/oauth/v2/accessToken";

  return {
    createAuthorizationURL: async ({
      state,
      scopes,
      redirectURI,
      loginHint,
    }) => {
      const _scopes = options.disableDefaultScope
        ? []
        : ["profile", "email", "openid"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return await createAuthorizationURL({
        authorizationEndpoint,
        id: "linkedin",
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
      const { data: profile, error } = await betterFetch<LinkedInProfile>(
        "https://api.linkedin.com/v2/userinfo",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
          method: "GET",
        }
      );

      if (error) {
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
    id: "linkedin",
    name: "Linkedin",
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
      await validateAuthorizationCode({
        code,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<LinkedInProfile>;
};
