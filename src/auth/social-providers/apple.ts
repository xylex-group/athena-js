import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  getPrimaryClientId,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";
import { nonceMatches } from "./apple-crypto.ts";
import { getApplePublicKey } from "./apple-keys.ts";
import type { AppleOptions, AppleProfile } from "./apple-types.ts";

export { getApplePublicKey } from "./apple-keys.ts";
export type {
  AppleNonConformUser,
  AppleOptions,
  AppleProfile,
} from "./apple-types.ts";

/**
 * Sign in with Apple OAuth provider factory.
 *
 * Uses `response_mode=form_post` and `code id_token` when requesting
 * name/email scopes (Apple REST API requirements).
 *
 * @param options - Apple Services ID / client secret configuration
 */
export const apple = (options: AppleOptions) => {
  const tokenEndpoint = "https://appleid.apple.com/auth/token";
  return {
    async createAuthorizationURL({ state, scopes, redirectURI }) {
      if (!(getPrimaryClientId(options.clientId) && options.clientSecret)) {
        logger.error(
          "Client ID and client secret are required for Apple. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      const _scope = options.disableDefaultScope ? [] : ["email", "name"];
      if (options.scope) {
        _scope.push(...options.scope);
      }
      if (scopes) {
        _scope.push(...scopes);
      }
      const url = await createAuthorizationURL({
        authorizationEndpoint: "https://appleid.apple.com/auth/authorize",
        id: "apple",
        options,
        redirectURI,
        responseMode: "form_post",
        responseType: "code id_token",
        scopes: _scope,
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
      const profile = decodeJwt<AppleProfile>(token.idToken);
      if (!profile) {
        return null;
      }

      // TODO: "" masking will be removed when the name field is made optional
      let name: string;
      if (token.user?.name) {
        const firstName = token.user.name.firstName || "";
        const lastName = token.user.name.lastName || "";
        const fullName = `${firstName} ${lastName}`.trim();
        name = fullName;
      } else {
        name = profile.name || "";
      }

      const emailVerified =
        typeof profile.email_verified === "boolean"
          ? profile.email_verified
          : profile.email_verified === "true";
      const enrichedProfile = {
        ...profile,
        name,
      };
      const userMap = await options.mapProfileToUser?.(enrichedProfile);
      return {
        data: enrichedProfile,
        user: {
          email: profile.email,
          emailVerified,
          id: profile.sub,
          name: enrichedProfile.name,
          ...userMap,
        },
      };
    },
    id: "apple",
    name: "Apple",
    options,
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) =>
          refreshAccessToken({
            options,
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
      try {
        const decodedHeader = decodeProtectedHeader(token);
        const { kid, alg: jwtAlg } = decodedHeader;
        if (!(kid && jwtAlg)) {
          return false;
        }
        const publicKey = await getApplePublicKey(kid);
        const { payload: jwtClaims } = await jwtVerify(token, publicKey, {
          algorithms: [jwtAlg],
          audience: options.audience?.length
            ? options.audience
            : options.appBundleIdentifier
              ? options.appBundleIdentifier
              : options.clientId,
          issuer: "https://appleid.apple.com",
          maxTokenAge: "1h",
        });
        ["email_verified", "is_private_email"].forEach((field) => {
          if (jwtClaims[field] !== undefined) {
            jwtClaims[field] = Boolean(jwtClaims[field]);
          }
        });
        if (nonce && !(await nonceMatches(jwtClaims.nonce, nonce))) {
          return false;
        }
        return !!jwtClaims;
      } catch {
        return false;
      }
    },
  } satisfies OAuthProvider<AppleProfile>;
};
