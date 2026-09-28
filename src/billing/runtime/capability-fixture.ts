import { MOLLIE_BILLING_PROVIDER_CAPABILITIES } from "./local/providers/mollie/capabilities.ts";
import { STRIPE_BILLING_PROVIDER_CAPABILITIES } from "./local/providers/stripe/capabilities.ts";

/**
 * Static provider implementation matrix. Docs and CI consume this fixture.
 * Mollie is the implemented local provider. Stripe is a reserved slot: every
 * operation is `false` until a Stripe adapter and webhook verifier exist.
 * Do not flip Stripe `webhooks.*` to true without signature verification.
 */
export const BILLING_PROVIDER_CAPABILITY_FIXTURE = {
  mollie: MOLLIE_BILLING_PROVIDER_CAPABILITIES,
  stripe: STRIPE_BILLING_PROVIDER_CAPABILITIES,
} as const;
