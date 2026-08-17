import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface VkProfile {
  user: {
    user_id: string;
    first_name: string;
    last_name: string;
    email?: string | undefined;
    phone?: number | undefined;
    avatar?: string | undefined;
    sex?: number | undefined;
    verified?: boolean | undefined;
    birthday: string;
  };
}

export interface VkOption extends ProviderOptions {
  clientId: string;
  scheme?: ("light" | "dark") | undefined;
}

export const vk = (options: VkOption) => {
  const tokenEndpoint = "https://id.vk.com/oauth2/auth";
  return {
    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["email", "phone"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      const authorizationEndpoint = "https://id.vk.com/authorize";

      return createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "vk",
        options,
        redirectURI,
        scopes: _scopes,
        state,
      });
    },
    async getUserInfo(data) {
      if (options.getUserInfo) {
        return options.getUserInfo(data);
      }
      if (!data.accessToken) {
        return null;
      }
      const formBody = new URLSearchParams({
        access_token: data.accessToken,
        client_id: options.clientId,
      }).toString();
      const { data: profile, error } = await betterFetch<VkProfile>(
        "https://id.vk.com/oauth2/user_info",
        {
          body: formBody,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        }
      );
      if (error) {
        return null;
      }

      const userMap = await options.mapProfileToUser?.(profile);
      if (!(profile.user.email || userMap?.email)) {
        return null;
      }

      return {
        data: profile,
        user: {
          birthday: profile.user.birthday,
          email: profile.user.email,
          emailVerified: false,
          first_name: profile.user.first_name,
          id: profile.user.user_id,
          image: profile.user.avatar,
          last_name: profile.user.last_name,
          name: `${profile.user.first_name} ${profile.user.last_name}`,
          sex: profile.user.sex,
          ...userMap,
        },
      };
    },
    id: "vk",
    name: "VK",
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
    validateAuthorizationCode: async ({
      code,
      codeVerifier,
      redirectURI,
      deviceId,
    }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        deviceId,
        options,
        redirectURI: options.redirectURI || redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<VkProfile>;
};
