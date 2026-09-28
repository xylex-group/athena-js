import {
  ATHENA_BILLING_PROVIDER_NOT_REGISTERED,
  AthenaBillingProviderError,
} from "../../../errors.ts";
import type { BillingProviderName } from "../../../types.ts";
import type { BillingProviderRuntime } from "./types.ts";

export function normalizeBillingProviderName(
  provider: string
): BillingProviderName {
  return provider.trim().toLowerCase() as BillingProviderName;
}

export class BillingProviderRegistry {
  ingress?: {
    classicWebhookUrl?: string;
    classicWebhookUrlsByConnectionId?: Readonly<Record<string, string>>;
  };
  private readonly runtimes = new Map<string, BillingProviderRuntime>();

  constructor(
    runtimes: readonly BillingProviderRuntime[] = [],
    options?: {
      ingress?: {
        classicWebhookUrl?: string;
        classicWebhookUrlsByConnectionId?: Readonly<Record<string, string>>;
      };
    }
  ) {
    this.ingress = options?.ingress;
    for (const runtime of runtimes) {
      this.register(runtime);
    }
  }

  register(runtime: BillingProviderRuntime): void {
    const name = normalizeBillingProviderName(runtime.provider);
    if (this.runtimes.has(name)) {
      throw new Error(`Billing provider "${name}" is already registered.`);
    }
    this.runtimes.set(name, runtime);
  }

  has(provider: string): boolean {
    return this.runtimes.has(normalizeBillingProviderName(provider));
  }

  get(provider: string): BillingProviderRuntime | undefined {
    return this.runtimes.get(normalizeBillingProviderName(provider));
  }

  require(provider: string): BillingProviderRuntime {
    const runtime = this.get(provider);
    if (runtime == null) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_NOT_REGISTERED,
        message: `Billing provider "${normalizeBillingProviderName(provider)}" is not registered.`,
      });
    }
    return runtime;
  }

  list(): readonly BillingProviderRuntime[] {
    return Object.freeze([...this.runtimes.values()]);
  }
}
