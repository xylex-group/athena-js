import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface LinearUser {
  active: boolean;
  avatarUrl?: string | undefined;
  createdAt: string;
  email: string;
  id: string;
  name: string;
  updatedAt: string;
}

export interface LinearProfile {
  data: {
    viewer: LinearUser;
  };
}

export interface LinearOptions extends ProviderOptions<LinearUser> {
  clientId: string;
}

export const linear = (options: LinearOptions) => {
  const tokenEndpoint = "https://api.linear.app/oauth/token";
  return {
    createAuthorizationURL({ state, scopes, loginHint, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["read"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://linear.app/oauth/authorize",
        id: "linear",
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

      const { data: profile, error } = await betterFetch<LinearProfile>(
        "https://api.linear.app/graphql",
        {
          body: JSON.stringify({
            query: `
							query {
								viewer {
									id
									name
									email
									avatarUrl
									active
									createdAt
									updatedAt
								}
							}
						`,
          }),
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        }
      );
      if (error || !profile?.data?.viewer) {
        return null;
      }

      const userData = profile.data.viewer;
      const userMap = await options.mapProfileToUser?.(userData);
      // Linear does not provide email_verified claim.
      // We default to false for security consistency.
      return {
        data: userData,
        user: {
          email: profile.data.viewer.email,
          emailVerified: false,
          id: profile.data.viewer.id,
          image: profile.data.viewer.avatarUrl,
          name: profile.data.viewer.name,
          ...userMap,
        },
      };
    },
    id: "linear",
    name: "Linear",
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
        code,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<LinearUser>;
};
