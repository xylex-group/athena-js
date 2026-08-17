import { decodeJwt } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

export interface PaybinProfile {
  email: string;
  email_verified?: boolean | undefined;
  family_name?: string | undefined;
  given_name?: string | undefined;
  name?: string | undefined;
  picture?: string | undefined;
  preferred_username?: string | undefined;
  sub: string;
}

export interface PaybinOptions extends ProviderOptions<PaybinProfile> {
  clientId: string;
  /**
   * The issuer URL of your Paybin OAuth server
   * @default "https://idp.paybin.io"
   */
  issuer?: string | undefined;
}

export const paybin = (options: PaybinOptions) => {
  const issuer = options.issuer || "https://idp.paybin.io";
  const authorizationEndpoint = `${issuer}/oauth2/authorize`;
  const tokenEndpoint = `${issuer}/oauth2/token`;

  return {
    async createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint,
    }) {
      if (!(options.clientId && options.clientSecret)) {
        logger.error(
          "Client Id and Client Secret is required for Paybin. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      if (!codeVerifier) {
        throw new AthenaAuthError("codeVerifier is required for Paybin");
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
      const url = await createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "paybin",
        loginHint,
        options,
        prompt: options.prompt,
        redirectURI,
        scopes: _scopes,
        state,
      });
      return url;
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      if (!token.idToken) {
        return null;
      }
      const user = decodeJwt(token.idToken) as PaybinProfile;
      const userMap = await options.mapProfileToUser?.(user);
      return {
        data: user,
        user: {
          email: user.email,
          emailVerified: Boolean(user.email_verified),
          id: user.sub,
          image: user.picture,
          name: user.name || user.preferred_username || "",
          ...userMap,
        },
      };
    },
    id: "paybin",
    name: "Paybin",
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
  } satisfies OAuthProvider<PaybinProfile>;
};
