/**
 * Stripe must satisfy the same local billing provider contract as Mollie.
 */
import { createStripeBillingProviderRuntime } from "../../../src/billing/runtime/local/providers/stripe/runtime.ts";
import { runBillingProviderConformance } from "./contract.ts";

runBillingProviderConformance({
	provider: "stripe",
	runtime: createStripeBillingProviderRuntime({
		testKey: "sk_test_xxx",
	}),
});
