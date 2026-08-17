import type { ProviderOptions } from "../oauth2/index.ts";

/**
 * Amazon Cognito User Pool ID-token / userinfo claims.
 * Custom attributes may appear as additional string keys.
 */
export interface CognitoProfile {
  aud: string;
  email: string;
  email_verified: boolean;
  exp: number;
  family_name?: string | undefined;
  given_name?: string | undefined;
  iat: number;
  iss: string;
  locale?: string | undefined;
  name: string;
  phone_number?: string | undefined;
  phone_number_verified?: boolean | undefined;
  picture?: string | undefined;
  sub: string;
  username?: string | undefined;
  // Custom attributes from Cognito can be added here
  [key: string]: unknown;
}

export interface CognitoOptions extends ProviderOptions<CognitoProfile> {
  clientId: string | string[];
  /**
   * The Cognito domain (e.g., "your-app.auth.us-east-1.amazoncognito.com")
   */
  domain: string;
  /**
   * AWS region where User Pool is hosted (e.g., "us-east-1")
   */
  region: string;
  requireClientSecret?: boolean | undefined;
  userPoolId: string;
}
