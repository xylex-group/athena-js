import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface HuggingFaceProfile {
  canPay?: boolean | undefined;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  isPro: boolean;
  name: string;
  orgs?:
    | {
        sub: string;
        name: string;
        picture: string;
        preferred_username: string;
        isEnterprise: boolean | "plus";
        canPay?: boolean;
        roleInOrg?: "admin" | "write" | "contributor" | "read";
        pendingSSO?: boolean;
        missingMFA?: boolean;
        resourceGroups?: {
          sub: string;
          name: string;
          role: "admin" | "write" | "contributor" | "read";
        }[];
      }
    | undefined;
  picture: string;
  preferred_username: string;
  profile: string;
  sub: string;
  website?: string | undefined;
}

export interface HuggingFaceOptions
  extends ProviderOptions<HuggingFaceProfile> {
  clientId: string;
}

export const huggingface = (options: HuggingFaceOptions) => {
  const tokenEndpoint = "https://huggingface.co/oauth/token";
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
        authorizationEndpoint: "https://huggingface.co/oauth/authorize",
        codeVerifier,
        id: "huggingface",
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
      const { data: profile, error } = await betterFetch<HuggingFaceProfile>(
        "https://huggingface.co/oauth/userinfo",
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
          emailVerified: profile.email_verified ?? false,
          id: profile.sub,
          image: profile.picture,
          name: profile.name || profile.preferred_username || "",
          ...userMap,
        },
      };
    },
    id: "huggingface",
    name: "Hugging Face",
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
  } satisfies OAuthProvider<HuggingFaceProfile>;
};
