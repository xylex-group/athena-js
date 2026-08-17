import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import { createAuthorizationURL } from "../oauth2/index.ts";
import { base64 } from "../utils/base64.ts";
import { getPayPalPublicKey } from "./paypal-keys.ts";
import type {
  PayPalOptions,
  PayPalProfile,
  PayPalTokenResponse,
} from "./paypal-types.ts";

export { getPayPalPublicKey } from "./paypal-keys.ts";
export type {
  PayPalOptions,
  PayPalProfile,
  PayPalTokenResponse,
} from "./paypal-types.ts";

/**
 * ID token signing algorithms advertised by PayPal's OpenID configuration.
 * Anything outside this allowlist is rejected so each token is only ever
 * verified with the algorithm it was issued for.
 *
 * @see https://www.paypal.com/.well-known/openid-configuration
 */
const PAYPAL_ID_TOKEN_ALGORITHMS = ["RS256", "HS256"] as const;

/**
 * PayPal Login with PayPal OAuth provider factory.
 *
 * @param options - Client credentials and sandbox/live environment
 * @returns OAuth provider implementation for PayPal
 */
export const paypal = (options: PayPalOptions) => {
  const environment = options.environment || "sandbox";
  const isSandbox = environment === "sandbox";

  const authorizationEndpoint = isSandbox
    ? "https://www.sandbox.paypal.com/signin/authorize"
    : "https://www.paypal.com/signin/authorize";

  const tokenEndpoint = isSandbox
    ? "https://api-m.sandbox.paypal.com/v1/oauth2/token"
    : "https://api-m.paypal.com/v1/oauth2/token";

  const userInfoEndpoint = isSandbox
    ? "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo"
    : "https://api-m.paypal.com/v1/identity/oauth2/userinfo";

  /**
   * Issuer and JWKS endpoints used to cryptographically verify ID tokens.
   *
   * @see https://www.paypal.com/.well-known/openid-configuration
   */
  const issuer = isSandbox
    ? "https://www.sandbox.paypal.com"
    : "https://www.paypal.com";

  const jwksEndpoint = isSandbox
    ? "https://api.sandbox.paypal.com/v1/oauth2/certs"
    : "https://api.paypal.com/v1/oauth2/certs";

  return {
    async createAuthorizationURL({ state, codeVerifier, redirectURI }) {
      if (!(options.clientId && options.clientSecret)) {
        logger.error(
          "Client Id and Client Secret is required for PayPal. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }

      /**
       * Log in with PayPal doesn't use traditional OAuth2 scopes
       * Instead, permissions are configured in the PayPal Developer Dashboard
       * We don't pass any scopes to avoid "invalid scope" errors
       */

      const _scopes: string[] = [];

      const url = await createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier,
        id: "paypal",
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

      if (!token.accessToken) {
        logger.error("Access token is required to fetch PayPal user info");
        return null;
      }

      try {
        const response = await betterFetch<PayPalProfile>(
          `${userInfoEndpoint}?schema=paypalv1.1`,
          {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token.accessToken}`,
            },
          }
        );

        if (!response.data) {
          logger.error("Failed to fetch user info from PayPal");
          return null;
        }

        const userInfo = response.data;
        if (token.idToken) {
          let idTokenSubject: string | undefined;
          try {
            idTokenSubject = decodeJwt(token.idToken).sub;
          } catch (error) {
            logger.error("Failed to decode PayPal ID token:", error);
            return null;
          }

          // OIDC binds UserInfo to the ID Token with `sub`. Keep `user_id`
          // as the account id below for existing PayPal account mappings.
          const userInfoSubject = userInfo.sub ?? userInfo.user_id;
          if (!idTokenSubject || userInfoSubject !== idTokenSubject) {
            logger.error(
              "PayPal user info subject does not match ID token subject"
            );
            return null;
          }
        }

        const userMap = await options.mapProfileToUser?.(userInfo);

        const result = {
          data: userInfo,
          user: {
            email: userInfo.email,
            emailVerified: userInfo.email_verified,
            id: userInfo.user_id,
            image: userInfo.picture,
            name: userInfo.name,
            ...userMap,
          },
        };

        return result;
      } catch (error) {
        logger.error("Failed to fetch user info from PayPal:", error);
        return null;
      }
    },
    id: "paypal",
    name: "PayPal",

    options,

    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) => {
          const credentials = base64.encode(
            `${options.clientId}:${options.clientSecret}`
          );

          try {
            const response = await betterFetch(tokenEndpoint, {
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
              }).toString(),
              headers: {
                Accept: "application/json",
                "Accept-Language": "en_US",
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              method: "POST",
            });

            if (!response.data) {
              throw new AthenaAuthError("FAILED_TO_REFRESH_ACCESS_TOKEN");
            }

            const data = response.data as {
              access_token?: string;
              refresh_token?: string;
              expires_in?: number;
            };
            return {
              accessToken: data.access_token,
              accessTokenExpiresAt: data.expires_in
                ? new Date(Date.now() + data.expires_in * 1000)
                : undefined,
              refreshToken: data.refresh_token,
            };
          } catch (error) {
            logger.error("PayPal token refresh failed:", error);
            throw new AthenaAuthError("FAILED_TO_REFRESH_ACCESS_TOKEN", {
              cause: error,
            });
          }
        },

    validateAuthorizationCode: async ({ code, redirectURI }) => {
      /**
       * PayPal requires Basic Auth for token exchange
       */

      const credentials = base64.encode(
        `${options.clientId}:${options.clientSecret}`
      );

      try {
        const response = await betterFetch(tokenEndpoint, {
          body: new URLSearchParams({
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectURI,
          }).toString(),
          headers: {
            Accept: "application/json",
            "Accept-Language": "en_US",
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        });

        if (!response.data) {
          throw new AthenaAuthError("FAILED_TO_GET_ACCESS_TOKEN");
        }

        const data = response.data as PayPalTokenResponse;

        const result = {
          accessToken: data.access_token,
          accessTokenExpiresAt: data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : undefined,
          idToken: data.id_token,
          refreshToken: data.refresh_token,
        };

        return result;
      } catch (error) {
        logger.error("PayPal token exchange failed:", error);
        throw new AthenaAuthError("FAILED_TO_GET_ACCESS_TOKEN", {
          cause: error,
        });
      }
    },

    async verifyIdToken(token, nonce) {
      if (options.disableIdTokenSignIn) {
        return false;
      }
      if (options.verifyIdToken) {
        return options.verifyIdToken(token, nonce);
      }

      // Cryptographically verify the ID token. Decoding alone is not enough:
      // the signature, issuer, audience and expiration must all be checked
      // before the token's claims can be relied on as proof of identity.
      // See https://www.paypal.com/.well-known/openid-configuration

      try {
        const { kid, alg: jwtAlg } = decodeProtectedHeader(token);
        if (!jwtAlg) {
          return false;
        }
        if (
          !PAYPAL_ID_TOKEN_ALGORITHMS.includes(
            jwtAlg as (typeof PAYPAL_ID_TOKEN_ALGORITHMS)[number]
          )
        ) {
          return false;
        }

        // PayPal can sign ID tokens either asymmetrically (RS256, verified
        // against the published JWKS) or symmetrically (HS256, verified with
        // the client secret). Selecting the key by algorithm keeps the two
        // paths separate so each algorithm is only verified with its
        // corresponding key type.
        const key =
          jwtAlg === "HS256"
            ? new TextEncoder().encode(options.clientSecret)
            : kid
              ? await getPayPalPublicKey(kid, jwksEndpoint)
              : undefined;
        if (!key) {
          return false;
        }

        const { payload: jwtClaims } = await jwtVerify(token, key, {
          algorithms: [jwtAlg],
          audience: options.clientId,
          issuer,
          maxTokenAge: "1h",
        });

        if (nonce && jwtClaims.nonce !== nonce) {
          return false;
        }

        return true;
      } catch (error) {
        logger.error("Failed to verify PayPal ID token:", error);
        return false;
      }
    },
  } satisfies OAuthProvider<PayPalProfile>;
};
