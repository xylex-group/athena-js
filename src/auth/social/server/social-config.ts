/**
 * Server-only social OAuth provider bags and alias collapse.
 * Must not be value-imported from browser / next/client / RN entries.
 */
import "server-only";

import { AthenaConfigurationError } from "../../../config/errors.ts";

export interface AthenaAuthSocialProviderOptions {
	clientId: string;
	clientSecret: string;
}

export interface AthenaAuthSocialOptions {
	providers?: Record<string, AthenaAuthSocialProviderOptions>;
}

export interface NormalizedSocialAuthConfig {
	providers: Record<string, AthenaAuthSocialProviderOptions>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertSocialConfigObject(key: string, value: unknown): void {
	if (value === undefined || value === null) {
		return;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new AthenaConfigurationError(
			"ATHENA_RUNTIME_CONFIG_INVALID",
			`auth.${key} must be an object provider map`,
			"auth",
		);
	}
}

function normalizeSocialProviderBag(
	value: unknown,
): AthenaAuthSocialProviderOptions | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	return {
		...record,
		clientId: asString(record.clientId) ?? "",
		clientSecret: asString(record.clientSecret) ?? "",
	};
}

function normalizeSocialProviderMap(
	value: unknown,
): Record<string, AthenaAuthSocialProviderOptions> {
	const record = asRecord(value);
	if (!record) {
		return {};
	}
	const providers: Record<string, AthenaAuthSocialProviderOptions> = {};
	for (const [id, bag] of Object.entries(record)) {
		const normalized = normalizeSocialProviderBag(bag);
		if (!normalized) {
			continue;
		}
		providers[id] = normalized;
	}
	return providers;
}

function extractSocialProviderMap(value: unknown): unknown {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const nested = asRecord(record.providers);
	return nested ?? record;
}

/**
 * Collapse `auth.social` / `auth.oauth` / `auth.socialProviders` object maps
 * into one internal `NormalizedSocialAuthConfig`. Boolean `true` stays invalid.
 */
export function normalizeSocialAuthConfig(
	raw: Record<string, unknown>,
): NormalizedSocialAuthConfig {
	assertSocialConfigObject("social", raw.social);
	assertSocialConfigObject("oauth", raw.oauth);
	assertSocialConfigObject("socialProviders", raw.socialProviders);
	const providers = normalizeSocialProviderMap(
		extractSocialProviderMap(raw.social) ?? raw.oauth ?? raw.socialProviders,
	);
	return { providers };
}
