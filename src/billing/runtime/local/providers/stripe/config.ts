import {
	ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
	AthenaBillingProviderError,
} from "../../../../errors.ts";
import type {
	NormalizedStripeBillingProviderConfig,
	StripeBillingCredentialKind,
	StripeBillingProviderConfig,
} from "../../../../providers/types.ts";
import {
	BillingSecret,
	type BillingProviderBindingCredentials,
	type BillingStoredCredential,
} from "../../../credentials.ts";
import {
	assertCredentialSlotEnvironment,
	inferStripeCredentialEnvironment,
} from "../inspect.ts";

const DEFAULT_STRIPE_API_BASE_URL = "https://api.stripe.com";

function nonEmpty(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function storeStripeCredential(
	secret: string,
	environment: "test" | "live",
	kind: StripeBillingCredentialKind,
): BillingStoredCredential {
	assertCredentialSlotEnvironment({
		provider: "stripe",
		environment,
		inferred: inferStripeCredentialEnvironment(secret),
	});
	return {
		kind,
		secret: new BillingSecret(secret),
	};
}

export function normalizeStripeBillingProviderConfig(
	config: StripeBillingProviderConfig,
): NormalizedStripeBillingProviderConfig {
	const credentialKind: StripeBillingCredentialKind =
		config.credentialKind ?? "secret_key";
	const testSecret =
		credentialKind === "oauth_access_token"
			? nonEmpty("testToken" in config ? config.testToken : undefined)
			: nonEmpty("testKey" in config ? config.testKey : undefined);
	const liveSecret =
		credentialKind === "oauth_access_token"
			? nonEmpty("liveToken" in config ? config.liveToken : undefined)
			: nonEmpty("liveKey" in config ? config.liveKey : undefined);
	const credentials: BillingProviderBindingCredentials = {
		...(testSecret
			? { test: storeStripeCredential(testSecret, "test", credentialKind) }
			: {}),
		...(liveSecret
			? { live: storeStripeCredential(liveSecret, "live", credentialKind) }
			: {}),
	};
	if (credentials.test == null && credentials.live == null) {
		throw new AthenaBillingProviderError({
			code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
			message:
				"billing.providers.stripe requires a test or live credential.",
		});
	}
	const accountId = nonEmpty(
		"accountId" in config ? config.accountId : undefined,
	);
	return {
		provider: "stripe",
		credentials,
		accountId: accountId ?? null,
		apiBaseUrl: nonEmpty(config.apiBaseUrl) ?? DEFAULT_STRIPE_API_BASE_URL,
		credentialKind,
	};
}

function isNormalizedStripeConfig(
	config: StripeBillingProviderConfig | NormalizedStripeBillingProviderConfig,
): config is NormalizedStripeBillingProviderConfig {
	return "provider" in config && config.provider === "stripe";
}

export function normalizeStripeRuntimeConfig(
	config: StripeBillingProviderConfig | NormalizedStripeBillingProviderConfig,
): NormalizedStripeBillingProviderConfig {
	if (isNormalizedStripeConfig(config)) {
		return config;
	}
	return normalizeStripeBillingProviderConfig(config);
}
