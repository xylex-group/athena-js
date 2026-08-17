import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
  generateCodeChallenge,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";
import type { ZoomOptions, ZoomProfile } from "./zoom-types.ts";

export type {
  LoginType,
  PhoneNumber,
  PronounOption,
  ZoomOptions,
  ZoomProfile,
} from "./zoom-types.ts";

/**
 * Zoom OAuth provider factory (Users API).
 *
 * @param userOptions - Client id/secret; PKCE defaults to enabled
 * @see https://developers.zoom.us/docs/integrations/oauth/
 */
export const zoom = (userOptions: ZoomOptions) => {
  const options = {
    pkce: true,
    ...userOptions,
  };

  return {
    createAuthorizationURL: async ({ state, redirectURI, codeVerifier }) => {
      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectURI ? options.redirectURI : redirectURI,
        response_type: "code",
        state,
      });

      if (options.pkce) {
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        params.set("code_challenge_method", "S256");
        params.set("code_challenge", codeChallenge);
      }

      const url = new URL("https://zoom.us/oauth/authorize");
      url.search = params.toString();

      return url;
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      const { data: profile, error } = await betterFetch<ZoomProfile>(
        "https://api.zoom.us/v2/users/me",
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
        data: {
          ...profile,
        },
        user: {
          email: profile.email,
          emailVerified: Boolean(profile.verified),
          id: profile.id,
          image: profile.pic_url,
          name: profile.display_name,
          ...userMap,
        },
      };
    },
    id: "zoom",
    name: "Zoom",
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) =>
          refreshAccessToken({
            authentication: "basic",
            options: {
              clientId: options.clientId,
              clientKey: options.clientKey,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint: "https://zoom.us/oauth/token",
          }),
    validateAuthorizationCode: async ({ code, redirectURI, codeVerifier }) =>
      validateAuthorizationCode({
        authentication: "basic",
        code,
        codeVerifier,
        options,
        redirectURI: options.redirectURI || redirectURI,
        tokenEndpoint: "https://zoom.us/oauth/token",
      }),
  } satisfies OAuthProvider<ZoomProfile>;
};
