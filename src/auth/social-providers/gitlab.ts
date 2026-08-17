import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface GitlabProfile extends Record<string, unknown> {
  avatar_url: string;
  bio: string;
  bot: boolean;
  can_create_group: boolean;
  can_create_project: boolean;
  color_scheme_id: number;
  commit_email: string;
  confirmed_at: string;
  created_at: string;
  current_sign_in_at: string;
  email: string;
  email_verified?: boolean | undefined;
  external: boolean;
  extra_shared_runners_minutes_limit: number;
  followers: number;
  following: number;
  id: number;
  identities: Array<{
    provider: string;
    extern_uid: string;
  }>;
  job_title: string;
  last_activity_on: string;
  last_sign_in_at: string;
  linkedin: string;
  local_time: string;
  location?: string | undefined;
  name: string;
  organization: string;
  private_profile: boolean;
  projects_limit: number;
  pronouns: string;
  public_email: string;
  shared_runners_minutes_limit: number;
  skype: string;
  state: string;
  theme_id: number;
  twitter: string;
  two_factor_enabled: boolean;
  username: string;
  web_url: string;
  website_url: string;
  work_information?: string | undefined;
}

export interface GitlabOptions extends ProviderOptions<GitlabProfile> {
  clientId: string;
  issuer?: string | undefined;
}

const cleanDoubleSlashes = (input = "") =>
  input
    .split("://")
    .map((str) => str.replace(/\/{2,}/g, "/"))
    .join("://");

const issuerToEndpoints = (issuer?: string | undefined) => {
  const baseUrl = issuer || "https://gitlab.com";
  return {
    authorizationEndpoint: cleanDoubleSlashes(`${baseUrl}/oauth/authorize`),
    tokenEndpoint: cleanDoubleSlashes(`${baseUrl}/oauth/token`),
    userinfoEndpoint: cleanDoubleSlashes(`${baseUrl}/api/v4/user`),
  };
};

export const gitlab = (options: GitlabOptions) => {
  const { authorizationEndpoint, tokenEndpoint, userinfoEndpoint } =
    issuerToEndpoints(options.issuer);
  const issuerId = "gitlab";
  const issuerName = "Gitlab";
  return {
    createAuthorizationURL: async ({
      state,
      scopes,
      codeVerifier,
      loginHint,
      redirectURI,
    }) => {
      const _scopes = options.disableDefaultScope ? [] : ["read_user"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return await createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: issuerId,
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
      const { data: profile, error } = await betterFetch<GitlabProfile>(
        userinfoEndpoint,
        { headers: { authorization: `Bearer ${token.accessToken}` } }
      );
      if (error || profile.state !== "active" || profile.locked) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      // GitLab may provide email_verified claim, but it's not guaranteed.
      // We check for it first, then default to false for security consistency.
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: profile.email_verified ?? false,
          id: profile.id,
          image: profile.avatar_url,
          name: profile.name ?? profile.username ?? "",
          ...userMap,
        },
      };
    },
    id: issuerId,
    name: issuerName,
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
    validateAuthorizationCode: async ({ code, redirectURI, codeVerifier }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<GitlabProfile>;
};
