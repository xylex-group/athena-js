import type { BillingProviderName } from "../../../types.ts";
import type { NormalizedAthenaBillingCatalog } from "../catalog/normalize.ts";
import type { BillingProviderRuntime } from "./types.ts";

export interface BillingProviderDefinition<TConfig = unknown> {
  readonly configuration: {
    credentialKind(config: TConfig): string;
    normalize(config: unknown): TConfig;
  };
  readonly provider: BillingProviderName;
  readonly runtime: {
    create(
      config: TConfig,
      context?: { catalog?: NormalizedAthenaBillingCatalog },
    ): BillingProviderRuntime;
  };
}
