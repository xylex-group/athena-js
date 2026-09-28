import type {
  NormalizedStripeBillingProviderConfig,
  StripeBillingProviderConfig,
} from "../../../../providers/types.ts";
import type { BillingProviderDefinition } from "../definition.ts";
import { createStripeBillingProviderRuntime } from "./runtime.ts";
import { normalizeStripeBillingProviderConfig } from "./config.ts";

export function createStripeProviderDefinition(): BillingProviderDefinition<
  NormalizedStripeBillingProviderConfig
> {
  return {
    configuration: {
      credentialKind: (config) => config.credentialKind,
      normalize: (config) =>
        normalizeStripeBillingProviderConfig(
          config as StripeBillingProviderConfig
        ),
    },
    provider: "stripe",
    runtime: {
      create: (config) => createStripeBillingProviderRuntime(config),
    },
  };
}
