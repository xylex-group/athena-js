import {
  type BillingEnvironment,
  resolveBillingEnvironment as resolveRuntimeBillingEnvironment,
} from "../runtime/environment.ts";

/**
 * Named live/test invariant: live credentials are never selected because
 * they merely exist. Omitted `testMode` stays test.
 */
export type BillingLiveCredentialSelection = BillingEnvironment;

export type BillingLiveSelectionInvariant = BillingLiveCredentialSelection;

export function resolveBillingEnvironment(input?: {
  credentials?: { live?: unknown; test?: unknown };
  testMode?: boolean;
}): BillingLiveCredentialSelection {
  return resolveRuntimeBillingEnvironment({
    testMode: input?.testMode,
  });
}

export function assertBillingLiveCredentialSelection(input?: {
  credentials?: { live?: unknown; test?: unknown };
  testMode?: boolean;
}): BillingLiveCredentialSelection {
  return resolveBillingEnvironment(input);
}
