import type {
  MollieBillingProviderConfig,
  NormalizedMollieBillingProviderConfig,
} from "../../../../providers/types.ts";
import type { BillingProviderDefinition } from "../definition.ts";
import { createMollieBillingProviderRuntime } from "./runtime.ts";
import { normalizeMollieBillingProviderConfig } from "../config.ts";

export function createMollieProviderDefinition(): BillingProviderDefinition<
  NormalizedMollieBillingProviderConfig
> {
  return {
    configuration: {
      credentialKind: (config) => config.credentialKind,
      normalize: (config) =>
        normalizeMollieBillingProviderConfig(
          config as MollieBillingProviderConfig
        ),
    },
    provider: "mollie",
    runtime: {
      create: (config, context) =>
        createMollieBillingProviderRuntime(config, context?.catalog),
    },
  };
}
