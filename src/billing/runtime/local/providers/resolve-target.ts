import {
	ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
	ATHENA_BILLING_TARGET_AMBIGUOUS,
	AthenaBillingProviderError,
} from "../../../errors.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type { BillingExecutionTarget, BillingProviderName } from "../../../types.ts";
import { normalizeBillingProviderName } from "./registry.ts";
import type { BillingProviderRegistry } from "./registry.ts";
import type { ResolvedBillingExecutionTarget } from "./types.ts";

function configuredProviderNames(
	configured: BillingProviderConfigMap | undefined,
): BillingProviderName[] {
	if (configured == null) {
		return [];
	}
	return Object.keys(configured)
		.filter((name) => configured[name] != null)
		.map((name) => normalizeBillingProviderName(name));
}

function isProviderConfigured(
	configured: BillingProviderConfigMap | undefined,
	provider: BillingProviderName,
): boolean {
	return configuredProviderNames(configured).includes(provider);
}

export function resolveBillingExecutionTarget(input: {
	target?: BillingExecutionTarget;
	configuredProviders: BillingProviderConfigMap | undefined;
	registry: BillingProviderRegistry;
}): ResolvedBillingExecutionTarget {
	const connectionId = input.target?.connectionId?.trim() ?? "";
	const explicitProvider = input.target?.provider?.trim() ?? "";
	const hasConnectionId = connectionId.length > 0;
	const hasProvider = explicitProvider.length > 0;

	if (hasConnectionId && hasProvider) {
		throw new AthenaBillingProviderError({
			code: ATHENA_BILLING_TARGET_AMBIGUOUS,
			message:
				"Billing target is ambiguous: provide either connectionId or provider, not both.",
		});
	}

	if (hasConnectionId) {
		return {
			kind: "connection",
			connectionId,
			provider: hasProvider
				? normalizeBillingProviderName(explicitProvider)
				: undefined,
		};
	}

	if (hasProvider) {
		const provider = normalizeBillingProviderName(explicitProvider);
		if (!isProviderConfigured(input.configuredProviders, provider)) {
			throw new AthenaBillingProviderError({
				code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
				message: `Billing provider "${provider}" is not configured.`,
			});
		}
		return {
			kind: "configured",
			provider,
			runtime: input.registry.require(provider),
		};
	}

	const configured = configuredProviderNames(input.configuredProviders);
	if (configured.length === 0) {
		throw new AthenaBillingProviderError({
			code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
			message: "No billing provider is configured.",
		});
	}
	if (configured.length > 1) {
		throw new AthenaBillingProviderError({
			code: ATHENA_BILLING_TARGET_AMBIGUOUS,
			message:
				"Billing target is ambiguous: multiple providers are configured and no provider was specified.",
		});
	}

	const provider = configured[0];
	if (provider == null) {
		throw new AthenaBillingProviderError({
			code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
			message: "No billing provider is configured.",
		});
	}
	return {
		kind: "configured",
		provider,
		runtime: input.registry.require(provider),
	};
}
