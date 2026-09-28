import { createMollieProviderDefinition } from "./mollie/definition.ts";
import { createStripeProviderDefinition } from "./stripe/definition.ts";
import { BillingProviderDefinitionRegistry } from "./definitions.ts";

export function createBillingProviderDefinitionRegistry(): BillingProviderDefinitionRegistry {
  return new BillingProviderDefinitionRegistry([
    createMollieProviderDefinition(),
    createStripeProviderDefinition(),
  ]);
}
