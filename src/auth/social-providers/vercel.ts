import { AthenaAuthError } from "../error.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface VercelProfile {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  preferred_username?: string;
  sub: string;
}

export interface VercelOptions extends ProviderOptions<VercelProfile> {
  clientId: string;
}

export const vercel = (options: VercelOptions) =>
  ({
    createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      if (!codeVerifier) {
        throw new AthenaAuthError("codeVerifier is required for Vercel");
      }

      let _scopes: string[] | undefined;
      if (options.scope !== undefined || scopes !== undefined) {
        _scopes = [];
        if (options.scope) {
          _scopes.push(...options.scope);
        }
        if (scopes) {
          _scopes.push(...scopes);
        }
      }

      return createAuthorizationURL({
        authorizationEndpoint: "https://vercel.com/oauth/authorize",
        codeVerifier,
        id: "vercel",
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

      const { data: profile, error } = await betterFetch<VercelProfile>(
        "https://api.vercel.com/login/oauth/userinfo",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        }
      );

      if (error || !profile) {
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
          name: profile.name ?? profile.preferred_username ?? "",
          ...userMap,
        },
      };
    },
    id: "vercel",
    name: "Vercel",
    options,
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint: "https://api.vercel.com/login/oauth/token",
      }),
  }) satisfies OAuthProvider<VercelProfile>;
