import type { Awaitable, LiteralString } from "../types/index.ts";

export interface OAuth2Tokens {
  accessToken?: string | undefined;
  accessTokenExpiresAt?: Date | undefined;
  idToken?: string | undefined;
  /**
   * Raw token response from the provider.
   * Preserves provider-specific fields that are not part of the standard OAuth2 token response.
   */
  raw?: Record<string, unknown> | undefined;
  refreshToken?: string | undefined;
  refreshTokenExpiresAt?: Date | undefined;
  scopes?: string[] | undefined;
  tokenType?: string | undefined;
}

export interface OAuth2UserInfo {
  email?: (string | null) | undefined;
  emailVerified: boolean;
  id: string | number;
  image?: string | undefined;
  name?: string | undefined;
}

// Provider profile bags and option maps intentionally use open records so
// concrete provider interfaces remain assignable without forcing index signatures.
export interface OAuthProvider<
  // biome-ignore lint/suspicious/noExplicitAny: open provider profile bag for assignability
  T extends Record<string, any> = Record<string, any>,
  // biome-ignore lint/suspicious/noExplicitAny: open provider options bag for assignability
  O extends Record<string, any> = Partial<ProviderOptions>,
> {
  createAuthorizationURL: (data: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
  }) => Awaitable<URL>;
  /**
   * Disable implicit sign up for new users. When set to true for the provider,
   * sign-in need to be called with with requestSignUp as true to create new users.
   */
  disableImplicitSignUp?: boolean | undefined;
  /**
   * Disable sign up for new users.
   */
  disableSignUp?: boolean | undefined;
  getUserInfo: (
    token: OAuth2Tokens & {
      /**
       * The user object from the provider
       * This is only available for some providers like Apple
       */
      user?:
        | {
            name?: {
              firstName?: string;
              lastName?: string;
            };
            email?: string;
          }
        | undefined;
    }
  ) => Promise<{
    user: OAuth2UserInfo;
    data: T;
  } | null>;
  id: LiteralString;
  name: string;
  /**
   * Options for the provider
   */
  options?: O | undefined;
  /**
   * Custom function to refresh a token
   */
  refreshAccessToken?:
    | ((refreshToken: string) => Promise<OAuth2Tokens>)
    | undefined;
  revokeToken?: ((token: string) => Promise<void>) | undefined;
  validateAuthorizationCode: (data: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens | null>;
  /**
   * Verify the id token
   * @param token - The id token
   * @param nonce - The nonce
   * @returns True if the id token is valid, false otherwise
   */
  verifyIdToken?:
    | ((token: string, nonce?: string) => Promise<boolean>)
    | undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: default profile is open; constraint uses any for assignability
export interface ProviderOptions<Profile extends Record<string, any> = any> {
  /**
   * Custom authorization endpoint URL.
   * Use this to override the default authorization endpoint of the provider.
   * Useful for testing with local OAuth servers or using sandbox environments.
   */
  authorizationEndpoint?: string | undefined;
  /**
   * The client ID of your application.
   *
   * This is usually a string but can be any type depending on the provider.
   */
  clientId?: unknown | undefined;
  /**
   * The client key of your application
   * Tiktok Social Provider uses this field instead of clientId
   */
  clientKey?: string | undefined;
  /**
   * The client secret of your application
   */
  clientSecret?: string | undefined;
  /**
   * Remove default scopes of the provider
   */
  disableDefaultScope?: boolean | undefined;
  /**
   * Disable provider from allowing users to sign in
   * with this provider with an id token sent from the
   * client.
   */
  disableIdTokenSignIn?: boolean | undefined;
  /**
   * Disable implicit sign up for new users. When set to true for the provider,
   * sign-in need to be called with with requestSignUp as true to create new users.
   */
  disableImplicitSignUp?: boolean | undefined;
  /**
   * Disable sign up for new users.
   */
  disableSignUp?: boolean | undefined;
  /**
   * Custom function to get user info from the provider
   */
  getUserInfo?:
    | ((token: OAuth2Tokens) => Promise<{
        user: {
          id: string;
          name?: string;
          email?: string | null;
          image?: string;
          emailVerified: boolean;
          // biome-ignore lint/suspicious/noExplicitAny: allow provider-specific user fields
          [key: string]: any;
        };
        // biome-ignore lint/suspicious/noExplicitAny: provider profile payload
        data: any;
      } | null>)
    | undefined;
  /**
   * Custom function to map the provider profile to a
   * user.
   */
  mapProfileToUser?:
    | ((profile: Profile) =>
        | {
            id?: string;
            name?: string;
            email?: string | null;
            image?: string;
            emailVerified?: boolean;
            // biome-ignore lint/suspicious/noExplicitAny: allow extra mapped fields
            [key: string]: any;
          }
        | Promise<{
            id?: string;
            name?: string;
            email?: string | null;
            image?: string;
            emailVerified?: boolean;
            // biome-ignore lint/suspicious/noExplicitAny: allow extra mapped fields
            [key: string]: any;
          }>)
    | undefined;
  /**
   * If enabled, the user info will be overridden with the provider user info
   * This is useful if you want to use the provider user info to update the user info
   *
   * @default false
   */
  overrideUserInfoOnSignIn?: boolean | undefined;
  /**
   * The prompt to use for the authorization code request
   */
  prompt?:
    | (
        | "select_account"
        | "consent"
        | "login"
        | "none"
        | "select_account consent"
      )
    | undefined;
  /**
   * The redirect URL for your application. This is where the provider will
   * redirect the user after the sign in process. Make sure this URL is
   * whitelisted in the provider's dashboard.
   */
  redirectURI?: string | undefined;
  /**
   * Custom function to refresh a token
   */
  refreshAccessToken?:
    | ((refreshToken: string) => Promise<OAuth2Tokens>)
    | undefined;
  /**
   * The response mode to use for the authorization code request
   */
  responseMode?: ("query" | "form_post") | undefined;
  /**
   * The scopes you want to request from the provider
   */
  scope?: string[] | undefined;
  /**
   * verifyIdToken function to verify the id token
   */
  verifyIdToken?:
    | ((token: string, nonce?: string) => Promise<boolean>)
    | undefined;
}
