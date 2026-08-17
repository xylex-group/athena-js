import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface NaverProfile {
  /** API response message */
  message: string;
  response: {
    /** Unique Naver user identifier */
    id: string;
    /** User nickname */
    nickname: string;
    /** User real name */
    name: string;
    /** User email address */
    email: string;
    /** Gender (F: female, M: male, U: unknown) */
    gender: string;
    /** Age range */
    age: string;
    /** Birthday (MM-DD format) */
    birthday: string;
    /** Birth year */
    birthyear: string;
    /** Profile image URL */
    profile_image: string;
    /** Mobile phone number */
    mobile: string;
  };
  /** API response result code */
  resultcode: string;
}

export interface NaverOptions extends ProviderOptions<NaverProfile> {
  clientId: string;
}

export const naver = (options: NaverOptions) => {
  const tokenEndpoint = "https://nid.naver.com/oauth2.0/token";
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["profile", "email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://nid.naver.com/oauth2.0/authorize",
        id: "naver",
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
      const { data: profile, error } = await betterFetch<NaverProfile>(
        "https://openapi.naver.com/v1/nid/me",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        }
      );
      if (error || !profile || profile.resultcode !== "00") {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      const res = profile.response || {};
      const user = {
        email: res.email,
        emailVerified: false,
        id: res.id,
        image: res.profile_image,
        name: res.name || res.nickname || "",
        ...userMap,
      };
      return {
        data: profile,
        user,
      };
    },
    id: "naver",
    name: "Naver",
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
  } satisfies OAuthProvider<NaverProfile>;
};
