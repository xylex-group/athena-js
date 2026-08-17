import { decodeJwt } from "jose";
import { logger } from "../env/index.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

/**
 * @see https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/#requesting-claims
 */
export interface TwitchProfile {
  /**
   * The email of the user
   */
  email: string;
  /**
   * Indicate if this user has a verified email.
   */
  email_verified: boolean;
  /**
   * The picture of the user
   */
  picture: string;
  /**
   * The preferred username of the user
   */
  preferred_username: string;
  /**
   * The sub of the user
   */
  sub: string;
}

export interface TwitchOptions extends ProviderOptions<TwitchProfile> {
  claims?: string[] | undefined;
  clientId: string;
}
export const twitch = (options: TwitchOptions) => {
  const tokenEndpoint = "https://id.twitch.tv/oauth2/token";
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["user:read:email", "openid"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://id.twitch.tv/oauth2/authorize",
        claims: options.claims || [
          "email",
          "email_verified",
          "preferred_username",
          "picture",
        ],
        id: "twitch",
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
      const idToken = token.idToken;
      if (!idToken) {
        logger.error("No idToken found in token");
        return null;
      }
      const profile = decodeJwt(idToken) as TwitchProfile;
      const userMap = await options.mapProfileToUser?.(profile);
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: profile.email_verified,
          id: profile.sub,
          image: profile.picture,
          name: profile.preferred_username,
          ...userMap,
        },
      };
    },
    id: "twitch",
    name: "Twitch",
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
  } satisfies OAuthProvider<TwitchProfile>;
};
