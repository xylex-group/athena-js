import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface PolarProfile {
  account_id?: string | undefined;
  avatar_url: string;
  email: string;
  email_verified?: boolean | undefined;
  github_username?: string | undefined;
  id: string;
  profile_settings?:
    | {
        profile_settings_enabled?: boolean;
        profile_settings_public_name?: string;
        profile_settings_public_avatar?: string;
        profile_settings_public_bio?: string;
        profile_settings_public_location?: string;
        profile_settings_public_website?: string;
        profile_settings_public_twitter?: string;
        profile_settings_public_github?: string;
        profile_settings_public_email?: string;
      }
    | undefined;
  public_name?: string | undefined;
  username: string;
}

export type PolarOptions = ProviderOptions<PolarProfile>;

export const polar = (options: PolarOptions) => {
  const tokenEndpoint = "https://api.polar.sh/v1/oauth2/token";
  return {
    createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "profile", "email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://polar.sh/oauth2/authorize",
        codeVerifier,
        id: "polar",
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
      const { data: profile, error } = await betterFetch<PolarProfile>(
        "https://api.polar.sh/v1/oauth2/userinfo",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        }
      );
      if (error) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      // Polar may provide email_verified claim, but it's not guaranteed.
      // We check for it first, then default to false for security consistency.
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: profile.email_verified ?? false,
          id: profile.id,
          image: profile.avatar_url,
          name: profile.public_name || profile.username || "",
          ...userMap,
        },
      };
    },
    id: "polar",
    name: "Polar",
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
  } satisfies OAuthProvider<PolarProfile>;
};
