import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  getPrimaryClientId,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";
import { getCognitoPublicKey } from "./cognito-keys.ts";
import type { CognitoOptions, CognitoProfile } from "./cognito-types.ts";

export { getCognitoPublicKey } from "./cognito-keys.ts";
export type { CognitoOptions, CognitoProfile } from "./cognito-types.ts";

/**
 * Amazon Cognito Hosted UI OAuth provider factory.
 *
 * @param options - Domain, region, user pool id, and app client settings
 */
export const cognito = (options: CognitoOptions) => {
  if (!(options.domain && options.region && options.userPoolId)) {
    logger.error(
      "Domain, region and userPoolId are required for Amazon Cognito. Make sure to provide them in the options."
    );
    throw new AthenaAuthError("DOMAIN_AND_REGION_REQUIRED");
  }

  const cleanDomain = options.domain.replace(/^https?:\/\//, "");
  const authorizationEndpoint = `https://${cleanDomain}/oauth2/authorize`;
  const tokenEndpoint = `https://${cleanDomain}/oauth2/token`;
  const userInfoEndpoint = `https://${cleanDomain}/oauth2/userinfo`;

  return {
    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      if (!getPrimaryClientId(options.clientId)) {
        logger.error(
          "ClientId is required for Amazon Cognito. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }

      if (options.requireClientSecret && !options.clientSecret) {
        logger.error(
          "Client Secret is required when requireClientSecret is true. Make sure to provide it in the options."
        );
        throw new AthenaAuthError("CLIENT_SECRET_REQUIRED");
      }
      const _scopes = options.disableDefaultScope
        ? []
        : ["openid", "profile", "email"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }

      const url = await createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "cognito",
        options: {
          ...options,
        },
        prompt: options.prompt,
        redirectURI,
        scopes: _scopes,
        state,
      });
      // AWS Cognito requires scopes to be encoded with %20 instead of +
      // URLSearchParams encodes spaces as + by default, so we need to fix this
      const scopeValue = url.searchParams.get("scope");
      if (scopeValue) {
        url.searchParams.delete("scope");
        const encodedScope = encodeURIComponent(scopeValue);
        // Manually append the scope with proper encoding to the URL
        const urlString = url.toString();
        const separator = urlString.includes("?") ? "&" : "?";
        return new URL(`${urlString}${separator}scope=${encodedScope}`);
      }
      return url;
    },

    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }

      if (token.idToken) {
        try {
          const profile = decodeJwt<CognitoProfile>(token.idToken);
          if (!profile) {
            return null;
          }
          const name =
            profile.name || profile.given_name || profile.username || "";
          const enrichedProfile = {
            ...profile,
            name,
          };
          const userMap = await options.mapProfileToUser?.(enrichedProfile);

          return {
            data: enrichedProfile,
            user: {
              email: profile.email,
              emailVerified: profile.email_verified,
              id: profile.sub,
              image: profile.picture,
              name: enrichedProfile.name,
              ...userMap,
            },
          };
        } catch (error) {
          logger.error("Failed to decode ID token:", error);
        }
      }

      if (token.accessToken) {
        try {
          const { data: userInfo } = await betterFetch<CognitoProfile>(
            userInfoEndpoint,
            {
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
              },
            }
          );

          if (userInfo) {
            const userMap = await options.mapProfileToUser?.(userInfo);
            return {
              data: userInfo,
              user: {
                email: userInfo.email,
                emailVerified: userInfo.email_verified,
                id: userInfo.sub,
                image: userInfo.picture,
                name:
                  userInfo.name ||
                  userInfo.given_name ||
                  userInfo.username ||
                  "",
                ...userMap,
              },
            };
          }
        } catch (error) {
          logger.error("Failed to fetch user info from Cognito:", error);
        }
      }

      return null;
    },
    id: "cognito",
    name: "Cognito",

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

        const publicKey = await getCognitoPublicKey(
          kid,
          options.region,
          options.userPoolId
        );
        const expectedIssuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;

        const { payload: jwtClaims } = await jwtVerify(token, publicKey, {
          algorithms: [jwtAlg],
          audience: options.clientId,
          issuer: expectedIssuer,
          maxTokenAge: "1h",
        });

        if (nonce && jwtClaims.nonce !== nonce) {
          return false;
        }
        return true;
      } catch (error) {
        logger.error("Failed to verify ID token:", error);
        return false;
      }
    },
  } satisfies OAuthProvider<CognitoProfile>;
};
