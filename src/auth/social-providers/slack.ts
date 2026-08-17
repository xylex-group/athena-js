import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface SlackProfile extends Record<string, unknown> {
  date_email_verified: number;
  email: string;
  email_verified: boolean;
  family_name: string;
  given_name: string;
  "https://slack.com/team_domain": string;
  "https://slack.com/team_id": string;
  "https://slack.com/team_image_34": string;
  "https://slack.com/team_image_44": string;
  "https://slack.com/team_image_68": string;
  "https://slack.com/team_image_88": string;
  "https://slack.com/team_image_102": string;
  "https://slack.com/team_image_132": string;
  "https://slack.com/team_image_230": string;
  "https://slack.com/team_image_default": boolean;
  "https://slack.com/team_name": string;
  "https://slack.com/user_id": string;
  "https://slack.com/user_image_24": string;
  "https://slack.com/user_image_32": string;
  "https://slack.com/user_image_48": string;
  "https://slack.com/user_image_72": string;
  "https://slack.com/user_image_192": string;
  "https://slack.com/user_image_512": string;
  locale: string;
  name: string;
  ok: boolean;
  picture: string;
  sub: string;
}

export interface SlackOptions extends ProviderOptions<SlackProfile> {
  clientId: string;
}

export const slack = (options: SlackOptions) => {
  const tokenEndpoint = "https://slack.com/api/openid.connect.token";
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "profile", "email"];
      if (scopes) {
        _scopes.push(...scopes);
      }
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      const url = new URL("https://slack.com/openid/connect/authorize");
      url.searchParams.set("scope", _scopes.join(" "));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
      url.searchParams.set("state", state);
      return url;
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      const { data: profile, error } = await betterFetch<SlackProfile>(
        "https://slack.com/api/openid.connect.userInfo",
        {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
          },
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
          id: profile["https://slack.com/user_id"],
          image: profile.picture || profile["https://slack.com/user_image_512"],
          name: profile.name || "",
          ...userMap,
        },
      };
    },
    id: "slack",
    name: "Slack",
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
  } satisfies OAuthProvider<SlackProfile>;
};
