import {
  ATHENA_BILLING_PROVIDER_NOT_REGISTERED,
  AthenaBillingProviderError,
} from "../../../errors.ts";
import type { BillingProviderName } from "../../../types.ts";
import type { BillingProviderDefinition } from "./definition.ts";

export class BillingProviderDefinitionRegistry {
  private readonly definitions = new Map<
    BillingProviderName,
    BillingProviderDefinition
  >();

  constructor(definitions: readonly BillingProviderDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  get(provider: BillingProviderName): BillingProviderDefinition | undefined {
    return this.definitions.get(provider.trim().toLowerCase());
  }

  has(provider: BillingProviderName): boolean {
    return this.get(provider) != null;
  }

  list(): readonly BillingProviderDefinition[] {
    return Object.freeze([...this.definitions.values()]);
  }

  register(definition: BillingProviderDefinition): void {
    const provider = definition.provider.trim().toLowerCase();
    if (this.definitions.has(provider)) {
      throw new Error(`Billing provider definition "${provider}" is already registered.`);
    }
    this.definitions.set(provider, definition);
  }

  require(provider: BillingProviderName): BillingProviderDefinition {
    const definition = this.get(provider);
    if (definition == null) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_NOT_REGISTERED,
        message: `Billing provider definition "${provider}" is not registered.`,
      });
    }
    return definition;
  }
}
