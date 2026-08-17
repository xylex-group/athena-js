import type { ProviderOptions } from "../oauth2/index.ts";

/**
 * Facebook Graph API user profile fields used by the OAuth provider.
 * @see https://developers.facebook.com/docs/graph-api/reference/user
 */
export interface FacebookProfile {
  email?: string;
  email_verified?: boolean;
  id: string;
  name: string;
  picture: {
    data: {
      height: number;
      is_silhouette: boolean;
      url: string;
      width: number;
    };
  };
}

/**
 * Configuration for the Facebook social provider.
 */
export interface FacebookOptions extends ProviderOptions<FacebookProfile> {
  clientId: string | string[];

  /**
   * The config id to use when undergoing oauth
   */
  configId?: string | undefined;
  /**
   * Extend list of fields to retrieve from the Facebook user profile.
   *
   * @default ["id", "name", "email", "picture"]
   */
  fields?: string[] | undefined;
}
