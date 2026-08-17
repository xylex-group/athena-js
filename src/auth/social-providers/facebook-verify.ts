import { athenaFetch as betterFetch } from "../fetch.ts";
import { getPrimaryClientId } from "../oauth2/index.ts";
import type { FacebookOptions } from "./facebook-types.ts";

interface FacebookDebugTokenData {
  app_id?: string;
  is_valid?: boolean;
  user_id?: string;
}

/**
 * Validate an opaque Facebook access token against the configured app.
 *
 * Facebook access tokens are not audience-bound at Graph `/me`: a token
 * minted for any Facebook app returns that app's profile. Without this check,
 * a token issued to an unrelated app could be accepted on the direct sign-in
 * path. Calls `debug_token` and requires the token to be valid, bound to one
 * of the configured client ids, and tied to a user.
 *
 * @see https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging
 *
 * @returns The inspected token's `user_id` when valid, otherwise `null`.
 */
export async function verifyFacebookAccessToken(
  accessToken: string,
  options: FacebookOptions
): Promise<string | null> {
  const primaryClientId = getPrimaryClientId(options.clientId);
  if (!(primaryClientId && options.clientSecret)) {
    return null;
  }
  const clientIds = Array.isArray(options.clientId)
    ? options.clientId
    : [options.clientId];
  const appAccessToken = `${primaryClientId}|${options.clientSecret}`;
  const { data, error } = await betterFetch<{ data?: FacebookDebugTokenData }>(
    "https://graph.facebook.com/debug_token",
    {
      query: {
        access_token: appAccessToken,
        input_token: accessToken,
      },
    }
  );
  if (error || !data?.data) {
    return null;
  }
  const { is_valid, app_id, user_id } = data.data;
  if (is_valid !== true || !app_id || !clientIds.includes(app_id) || !user_id) {
    return null;
  }
  return user_id;
}
