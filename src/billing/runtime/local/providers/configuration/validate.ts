import {
  ATHENA_BILLING_CONFIG_CONFLICT,
  AthenaBillingProviderError,
} from "../../../../errors.ts";
import type { BillingConfiguredProviders } from "./ir.ts";

export function validateBillingConfiguredProviders(
  configured: BillingConfiguredProviders
): BillingConfiguredProviders {
  for (const provider of configured.providers.values()) {
    const seen = new Set<string>();
    const slots = [
      ...(provider.defaultSlot == null ? [] : [provider.defaultSlot]),
      ...provider.slots.values(),
    ];
    for (const slot of slots) {
      const key = slot.slotKey ?? "default";
      if (seen.has(key)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_CONFIG_CONFLICT,
          message: `Billing provider slot "${provider.provider}:${key}" is declared more than once.`,
        });
      }
      seen.add(key);
    }
  }
  return configured;
}
