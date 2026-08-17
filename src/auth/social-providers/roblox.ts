import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface RobloxProfile extends Record<string, unknown> {
  /** the account creation date as a unix timestamp in seconds */
  created_at: number;
  /** the user's display name, again, will return the same value as the preferred_username if not set */
  name: string;
  /** the user's display name, will return the same value as the preferred_username if not set */
  nickname: string;
  /** the user's avatar URL */
  picture: string;
  /** the user's username */
  preferred_username: string;
  /** the user's profile URL */
  profile: string;
  /** the user's id */
  sub: string;
}

export interface RobloxOptions extends ProviderOptions<RobloxProfile> {
  clientId: string;
  prompt?:
    | (
        | "none"
        | "consent"
        | "login"
        | "select_account"
        | "select_account consent"
      )
    | undefined;
}

export const roblox = (options: RobloxOptions) => {
  const tokenEndpoint = "https://apis.roblox.com/oauth/v1/token";
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["openid", "profile"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return new URL(
        `https://apis.roblox.com/oauth/v1/authorize?scope=${_scopes.join(
          "+"
        )}&response_type=code&client_id=${
          options.clientId
        }&redirect_uri=${encodeURIComponent(
          options.redirectURI || redirectURI
        )}&state=${state}&prompt=${options.prompt || "select_account consent"}`
      );
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      const { data: profile, error } = await betterFetch<RobloxProfile>(
        "https://apis.roblox.com/oauth/v1/userinfo",
        {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
          },
        }
      );

      if (error) {
        return null;
      }

      const userMap = await options.mapProfileToUser?.(profile);
      // Roblox does not provide email or email_verified claim.
      // We default to false for security consistency.
      return {
        data: {
          ...profile,
        },
        user: {
          email: profile.preferred_username || null, // Roblox does not provide email
          emailVerified: false,
          id: profile.sub,
          image: profile.picture,
          name: profile.nickname || profile.preferred_username || "",
          ...userMap,
        },
      };
    },
    id: "roblox",
    name: "Roblox",
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
        authentication: "post",
        code,
        options,
        redirectURI: options.redirectURI || redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<RobloxProfile>;
};
