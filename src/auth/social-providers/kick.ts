import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface KickProfile {
  /**
   * The email of the user
   */
  email: string;
  /**
   * The name of the user
   */
  name: string;
  /**
   * The picture of the user
   */
  profile_picture: string;
  /**
   * The user id of the user
   */
  user_id: string;
}

export interface KickOptions extends ProviderOptions<KickProfile> {
  clientId: string;
}

export const kick = (options: KickOptions) => {
  return {
    createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }) {
      const _scopes = options.disableDefaultScope ? [] : ["user:read"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }

      return createAuthorizationURL({
        authorizationEndpoint: "https://id.kick.com/oauth/authorize",
        codeVerifier,
        id: "kick",
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

      const { data, error } = await betterFetch<{
        data: KickProfile[];
      }>("https://api.kick.com/public/v1/users", {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
        method: "GET",
      });

      if (error) {
        return null;
      }

      const profile = data.data[0]!;

      const userMap = await options.mapProfileToUser?.(profile);
      // Kick does not provide email_verified claim.
      // We default to false for security consistency.
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: false,
          id: profile.user_id,
          image: profile.profile_picture,
          name: profile.name,
          ...userMap,
        },
      };
    },
    id: "kick",
    name: "Kick",
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
            tokenEndpoint: "https://id.kick.com/oauth/token",
          }),
    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      return validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint: "https://id.kick.com/oauth/token",
      });
    },
  } satisfies OAuthProvider<KickProfile>;
};
