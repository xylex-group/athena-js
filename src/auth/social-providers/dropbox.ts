import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface DropboxProfile {
  account_id: string;
  email: string;
  email_verified: boolean;
  name: {
    given_name: string;
    surname: string;
    familiar_name: string;
    display_name: string;
    abbreviated_name: string;
  };
  profile_photo_url: string;
}

export interface DropboxOptions extends ProviderOptions<DropboxProfile> {
  accessType?: ("offline" | "online" | "legacy") | undefined;
  clientId: string;
}

export const dropbox = (options: DropboxOptions) => {
  const tokenEndpoint = "https://api.dropboxapi.com/oauth2/token";

  return {
    createAuthorizationURL: async ({
      state,
      scopes,
      codeVerifier,
      redirectURI,
    }) => {
      const _scopes = options.disableDefaultScope ? [] : ["account_info.read"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      const additionalParams: Record<string, string> = {};
      if (options.accessType) {
        additionalParams.token_access_type = options.accessType;
      }
      return await createAuthorizationURL({
        additionalParams,
        authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
        codeVerifier,
        id: "dropbox",
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
      const { data: profile, error } = await betterFetch<DropboxProfile>(
        "https://api.dropboxapi.com/2/users/get_current_account",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
          method: "POST",
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
          emailVerified: profile.email_verified,
          id: profile.account_id,
          image: profile.profile_photo_url,
          name: profile.name?.display_name,
          ...userMap,
        },
      };
    },
    id: "dropbox",
    name: "Dropbox",
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
      await validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<DropboxProfile>;
};
