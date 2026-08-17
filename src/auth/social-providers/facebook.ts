import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
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
import type { FacebookOptions, FacebookProfile } from "./facebook-types.ts";
import { verifyFacebookAccessToken } from "./facebook-verify.ts";

export type { FacebookOptions, FacebookProfile } from "./facebook-types.ts";
export { verifyFacebookAccessToken } from "./facebook-verify.ts";

/**
 * Facebook Login OAuth provider factory (Graph API v24).
 *
 * Supports limited-login JWT ID tokens and opaque access tokens (with
 * `debug_token` app binding).
 *
 * @param options - App id/secret and optional field extensions
 */
export const facebook = (options: FacebookOptions) => {
  return {
    async createAuthorizationURL({ state, scopes, redirectURI, loginHint }) {
      if (!(getPrimaryClientId(options.clientId) && options.clientSecret)) {
        logger.error(
          "Client ID and client secret are required for Facebook. Make sure to provide them in the options."
        );
        throw new AthenaAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
      }
      const _scopes = options.disableDefaultScope
        ? []
        : ["email", "public_profile"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return await createAuthorizationURL({
        additionalParams: options.configId
          ? {
              config_id: options.configId,
            }
          : {},
        authorizationEndpoint: "https://www.facebook.com/v24.0/dialog/oauth",
        id: "facebook",
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

      if (token.idToken && token.idToken.split(".").length === 3) {
        const profile = decodeJwt(token.idToken) as {
          sub: string;
          email: string;
          name: string;
          picture: string;
        };

        const user = {
          email: profile.email,
          id: profile.sub,
          name: profile.name,
          picture: {
            data: {
              height: 100,
              is_silhouette: false,
              url: profile.picture,
              width: 100,
            },
          },
        };

        // https://developers.facebook.com/docs/facebook-login/limited-login/permissions
        // Facebook ID token does not include email_verified claim.
        // We default to false for security consistency.
        const userMap = await options.mapProfileToUser?.({
          ...user,
          email_verified: false,
        });

        return {
          data: profile,
          user: {
            ...user,
            emailVerified: false,
            ...userMap,
          },
        };
      }

      // The profile is fetched with `accessToken`, which is the credential
      // that actually proves identity here — and a separate request field
      // from the `idToken`/token validated by `verifyIdToken`. Since an
      // opaque token is not app-bound at `/me`, validate this exact token
      // against the configured app before trusting the profile it returns.
      const accessToken = token.accessToken;
      if (!accessToken) {
        return null;
      }
      const tokenUserId = await verifyFacebookAccessToken(accessToken, options);
      if (!tokenUserId) {
        return null;
      }

      const fields = [
        "id",
        "name",
        "email",
        "picture",
        ...(options?.fields || []),
      ];
      const { data: profile, error } = await betterFetch<FacebookProfile>(
        `https://graph.facebook.com/me?fields=${fields.join(",")}`,
        {
          auth: {
            token: accessToken,
            type: "Bearer",
          },
        }
      );
      if (error) {
        return null;
      }
      // Bind the validated token to the profile it returned.
      if (profile.id !== tokenUserId) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      return {
        data: profile,
        user: {
          email: profile.email,
          emailVerified: profile.email_verified ?? false,
          id: profile.id,
          image: profile.picture.data.url,
          name: profile.name,
          ...userMap,
        },
      };
    },
    id: "facebook",
    name: "Facebook",
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
            tokenEndpoint:
              "https://graph.facebook.com/v24.0/oauth/access_token",
          }),
    validateAuthorizationCode: async ({ code, redirectURI }) =>
      validateAuthorizationCode({
        code,
        options,
        redirectURI,
        tokenEndpoint: "https://graph.facebook.com/v24.0/oauth/access_token",
      }),
    async verifyIdToken(token, nonce) {
      if (options.disableIdTokenSignIn) {
        return false;
      }

      if (options.verifyIdToken) {
        return options.verifyIdToken(token, nonce);
      }

      /* limited login */
      // check is limited token
      if (token.split(".").length === 3) {
        try {
          const { payload: jwtClaims } = await jwtVerify(
            token,
            createRemoteJWKSet(
              // https://developers.facebook.com/docs/facebook-login/limited-login/token/#jwks
              new URL(
                "https://limited.facebook.com/.well-known/oauth/openid/jwks/"
              )
            ),
            {
              algorithms: ["RS256"],
              audience: options.clientId,
              issuer: "https://www.facebook.com",
            }
          );

          if (nonce && jwtClaims.nonce !== nonce) {
            return false;
          }

          return !!jwtClaims;
        } catch {
          return false;
        }
      }

      /* access_token */
      // An opaque access token carries no app binding of its own, so it
      // must be validated against the configured app before it can be
      // trusted as proof of identity.
      return (await verifyFacebookAccessToken(token, options)) !== null;
    },
  } satisfies OAuthProvider<FacebookProfile>;
};
