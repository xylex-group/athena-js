import type {
  NormalizedStripeBillingProviderConfig,
  StripeBillingProviderConfig,
} from "../../../../providers/types.ts";
import type {
  BillingProviderBinding,
  BillingProviderCapabilities,
  StripeBillingProviderRuntime,
} from "../types.ts";
import { STRIPE_BILLING_PROVIDER_CAPABILITIES } from "./capabilities.ts";
import { normalizeStripeRuntimeConfig } from "./config.ts";

export class StripeBillingProviderRuntimeImpl
  implements StripeBillingProviderRuntime
{
  readonly provider = "stripe" as const;
  readonly payments = undefined;
  readonly customers = undefined;
  readonly refunds = undefined;
  readonly paymentLinks = undefined;
  readonly subscriptions = undefined;
  readonly invoices = undefined;
  readonly webhooks = undefined;

  constructor(readonly config: NormalizedStripeBillingProviderConfig) {}

  async getCapabilities(
    _binding: BillingProviderBinding
  ): Promise<BillingProviderCapabilities> {
    return STRIPE_BILLING_PROVIDER_CAPABILITIES;
  }
}

export function createStripeBillingProviderRuntime(
  config: StripeBillingProviderConfig | NormalizedStripeBillingProviderConfig
): StripeBillingProviderRuntime {
  return new StripeBillingProviderRuntimeImpl(
    normalizeStripeRuntimeConfig(config)
  );
}
