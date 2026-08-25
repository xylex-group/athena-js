/**
 * Node billing materializer — provider registry for local attach.
 */

import { attachLocalBillingRuntime } from "../../billing/runtime/local/materialize.ts";
import { createBillingProviderRegistry } from "../../billing/runtime/local/providers/create-registry.ts";
import type { BillingProviderRegistry } from "../../billing/runtime/local/providers/registry.ts";
import type { AthenaClientConfig } from "../../v3-client-core.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";

export { attachLocalBillingRuntime, createBillingProviderRegistry };

export function materializeBilling(
	config: AthenaClientConfig,
	_plan?: AthenaRuntimePlan,
): BillingProviderRegistry {
	return createBillingProviderRegistry(config.billing?.providers);
}
