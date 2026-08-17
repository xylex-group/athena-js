import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

const authorizationEndpoint = "https://backboard.railway.com/oauth/auth";
const tokenEndpoint = "https://backboard.railway.com/oauth/token";
const userinfoEndpoint = "https://backboard.railway.com/oauth/me";

export interface RailwayProfile {
  /** The user's email address. */
  email: string;
  /** The user's display name. */
  name: string;
  /** URL of the user's profile picture. */
  picture: string;
  /** The user's unique ID (OAuth `sub` claim). */
  sub: string;
}

export interface RailwayOptions extends ProviderOptions<RailwayProfile> {
  clientId: string;
}

export const railway = (options: RailwayOptions) => {
  return {
    createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "email", "profile"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "railway",
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
      const { data: profile, error } = await betterFetch<RailwayProfile>(
        userinfoEndpoint,
        { headers: { authorization: `Bearer ${token.accessToken}` } }
      );
      if (error || !profile) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      // Railway does not provide an email_verified claim.
      // We default to false for security consistency.
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: false,
          id: profile.sub,
          image: profile.picture,
          name: profile.name,
          ...userMap,
        },
      };
    },
    id: "railway",
    name: "Railway",
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
  } satisfies OAuthProvider<RailwayProfile>;
};
