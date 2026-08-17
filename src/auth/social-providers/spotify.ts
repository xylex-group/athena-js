import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface SpotifyProfile {
  display_name: string;
  email: string;
  id: string;
  images: {
    url: string;
  }[];
}

export interface SpotifyOptions extends ProviderOptions<SpotifyProfile> {
  clientId: string;
}

export const spotify = (options: SpotifyOptions) => {
  const tokenEndpoint = "https://accounts.spotify.com/api/token";
  return {
    createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["user-read-email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://accounts.spotify.com/authorize",
        codeVerifier,
        id: "spotify",
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
      const { data: profile, error } = await betterFetch<SpotifyProfile>(
        "https://api.spotify.com/v1/me",
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
          emailVerified: false,
          id: profile.id,
          image: profile.images[0]?.url,
          name: profile.display_name,
          ...userMap,
        },
      };
    },
    id: "spotify",
    name: "Spotify",
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
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<SpotifyProfile>;
};
