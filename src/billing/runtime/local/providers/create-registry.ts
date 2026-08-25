import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { normalizeBillingProviderConfig } from "./config.ts";
import { createMollieBillingProviderRuntime } from "./mollie/runtime.ts";
import { createStripeBillingProviderRuntime } from "./stripe/runtime.ts";
import { BillingProviderRegistry } from "./registry.ts";

export function createBillingProviderRegistry(
	configured?: BillingProviderConfigMap,
): BillingProviderRegistry {
	const normalized = normalizeBillingProviderConfig(configured);
	const runtimes = [];
	if (normalized.mollie != null) {
		runtimes.push(createMollieBillingProviderRuntime(normalized.mollie));
	}
	if (normalized.stripe != null) {
		runtimes.push(createStripeBillingProviderRuntime(normalized.stripe));
	}
	return new BillingProviderRegistry(runtimes);
}
