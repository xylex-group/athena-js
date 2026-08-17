import type { ProviderOptions } from "../oauth2/index.ts";

/**
 * Google OpenID Connect ID-token claims used by the Google social provider.
 * @see https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload
 */
export interface GoogleProfile {
  aud: string;
  azp: string;
  email: string;
  email_verified: boolean;
  exp: number;
  /**
   * The family name of the user, or last name in most
   * Western languages.
   */
  family_name: string;
  /**
   * The given name of the user, or first name in most
   * Western languages.
   */
  given_name: string;
  hd?: string | undefined;
  iat: number;
  iss: string;
  jti?: string | undefined;
  locale?: string | undefined;
  name: string;
  nbf?: number | undefined;
  picture: string;
  sub: string;
}

/**
 * Configuration for the Google OAuth / OpenID Connect provider.
 */
export interface GoogleOptions extends ProviderOptions<GoogleProfile> {
  /**
   * The access type to use for the authorization code request.
   * Use `offline` to receive a refresh token.
   */
  accessType?: ("offline" | "online") | undefined;
  clientId: string | string[];
  /**
   * The display mode to use for the authorization code request.
   */
  display?: ("page" | "popup" | "touch" | "wap") | undefined;
  /**
   * Hosted domain (Google Workspace) the user must belong to.
   *
   * Sent as the `hd` authorization hint and enforced against the ID token
   * `hd` claim. Use `"*"` to require any Workspace domain.
   */
  hd?: string | undefined;
}

/** Inputs for {@link verifyGoogleIdToken}. */
export interface VerifyGoogleIdTokenOptions {
  audience: string | string[];
  nonce?: string | undefined;
  token: string;
}

/** Maximum accepted age for Google ID tokens during local verification. */
export const GOOGLE_ID_TOKEN_MAX_AGE = "1h";
