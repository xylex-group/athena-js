import type { BillingSigningSecretSet } from "../types.ts";

export type BillingWebhookSigningSecretSet = BillingSigningSecretSet;

export interface BillingWebhookSecretStore {
  resolve(connectionId: string): Promise<BillingWebhookSigningSecretSet>;
  rotate(input: {
    connectionId: string;
    current: string;
    previous: readonly string[];
  }): Promise<void>;
  storeCurrent(input: {
    connectionId: string;
    fingerprint: string;
    secret: string;
  }): Promise<void>;
}
