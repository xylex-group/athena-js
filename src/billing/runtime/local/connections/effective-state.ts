export type BillingConnectionAffinityState =
  | "ambiguous"
  | "missing"
  | "resolved";

export type BillingConnectionVerificationState =
  | "degraded"
  | "invalid"
  | "unverified"
  | "verified";

export interface BillingEffectiveConnectionState {
  readonly affinity: BillingConnectionAffinityState;
  readonly configured: boolean;
  readonly credentialAvailable: boolean;
  readonly ingestion?: "degraded" | "healthy" | "unsupported";
  readonly persisted: boolean;
  readonly verification: BillingConnectionVerificationState;
}

export function isBillingConnectionOperational(
  state: BillingEffectiveConnectionState
): boolean {
  return (
    state.configured &&
    state.persisted &&
    state.credentialAvailable &&
    state.affinity === "resolved" &&
    state.verification === "verified" &&
    (state.ingestion == null ||
      state.ingestion === "healthy" ||
      state.ingestion === "unsupported")
  );
}
