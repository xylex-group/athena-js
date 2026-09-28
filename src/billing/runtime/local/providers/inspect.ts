import {
  ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH,
  AthenaBillingCredentialError,
} from "../../../errors.ts";
import type { BillingProviderName } from "../../../types.ts";
import type {
  BillingCredentialEnvironment,
  BillingCredentialEnvironmentInference,
} from "../../credentials.ts";

export function assertCredentialSlotEnvironment(input: {
  provider: BillingProviderName;
  environment: BillingCredentialEnvironment;
  inferred: BillingCredentialEnvironmentInference;
}): void {
  if (input.inferred === "unknown" || input.inferred === input.environment) {
    return;
  }
  throw new AthenaBillingCredentialError({
    code: ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH,
    environment: input.environment,
    message: `${formatProviderLabel(input.provider)} ${input.environment} billing credential does not match the ${input.inferred} environment encoded in the secret.`,
    provider: input.provider,
  });
}

export type MollieCredentialPrefixClass =
  | "api_key"
  | "access_token"
  | "unknown";

export function classifyMollieCredentialPrefix(
  secret: string
): MollieCredentialPrefixClass {
  if (secret.startsWith("test_") || secret.startsWith("live_")) {
    return "api_key";
  }
  if (secret.startsWith("access_")) {
    return "access_token";
  }
  return "unknown";
}

export function inferMollieCredentialEnvironment(
  secret: string
): BillingCredentialEnvironmentInference {
  if (secret.startsWith("test_")) {
    return "test";
  }
  if (secret.startsWith("live_")) {
    return "live";
  }
  return "unknown";
}

export function inferStripeCredentialEnvironment(
  secret: string
): BillingCredentialEnvironmentInference {
  if (
    secret.includes("_test_") ||
    secret.startsWith("sk_test") ||
    secret.startsWith("rk_test") ||
    secret.startsWith("pk_test")
  ) {
    return "test";
  }
  if (
    secret.includes("_live_") ||
    secret.startsWith("sk_live") ||
    secret.startsWith("rk_live") ||
    secret.startsWith("pk_live")
  ) {
    return "live";
  }
  return "unknown";
}

function formatProviderLabel(provider: BillingProviderName): string {
  if (provider.length === 0) {
    return "Billing";
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
