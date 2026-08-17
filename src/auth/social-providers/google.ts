import { decodeJwt } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  getPrimaryClientId,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";
import type { GoogleOptions, GoogleProfile } from "./google-types.ts";
import {
  isGoogleHostedDomainAllowed,
  verifyGoogleIdToken,
} from "./google-verify.ts";
import { mergeScopes } from "./helpers/merge-scopes.ts";

export { getGooglePublicKey } from "./google-keys.ts";
export type {
  GoogleOptions,
  GoogleProfile,
  VerifyGoogleIdTokenOptions,
} from "./google-types.ts";
export {
  isGoogleHostedDomainAllowed,
  verifyGoogleIdToken,
} from "./google-verify.ts";

/**
 * Google OAuth / OpenID Connect provider factory.
 *
 * @param options - Client id/secret, optional hosted domain (`hd`), access type
 * @returns Provider with authorize, token, refresh, ID-token verify, and userinfo
 */
export const google = (options: GoogleOptions) =>
  ({
    async createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint,
      display,
    }) {
      if (!(getPrimaryClientId(options.clientId) && options.clientSecret)) {
        logger.error(
          "Client Id and Client Secret is required for Google. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      if (!codeVerifier) {
        throw new AthenaAuthError("codeVerifier is required for Google");
      }
      const _scopes = mergeScopes(
        ["email", "profile", "openid"],
        options.scope,
        scopes,
        options.disableDefaultScope
      );
      const url = await createAuthorizationURL({
        accessType: options.accessType,
        additionalParams: {
          include_granted_scopes: "true",
        },
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        codeVerifier,
        display: display || options.display,
        hd: options.hd,
        id: "google",
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
      const user = decodeJwt(token.idToken) as GoogleProfile;
      if (!isGoogleHostedDomainAllowed(options.hd, user.hd)) {
        logger.error(
          `Google sign-in rejected: id token hosted domain (hd) "${
            user.hd ?? "<missing>"
          }" does not satisfy the configured "hd" option "${options.hd}".`
        );
        return null;
      }
      const userMap = await options.mapProfileToUser?.(user);
      return {
        data: user,
        user: {
          email: user.email,
          emailVerified: user.email_verified,
          id: user.sub,
          image: user.picture,
          name: user.name,
          ...userMap,
        },
      };
    },
    id: "google",
    name: "Google",
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
            tokenEndpoint: "https://oauth2.googleapis.com/token",
          }),
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint: "https://oauth2.googleapis.com/token",
      }),
    async verifyIdToken(token, nonce) {
      if (options.disableIdTokenSignIn) {
        return false;
      }
      if (options.verifyIdToken) {
        return options.verifyIdToken(token, nonce);
      }

      const jwtClaims = await verifyGoogleIdToken({
        audience: options.clientId,
        nonce,
        token,
      });
      if (!jwtClaims) {
        return false;
      }

      return isGoogleHostedDomainAllowed(options.hd, jwtClaims.hd);
    },
  }) satisfies OAuthProvider<GoogleProfile>;
