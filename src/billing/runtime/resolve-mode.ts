import {
  type AthenaRuntimeEnvironment,
  detectAthenaRuntimeEnvironment,
} from "../../runtime/resolve.ts";
import {
  ATHENA_BILLING_CONFIG_CONFLICT,
  ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
  AthenaBillingProviderError,
} from "../errors.ts";
import type { BillingProviderConfigMap } from "../providers/types.ts";
import type { BillingRuntimeMode } from "../types.ts";

export type BillingRuntimeModePreference = "auto" | "local" | "remote";

function configuredProviderCount(
  configured?: BillingProviderConfigMap
): number {
  if (configured == null) {
    return 0;
  }
  return Object.keys(configured).filter((name) => configured[name] != null)
    .length;
}

/**
 * Auto + a configured provider selects local, even when a billing URL exists.
 * Explicit local never remotes. Explicit remote + providers is invalid.
 */
export function resolveBillingRuntimeMode(input: {
  mode?: BillingRuntimeModePreference;
  configuredProviders?: BillingProviderConfigMap;
}): BillingRuntimeMode {
  const hasProviders = configuredProviderCount(input.configuredProviders) > 0;
  if (input.mode === "remote" && hasProviders) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_CONFIG_CONFLICT,
      message:
        'billing.mode="remote" cannot be combined with billing.providers. Provider bindings belong to the runtime executing Billing locally.',
    });
  }
  if (input.mode === "local") {
    return "local";
  }
  if (input.mode === "remote") {
    return "remote";
  }
  return hasProviders ? "local" : "remote";
}

export function assertLocalBillingRuntimeEnvironment(input?: {
  mode?: BillingRuntimeModePreference;
  configuredProviders?: BillingProviderConfigMap;
  environment?: AthenaRuntimeEnvironment;
  localMaterialized?: boolean;
}): void {
  const environment = input?.environment ?? detectAthenaRuntimeEnvironment();
  const resolved = resolveBillingRuntimeMode({
    configuredProviders: input?.configuredProviders,
    mode: input?.mode,
  });
  if (resolved !== "local") {
    return;
  }
  if (environment === "browser" || environment === "react-native") {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
      message:
        "Local Billing requires a trusted server runtime and cannot run in the browser or React Native.",
    });
  }
  if (!input?.localMaterialized) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
      message:
        "Local Billing requires a trusted server runtime that materializes provider execution. This createClient path cannot retain remote ports.",
    });
  }
}
