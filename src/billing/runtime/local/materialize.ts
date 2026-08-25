import { assertLocalAuthHooks } from "../../../auth/hooks/assert-local.ts";
import { assertLocalAuthObservability } from "../../../auth/observability/config.ts";
import { athenaAuthConfig } from "../../../auth/config.ts";
import { assertDataLifecycleConfig } from "../../../runtime/data/lifecycle/assert.ts";
import { getAthenaClientInternals } from "../../../runtime/client-internals.ts";
import type { AthenaBillingModule } from "../../module.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import {
	assertLocalBillingRuntimeEnvironment,
	resolveBillingRuntimeMode,
	type BillingRuntimeModePreference,
} from "../resolve-mode.ts";
import { assertBillingProviderRuntimeEnvironment } from "./providers/config.ts";
import { createBillingProviderRegistry } from "./providers/create-registry.ts";
import type { BillingProviderRegistry } from "./providers/registry.ts";
import { createLocalBillingRuntime } from "./runtime.ts";
import {
	createClientWithNormalizer,
	normalizeUniversalCreateClientConfig,
	type AthenaClient,
	type AthenaClientConfig,
} from "../../../client/create-client.ts";

export function attachLocalBillingRuntime(
	client: { billing: AthenaBillingModule },
	input: {
		configuredProviders?: BillingProviderConfigMap;
		mode?: BillingRuntimeModePreference;
		registry?: BillingProviderRegistry;
		testMode?: boolean;
	},
): void {
	const billingMode = resolveBillingRuntimeMode({
		configuredProviders: input.configuredProviders,
		mode: input.mode,
	});
	if (billingMode !== "local") {
		return;
	}
	const existing = getAthenaClientInternals(client);
	const registry =
		input.registry ??
		existing?.billingProviderRegistry ??
		createBillingProviderRegistry(input.configuredProviders);
	const localRuntime = createLocalBillingRuntime({
		configuredProviders: input.configuredProviders,
		registry,
		testMode: input.testMode,
	});
	const billing = client.billing;
	billing.payments = localRuntime.payments as AthenaBillingModule["payments"];
	billing.customers = localRuntime.customers;
	billing.refunds = localRuntime.refunds;
	billing.paymentLinks = localRuntime.paymentLinks;
	billing.subscriptions = localRuntime.subscriptions;
	billing.invoices = localRuntime.invoices;
	billing.getCapabilities =
		localRuntime.getCapabilities as AthenaBillingModule["getCapabilities"];
	if (existing) {
		existing.billingRuntime = localRuntime;
	}
}

/** Core createClient plus local Billing overlay. Used by Cloudflare façades. */
export function createClientWithAttachedLocalBilling<
	TModels extends AthenaClientConfig["models"] = AthenaClientConfig["models"],
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels> {
	assertDataLifecycleConfig(config);
	assertBillingProviderRuntimeEnvironment(config.billing?.providers);
	const factory = createClientWithNormalizer as unknown as (
		input: unknown,
		normalizer: (c: unknown) => unknown,
	) => unknown;
	const normalize = normalizeUniversalCreateClientConfig as unknown as (
		c: unknown,
	) => unknown;
	const client = factory(config, normalize) as AthenaClient<TModels>;
	assertLocalAuthHooks(athenaAuthConfig(config.auth));
	assertLocalAuthObservability(athenaAuthConfig(config.auth));
	attachLocalBillingRuntime(client, {
		configuredProviders: config.billing?.providers,
		mode: config.billing?.mode,
		testMode: config.billing?.testMode,
	});
	assertLocalBillingRuntimeEnvironment({
		configuredProviders: config.billing?.providers,
		localMaterialized: true,
		mode: config.billing?.mode,
	});
	return client;
}
