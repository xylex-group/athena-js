import { decodeJwt } from "jose";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface LineIdTokenPayload {
  amr?: string[] | undefined;
  aud: string;
  email?: string | undefined;
  exp: number;
  iat: number;
  iss: string;
  name?: string | undefined;
  nonce?: string | undefined;
  picture?: string | undefined;
  sub: string;
}

export interface LineUserInfo {
  email?: string | undefined;
  name?: string | undefined;
  picture?: string | undefined;
  sub: string;
}

export interface LineOptions
  extends ProviderOptions<LineUserInfo | LineIdTokenPayload> {
  clientId: string;
}

/**
 * LINE Login v2.1
 * - Authorization endpoint: https://access.line.me/oauth2/v2.1/authorize
 * - Token endpoint: https://api.line.me/oauth2/v2.1/token
 * - UserInfo endpoint: https://api.line.me/oauth2/v2.1/userinfo
 * - Verify ID token: https://api.line.me/oauth2/v2.1/verify
 *
 * Docs: https://developers.line.biz/en/reference/line-login/#issue-access-token
 */
export const line = (options: LineOptions) => {
  const authorizationEndpoint = "https://access.line.me/oauth2/v2.1/authorize";
  const tokenEndpoint = "https://api.line.me/oauth2/v2.1/token";
  const userInfoEndpoint = "https://api.line.me/oauth2/v2.1/userinfo";
  const verifyIdTokenEndpoint = "https://api.line.me/oauth2/v2.1/verify";

  return {
    async createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint,
    }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "profile", "email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return await createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "line",
        loginHint,
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
      let profile: LineUserInfo | LineIdTokenPayload | null = null;
      // Prefer ID token if available
      if (token.idToken) {
        try {
          profile = decodeJwt(token.idToken) as LineIdTokenPayload;
        } catch {
          // Invalid ID tokens fall back to the UserInfo endpoint below.
        }
      }
      // Fallback to UserInfo endpoint
      if (!profile) {
        const { data } = await betterFetch<LineUserInfo>(userInfoEndpoint, {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
          },
        });
        profile = data || null;
      }
      if (!profile) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      // ID preference order (sub is present on both ID-token and userinfo payloads)
      const id = profile.sub;
      const name = profile.name || "";
      const image = profile.picture || undefined;
      const email = profile.email;
      return {
        data: profile,
        user: {
          email,
          // LINE does not expose email verification status in ID token/userinfo
          emailVerified: false,
          id,
          image,
          name,
          ...userMap,
        },
      };
    },
    id: "line",
    name: "LINE",
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
    async verifyIdToken(token, nonce) {
      if (options.disableIdTokenSignIn) {
        return false;
      }
      if (options.verifyIdToken) {
        return options.verifyIdToken(token, nonce);
      }
      const body = new URLSearchParams();
      body.set("id_token", token);
      body.set("client_id", options.clientId);
      if (nonce) {
        body.set("nonce", nonce);
      }
      const { data, error } = await betterFetch<LineIdTokenPayload>(
        verifyIdTokenEndpoint,
        {
          body,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        }
      );
      if (error || !data) {
        return false;
      }
      // aud must match clientId; nonce (if provided) must also match nonce
      if (data.aud !== options.clientId) {
        return false;
      }
      if (data.nonce && data.nonce !== nonce) {
        return false;
      }
      return true;
    },
  } satisfies OAuthProvider<LineUserInfo | LineIdTokenPayload, LineOptions>;
};
