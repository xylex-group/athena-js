import {
	ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
	AthenaBillingCredentialError,
} from "../errors.ts";
import type { BillingProviderName } from "../types.ts";
import type { BillingEnvironmentName } from "./environment.ts";
import { billingEnvironmentName } from "./environment.ts";

export type BillingCredentialEnvironment = BillingEnvironmentName;

export type BillingCredentialClass = "api_key" | "access_token";

export type BillingCredentialKind =
	| "api_key"
	| "secret_key"
	| "restricted_key"
	| "advanced_access_token"
	| "organization_access_token"
	| "oauth_access_token";

const REDACTED = "[REDACTED]";

export class BillingSecret {
	readonly #value: string;

	constructor(value: string) {
		this.#value = value;
	}

	revealForProviderRuntime(): string {
		return this.#value;
	}

	toJSON(): string {
		return REDACTED;
	}

	toString(): string {
		return REDACTED;
	}

	valueOf(): string {
		return REDACTED;
	}

	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return REDACTED;
	}
}

export interface BillingStoredCredential {
	readonly kind: BillingCredentialKind;
	readonly secret: BillingSecret;
}

export interface BillingEnvironmentCredentials<TCredential> {
	readonly test?: TCredential;
	readonly live?: TCredential;
}

export interface BillingProviderBindingCredentials {
	readonly test?: BillingStoredCredential;
	readonly live?: BillingStoredCredential;
}

export interface BillingCredentialBinding {
	readonly kind: "configured" | "connection";
	readonly provider: BillingProviderName;
	readonly credentials: BillingProviderBindingCredentials;
}

export interface BillingResolvedCredential {
	readonly provider: BillingProviderName;
	readonly environment: BillingCredentialEnvironment;
	readonly kind: BillingCredentialKind;
	revealForProviderRuntime(): string;
}

export interface BillingCredentialSelection {
	readonly provider: BillingProviderName;
	readonly environment: BillingCredentialEnvironment;
	readonly testMode: boolean;
	readonly credentialKind: BillingCredentialKind;
	readonly credential: BillingResolvedCredential;
}

export type BillingCredentialEnvironmentInference = "test" | "live" | "unknown";

export function credentialClassForKind(
	kind: BillingCredentialKind,
): BillingCredentialClass {
	return kind === "advanced_access_token" ||
		kind === "organization_access_token" ||
		kind === "oauth_access_token"
		? "access_token"
		: "api_key";
}

export function availableBillingCredentialEnvironments(
	credentials: BillingProviderBindingCredentials,
): BillingCredentialEnvironment[] {
	const available: BillingCredentialEnvironment[] = [];
	if (credentials.test != null) {
		available.push("test");
	}
	if (credentials.live != null) {
		available.push("live");
	}
	return available;
}

export function resolveBillingCredential(input: {
	provider: BillingProviderName;
	testMode: boolean;
	binding: BillingCredentialBinding;
}): BillingCredentialSelection {
	const environment = billingEnvironmentName(input.testMode);
	const stored = input.binding.credentials[environment];
	if (stored == null) {
		const available = availableBillingCredentialEnvironments(
			input.binding.credentials,
		);
		throw new AthenaBillingCredentialError({
			code: ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
			provider: input.provider,
			environment,
			message: `${formatProviderLabel(input.provider)} ${environment} billing credential is unavailable. Configured environments: ${available.length > 0 ? available.join(", ") : "none"}.`,
		});
	}
	const credential: BillingResolvedCredential = {
		provider: input.provider,
		environment,
		kind: stored.kind,
		revealForProviderRuntime: () => stored.secret.revealForProviderRuntime(),
	};
	return {
		provider: input.provider,
		environment,
		testMode: input.testMode,
		credentialKind: stored.kind,
		credential,
	};
}

function formatProviderLabel(provider: BillingProviderName): string {
	if (provider.length === 0) {
		return "Billing";
	}
	return provider.charAt(0).toUpperCase() + provider.slice(1);
}
