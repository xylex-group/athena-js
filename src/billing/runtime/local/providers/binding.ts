import {
	ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
	AthenaBillingProviderError,
} from "../../../errors.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type { BillingProviderName } from "../../../types.ts";
import { normalizeBillingProviderConfig } from "./config.ts";
import type { ConfiguredBillingProviderBinding } from "./types.ts";

export function createConfiguredProviderBinding(input: {
	provider: BillingProviderName;
	configuredProviders?: BillingProviderConfigMap;
}): ConfiguredBillingProviderBinding {
	const normalized = normalizeBillingProviderConfig(input.configuredProviders);
	if (input.provider === "mollie" && normalized.mollie != null) {
		return {
			kind: "configured",
			provider: "mollie",
			credentials: normalized.mollie.credentials,
			providerConfig: {
				apiBaseUrl: normalized.mollie.apiBaseUrl,
				authority: normalized.mollie.authority,
				credentialKind: normalized.mollie.credentialKind,
				profileId: normalized.mollie.profileId ?? null,
			},
		};
	}
	if (input.provider === "stripe" && normalized.stripe != null) {
		return {
			kind: "configured",
			provider: "stripe",
			credentials: normalized.stripe.credentials,
			providerConfig: {
				accountId: normalized.stripe.accountId ?? null,
				apiBaseUrl: normalized.stripe.apiBaseUrl,
				credentialKind: normalized.stripe.credentialKind,
			},
		};
	}
	throw new AthenaBillingProviderError({
		code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
		message: `Billing provider "${input.provider}" is not configured.`,
	});
}
