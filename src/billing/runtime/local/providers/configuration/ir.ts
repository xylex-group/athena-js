import type { BillingProviderName } from "../../../../types.ts";

export interface BillingConfiguredProviderSlot {
  readonly credentialReference: string;
  readonly credentialKind: string;
  readonly provider: BillingProviderName;
  readonly rawConfig: unknown;
  readonly slotKey: string | null;
}

export interface BillingConfiguredProvider {
  readonly defaultSlot?: BillingConfiguredProviderSlot;
  readonly provider: BillingProviderName;
  readonly slots: ReadonlyMap<string, BillingConfiguredProviderSlot>;
}

export interface BillingConfiguredProviders {
  readonly providers: ReadonlyMap<BillingProviderName, BillingConfiguredProvider>;
}
