import { logger } from "../env/index.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  getOAuth2Tokens,
  refreshAccessToken,
} from "../oauth2/index.ts";
import { createAuthorizationCodeRequest } from "../oauth2/validate-authorization-code.ts";

export interface GithubProfile {
  avatar_url: string;
  bio: string;
  blog: string;
  collaborators: string;
  company: string;
  created_at: string;
  disk_usage: string;
  email: string | null;
  events_url: string;
  followers: string;
  followers_url: string;
  following: string;
  following_url: string;
  gists_url: string;
  gravatar_id: string;
  hireable: boolean;
  html_url: string;
  id: string;
  location: string;
  login: string;
  name: string;
  node_id: string;
  organizations_url: string;
  owned_private_repos: string;
  plan: {
    name: string;
    space: string;
    private_repos: string;
    collaborators: string;
  };
  private_gists: string;
  public_gists: string;
  public_repos: string;
  received_events_url: string;
  repos_url: string;
  site_admin: boolean;
  starred_url: string;
  subscriptions_url: string;
  total_private_repos: string;
  twitter_username: string;
  two_factor_authentication: boolean;
  type: string;
  updated_at: string;
  url: string;
}

export interface GithubOptions extends ProviderOptions<GithubProfile> {
  clientId: string;
}
export const github = (options: GithubOptions) => {
  const tokenEndpoint = "https://github.com/login/oauth/access_token";
  return {
    createAuthorizationURL({
      state,
      scopes,
      loginHint,
      codeVerifier,
      redirectURI,
    }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["read:user", "user:email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://github.com/login/oauth/authorize",
        codeVerifier,
        id: "github",
        loginHint,
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
      const { data: profile, error } = await betterFetch<GithubProfile>(
        "https://api.github.com/user",
        {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
            "User-Agent": "athena-auth",
          },
        }
      );
      if (error) {
        return null;
      }
      const { data: emails } = await betterFetch<
        {
          email: string;
          primary: boolean;
          verified: boolean;
          visibility: "public" | "private";
        }[]
      >("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "User-Agent": "athena-auth",
        },
      });

      if (!profile.email && emails) {
        profile.email = (emails.find((e) => e.primary) ?? emails[0])
          ?.email as string;
      }
      const emailVerified =
        emails?.find((e) => e.email === profile.email)?.verified ?? false;

      const userMap = await options.mapProfileToUser?.(profile);
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified,
          id: profile.id,
          image: profile.avatar_url,
          name: profile.name || profile.login || "",
          ...userMap,
        },
      };
    },
    id: "github",
    name: "GitHub",
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
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
      const { body, headers: requestHeaders } = createAuthorizationCodeRequest({
        code,
        codeVerifier,
        options,
        redirectURI,
      });

      const { data, error } = await betterFetch<
        | { access_token: string; token_type: string; scope: string }
        | { error: string; error_description?: string; error_uri?: string }
      >(tokenEndpoint, {
        body,
        headers: requestHeaders,
        method: "POST",
      });

      if (error) {
        logger.error("GitHub OAuth token exchange failed:", error);
        return null;
      }

      if ("error" in data) {
        logger.error("GitHub OAuth token exchange failed:", data);
        return null;
      }

      return getOAuth2Tokens(data);
    },
  } satisfies OAuthProvider<GithubProfile>;
};
