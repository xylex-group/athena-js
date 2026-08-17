import type { ProviderOptions } from "../oauth2/index.ts";

/**
 * PayPal Login with PayPal userinfo profile (schema paypalv1.1).
 * @see https://developer.paypal.com/docs/log-in-with-paypal/
 */
export interface PayPalProfile {
  account_type?: string | undefined;
  address?:
    | {
        street_address?: string;
        locality?: string;
        region?: string;
        postal_code?: string;
        country?: string;
      }
    | undefined;
  age_range?: string | undefined;
  birthdate?: string | undefined;
  email: string;
  email_verified: boolean;
  family_name: string;
  gender?: string | undefined;
  given_name: string;
  locale?: string | undefined;
  middle_name?: string | undefined;
  name: string;
  payer_id?: string | undefined;
  phone_number?: string | undefined;
  picture?: string | undefined;
  sub?: string | undefined;
  user_id: string;
  verified_account?: boolean | undefined;
  zoneinfo?: string | undefined;
}

export interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string | undefined;
  nonce?: string | undefined;
  refresh_token?: string | undefined;
  scope?: string | undefined;
  token_type: "Bearer";
}

export interface PayPalOptions extends ProviderOptions<PayPalProfile> {
  clientId: string;
  /**
   * PayPal environment - 'sandbox' for testing, 'live' for production
   * @default 'sandbox'
   */
  environment?: ("sandbox" | "live") | undefined;
  /**
   * Whether to request shipping address information
   * @default false
   */
  requestShippingAddress?: boolean | undefined;
}
