export type BillingEnvironmentName = "test" | "live";

export interface BillingEnvironment {
	readonly testMode: boolean;
	readonly name: BillingEnvironmentName;
}

/** Named live-selection invariant (see billing/safety/environment.ts). */
export type BillingLiveCredentialSelection = BillingEnvironment;

export function billingEnvironmentName(
	testMode: boolean,
): BillingEnvironmentName {
	return testMode ? "test" : "live";
}

/**
 * Canonical Billing environment. Local provider execution defaults to test
 * so a live credential never becomes active merely by existing.
 */
export function resolveBillingEnvironment(input?: {
	testMode?: boolean;
}): BillingEnvironment {
	const testMode = input?.testMode !== false;
	return {
		testMode,
		name: billingEnvironmentName(testMode),
	};
}
