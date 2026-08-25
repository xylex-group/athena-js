import { MOLLIE_BILLING_PROVIDER_CAPABILITIES } from "./local/providers/mollie/capabilities.ts";
import { STRIPE_BILLING_PROVIDER_CAPABILITIES } from "./local/providers/stripe/capabilities.ts";

/** Static provider implementation matrix. Docs and CI must consume this fixture. */
export const BILLING_PROVIDER_CAPABILITY_FIXTURE = {
	mollie: MOLLIE_BILLING_PROVIDER_CAPABILITIES,
	stripe: STRIPE_BILLING_PROVIDER_CAPABILITIES,
} as const;
