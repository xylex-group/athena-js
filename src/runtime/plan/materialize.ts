/**
 * Dispatch AthenaRuntimePlan to Node domain materializers.
 */

import type { BillingProviderRegistry } from "../../billing/runtime/local/providers/registry.ts";
import type { AthenaClientConfig } from "../../v3-client-core.ts";
import { materializeAuth } from "../materializers/auth.ts";
import { materializeBilling } from "../materializers/billing.ts";
import { materializeChat } from "../materializers/chat.ts";
import { materializeDatabase } from "../materializers/database.ts";
import { materializeStorage } from "../materializers/storage.ts";
import { validateRuntimePlan } from "./validate.ts";
import type { AthenaRuntimePlan } from "./types.ts";

export interface AthenaMaterializedRuntime {
	billingProviderRegistry: BillingProviderRegistry;
	config: AthenaClientConfig;
	plan: AthenaRuntimePlan;
}

export function materializeRuntimePlan(
	plan: unknown,
): AthenaMaterializedRuntime {
	const validated = validateRuntimePlan(plan);
	const base = validated.config as AthenaClientConfig;
	const withAuth = materializeAuth(base, validated);
	const withDb = materializeDatabase(withAuth, validated);
	const withStorage = materializeStorage(withDb, validated);
	const withChat = materializeChat(withStorage, validated);
	const billingProviderRegistry = materializeBilling(withChat, validated);
	return {
		billingProviderRegistry,
		config: withChat,
		plan: {
			...validated,
			config: withChat,
		},
	};
}
