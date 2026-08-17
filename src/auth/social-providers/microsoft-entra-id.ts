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
import { base64 } from "../utils/base64.ts";
import { trimTrailingSlash } from "./helpers/trim-trailing-slash.ts";
import { getMicrosoftPublicKey } from "./microsoft-keys.ts";

import {
  MICROSOFT_CONSUMER_TENANT_ID,
  type MicrosoftEntraIDProfile,
  type MicrosoftOptions,
} from "./microsoft-types.ts";

export { getMicrosoftPublicKey } from "./microsoft-keys.ts";
export type {
  MicrosoftEntraIDProfile,
  MicrosoftOptions,
} from "./microsoft-types.ts";
export { MICROSOFT_CONSUMER_TENANT_ID } from "./microsoft-types.ts";

/**
 * Microsoft Entra ID (Azure AD) OAuth provider factory.
 *
 * Supports multi-tenant endpoints (common/organizations/consumers) with
 * explicit tenant-class checks on ID tokens.
 *
 * @param options - Client id, optional tenant/authority, profile photo settings
 */

export const microsoft = (options: MicrosoftOptions) => {
  const tenant = options.tenantId || "common";
  // Trim any trailing slash so endpoint URLs and the issuer comparison below
  // never produce a double slash (e.g. a configured `https://host/` would make
  // the expected issuer `https://host//<tid>/v2.0` and reject every token).
  const authority = trimTrailingSlash(
    options.authority || "https://login.microsoftonline.com"
  );
  const authorizationEndpoint = `${authority}/${tenant}/oauth2/v2.0/authorize`;
  const tokenEndpoint = `${authority}/${tenant}/oauth2/v2.0/token`;
  return {
    createAuthorizationURL(data) {
      // Microsoft Entra supports public clients (SPA / native apps with
      // PKCE only), so clientSecret is intentionally not required here.
      // See https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
      if (!getPrimaryClientId(options.clientId)) {
        logger.error(
          "Client Id is required for Microsoft Entra ID. Make sure to provide it in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      const scopes = options.disableDefaultScope
        ? []
        : ["openid", "profile", "email", "User.Read", "offline_access"];
      if (options.scope) {
        scopes.push(...options.scope);
      }
      if (data.scopes) {
        scopes.push(...data.scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint,
        codeVerifier: data.codeVerifier,
        id: "microsoft",
        loginHint: data.loginHint,
        options,
        prompt: options.prompt,
        redirectURI: data.redirectURI,
        scopes,
        state: data.state,
      });
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      if (!token.idToken) {
        return null;
      }
      const user = decodeJwt(token.idToken) as MicrosoftEntraIDProfile;
      const profilePhotoSize = options.profilePhotoSize || 48;
      await betterFetch<ArrayBuffer>(
        `https://graph.microsoft.com/v1.0/me/photos/${profilePhotoSize}x${profilePhotoSize}/$value`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
          async onResponse(context) {
            if (options.disableProfilePhoto || !context.response.ok) {
              return;
            }
            try {
              const response = context.response.clone();
              const pictureBuffer = await response.arrayBuffer();
              const pictureBase64 = base64.encode(pictureBuffer);
              user.picture = `data:image/jpeg;base64, ${pictureBase64}`;
            } catch (e) {
              logger.error(
                e && typeof e === "object" && "name" in e
                  ? (e.name as string)
                  : "",
                e
              );
            }
          },
        }
      );
      const userMap = await options.mapProfileToUser?.(user);
      // Microsoft Entra ID does NOT include email_verified claim by default.
      // It must be configured as an optional claim in the app registration.
      // We default to false when not provided for security consistency.
      // We can also check verified_primary_email/verified_secondary_email arrays as fallback.
      const emailVerified =
        user.email_verified === undefined
          ? !!(
              user.email &&
              (user.verified_primary_email?.includes(user.email) ||
                user.verified_secondary_email?.includes(user.email))
            )
          : user.email_verified;
      return {
        data: user,
        user: {
          email: user.email,
          emailVerified,
          id: user.sub,
          image: user.picture,
          name: user.name,
          ...userMap,
        },
      };
    },
    id: "microsoft",
    name: "Microsoft EntraID",
    options,
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) => {
          const scopes = options.disableDefaultScope
            ? []
            : ["openid", "profile", "email", "User.Read", "offline_access"];
          if (options.scope) {
            scopes.push(...options.scope);
          }

          return refreshAccessToken({
            extraParams: {
              scope: scopes.join(" "), // Include the scopes in request to microsoft
            },
            options: {
              clientId: options.clientId,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint,
          });
        },
    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      return validateAuthorizationCode({
        code,
        codeVerifier,
        options,
        redirectURI,
        tokenEndpoint,
      });
    },
    async verifyIdToken(token, nonce) {
      if (options.disableIdTokenSignIn) {
        return false;
      }
      if (options.verifyIdToken) {
        return options.verifyIdToken(token, nonce);
      }

      try {
        const { kid, alg: jwtAlg } = decodeProtectedHeader(token);
        if (!(kid && jwtAlg)) {
          return false;
        }

        const publicKey = await getMicrosoftPublicKey(kid, tenant, authority);
        const verifyOptions: {
          algorithms: [string];
          audience: string | string[];
          maxTokenAge: string;
          issuer?: string;
        } = {
          algorithms: [jwtAlg],
          audience: options.clientId,
          maxTokenAge: "1h",
        };
        /**
         * Issuer varies per user's tenant for multi-tenant endpoints, so only validate for specific tenants.
         * @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols#endpoints
         */
        if (
          tenant !== "common" &&
          tenant !== "organizations" &&
          tenant !== "consumers"
        ) {
          verifyOptions.issuer = `${authority}/${tenant}/v2.0`;
        }
        const { payload: jwtClaims } = await jwtVerify(
          token,
          publicKey,
          verifyOptions
        );

        if (nonce && jwtClaims.nonce !== nonce) {
          return false;
        }

        // The multi-tenant endpoints (common/organizations/consumers) skip
        // jose's issuer check above because the issuer varies per tenant, and
        // the organizations and consumers JWKS sets overlap. Enforce the tenant
        // binding explicitly so a token from a disallowed account class cannot
        // pass: the issuer must name the token's own tenant, and the account
        // class must match the configured restriction.
        // @see https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
        const tid = jwtClaims.tid;
        if (
          typeof tid !== "string" ||
          jwtClaims.iss !== `${authority}/${tid}/v2.0`
        ) {
          return false;
        }
        if (
          tenant === "organizations" &&
          tid === MICROSOFT_CONSUMER_TENANT_ID
        ) {
          return false;
        }
        if (tenant === "consumers" && tid !== MICROSOFT_CONSUMER_TENANT_ID) {
          return false;
        }

        return true;
      } catch (error) {
        logger.error("Failed to verify ID token:", error);
        return false;
      }
    },
  } satisfies OAuthProvider;
};
