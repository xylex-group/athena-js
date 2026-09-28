import type { BillingProviderName } from "../../../types.ts";

export type BillingConnectionProvider = BillingProviderName;
export type BillingConnectionEnvironment = "test" | "live";

/**
 * Durable slot for a configured billing connection. Materialize upserts
 * on `provider + environment + credentialReference` (plus tenant owner),
 * never "the active row for this provider".
 */
export interface BillingConnectionIdentity {
  credentialReference: string;
  environment: BillingConnectionEnvironment;
  provider: BillingConnectionProvider;
  scopeKey?: string;
}

export type ConfiguredBillingProviderAccountScope = string;

/**
 * Deterministic connection identity for application-configured providers.
 * Same app + provider + environment + scope always yields the same
 * `account_reference`. Never derive this from credential material.
 */
export function deriveConfiguredProviderAccountReference(input: {
  applicationId: string;
  environment: BillingConnectionEnvironment;
  provider: string;
  scope?: ConfiguredBillingProviderAccountScope;
}): string {
  const applicationId = input.applicationId.trim();
  const provider = input.provider.trim();
  const scope = input.scope?.trim();
  if (scope == null || scope.length === 0 || scope === "organization") {
    return `${applicationId}-${provider}-${input.environment}`;
  }
  return `${applicationId}-${provider}-${scope}-${input.environment}`;
}
