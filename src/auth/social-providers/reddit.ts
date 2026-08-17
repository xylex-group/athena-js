import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  getOAuth2Tokens,
  refreshAccessToken,
} from "../oauth2/index.ts";
import { base64 } from "../utils/base64.ts";

export interface RedditProfile {
  has_verified_email: boolean;
  icon_img: string | null;
  id: string;
  name: string;
  oauth_client_id: string;
  verified: boolean;
}

export interface RedditOptions extends ProviderOptions<RedditProfile> {
  clientId: string;
  duration?: string | undefined;
}

export const reddit = (options: RedditOptions) => {
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["identity"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://www.reddit.com/api/v1/authorize",
        duration: options.duration,
        id: "reddit",
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

      const { data: profile, error } = await betterFetch<RedditProfile>(
        "https://oauth.reddit.com/api/v1/me",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "User-Agent": "athena-auth",
          },
        }
      );

      if (error) {
        return null;
      }

      const userMap = await options.mapProfileToUser?.(profile);
      // Reddit's identity scope does not return an email. Synthesize a stable,
      // non-routable placeholder (RFC 2606 `.invalid`) keyed to the user's
      // Reddit id rather than the routable `reddit.com`, which could collide
      // with a real address. Left unverified; `mapProfileToUser` can override.
      const email = userMap?.email || `${profile.id}@reddit.invalid`;
      return {
        data: profile,
        user: {
          id: profile.id,
          image: profile.icon_img?.split("?")[0],
          name: profile.name,
          ...userMap,
          email,
          emailVerified: userMap?.emailVerified ?? false,
        },
      };
    },
    id: "reddit",
    name: "Reddit",
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
            tokenEndpoint: "https://www.reddit.com/api/v1/access_token",
          }),
    validateAuthorizationCode: async ({ code, redirectURI }) => {
      const body = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: options.redirectURI || redirectURI,
      });
      const headers = {
        Authorization: `Basic ${base64.encode(
          `${options.clientId}:${options.clientSecret}`
        )}`,
        accept: "text/plain",
        "content-type": "application/x-www-form-urlencoded",
        "User-Agent": "athena-auth",
      };

      const { data, error } = await betterFetch<object>(
        "https://www.reddit.com/api/v1/access_token",
        {
          body: body.toString(),
          headers,
          method: "POST",
        }
      );

      if (error) {
        throw error;
      }

      return getOAuth2Tokens(data);
    },
  } satisfies OAuthProvider<RedditProfile>;
};
