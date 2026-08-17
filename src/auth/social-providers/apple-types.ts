import type { ProviderOptions } from "../oauth2/index.ts";

/**
 * Claims from a Sign in with Apple identity token (`id_token`).
 * @see https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/authenticating_users_with_sign_in_with_apple
 */
export interface AppleProfile {
  /**
   * A String value representing the user's email address.
   * The email address is either the user's real email address or the proxy
   * address, depending on their status private email relay service.
   */
  email?: string;
  /**
   * A string or Boolean value that indicates whether the service verifies
   * the email. The value can either be a string ("true" or "false") or a
   * Boolean (true or false). The system may not verify email addresses for
   * Sign in with Apple at Work & School users, and this claim is "false" or
   * false for those users.
   */
  email_verified: true | "true";
  /**
   * A string or Boolean value that indicates whether the email that the user
   * shares is the proxy address. The value can either be a string ("true" or
   * "false") or a Boolean (true or false).
   */
  is_private_email: boolean;
  /**
   * The user’s full name in the format provided during the authorization
   * process.
   */
  name: string;
  /**
   * The URL to the user's profile picture.
   */
  picture: string;
  /**
   * An Integer value that indicates whether the user appears to be a real
   * person. Use the value of this claim to mitigate fraud. The possible
   * values are: 0 (or Unsupported), 1 (or Unknown), 2 (or LikelyReal). For
   * more information, see ASUserDetectionStatus. This claim is present only
   * in iOS 14 and later, macOS 11 and later, watchOS 7 and later, tvOS 14
   * and later. The claim isn’t present or supported for web-based apps.
   */
  real_user_status: number;
  /**
   * The subject registered claim identifies the principal that’s the subject
   * of the identity token. Because this token is for your app, the value is
   * the unique identifier for the user.
   */
  sub: string;
  user?: AppleNonConformUser | undefined;
}

/**
 * Shape of the `user` field Apple returns **only on first consent**.
 *
 * After authorize (`GET https://appleid.apple.com/auth/authorize`), Apple may
 * include a JSON `user` parameter with name/email when those scopes were
 * requested. Subsequent authorizations omit this payload — persist it server-side.
 *
 * Name is **not** included in the identity token; validate/sanitize before storage.
 *
 * @see https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server
 */
export interface AppleNonConformUser {
  /** Email shared on first consent when the `email` scope was used. */
  email: string;
  /** Given / family name shared on first consent when the `name` scope was used. */
  name: {
    firstName: string;
    lastName: string;
  };
}

/**
 * Configuration for the Sign in with Apple social provider.
 */
export interface AppleOptions extends ProviderOptions<AppleProfile> {
  /**
   * Native app bundle identifier used as JWT audience when verifying
   * tokens issued to the mobile app (instead of the Services ID).
   */
  appBundleIdentifier?: string | undefined;
  /**
   * Explicit JWT audience override. Defaults to `appBundleIdentifier` or `clientId`.
   */
  audience?: (string | string[]) | undefined;
  clientId: string | string[];
}
