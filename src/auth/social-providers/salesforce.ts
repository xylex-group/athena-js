import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface SalesforceProfile {
  email: string;
  email_verified?: boolean | undefined;
  family_name?: string | undefined;
  given_name?: string | undefined;
  name: string;
  organization_id: string;
  photos?:
    | {
        picture?: string;
        thumbnail?: string;
      }
    | undefined;
  preferred_username?: string | undefined;
  sub: string;
  user_id: string;
  zoneinfo?: string | undefined;
}

export interface SalesforceOptions extends ProviderOptions<SalesforceProfile> {
  clientId: string;
  environment?: ("sandbox" | "production") | undefined;
  loginUrl?: string | undefined;
  /**
   * Override the redirect URI if auto-detection fails.
   * Should match the Callback URL configured in your Salesforce Connected App.
   * @example "http://localhost:3000/api/auth/callback/salesforce"
   */
  redirectURI?: string | undefined;
}

export const salesforce = (options: SalesforceOptions) => {
  const environment = options.environment ?? "production";
  const isSandbox = environment === "sandbox";
  const authorizationEndpoint = options.loginUrl
    ? `https://${options.loginUrl}/services/oauth2/authorize`
    : isSandbox
      ? "https://test.salesforce.com/services/oauth2/authorize"
      : "https://login.salesforce.com/services/oauth2/authorize";

  const tokenEndpoint = options.loginUrl
    ? `https://${options.loginUrl}/services/oauth2/token`
    : isSandbox
      ? "https://test.salesforce.com/services/oauth2/token"
      : "https://login.salesforce.com/services/oauth2/token";

  const userInfoEndpoint = options.loginUrl
    ? `https://${options.loginUrl}/services/oauth2/userinfo`
    : isSandbox
      ? "https://test.salesforce.com/services/oauth2/userinfo"
      : "https://login.salesforce.com/services/oauth2/userinfo";

  return {
    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      if (!(options.clientId && options.clientSecret)) {
        logger.error(
          "Client Id and Client Secret are required for Salesforce. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      if (!codeVerifier) {
        throw new AthenaAuthError("codeVerifier is required for Salesforce");
      }

      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "email", "profile"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }

      return createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "salesforce",
        options,
        redirectURI: options.redirectURI || redirectURI,
        scopes: _scopes,
        state,
      });
    },

    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }

      try {
        const { data: user } = await betterFetch<SalesforceProfile>(
          userInfoEndpoint,
          {
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
            },
          }
        );

        if (!user) {
          logger.error("Failed to fetch user info from Salesforce");
          return null;
        }

        const userMap = await options.mapProfileToUser?.(user);

        return {
          data: user,
          user: {
            email: user.email,
            emailVerified: user.email_verified ?? false,
            id: user.user_id,
            image: user.photos?.picture || user.photos?.thumbnail,
            name: user.name,
            ...userMap,
          },
        };
      } catch (error) {
        logger.error("Failed to fetch user info from Salesforce:", error);
        return null;
      }
    },
    id: "salesforce",
    name: "Salesforce",

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
        redirectURI: options.redirectURI || redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<SalesforceProfile>;
};
