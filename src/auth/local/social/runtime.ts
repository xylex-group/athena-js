import { socialProviders } from "../../social-providers/registry.ts";
import { createAthenaSocialServerEngine } from "../../social/server/engine.ts";
import type { AthenaSocialServerEngine } from "../../social/server/types.ts";
import type { NormalizedSocialAuthConfig } from "../../social/server/social-config.ts";
import type { OAuthTransactionStore } from "../../social/server/transaction-store.ts";
import type { AthenaAuthDatabase } from "../database.ts";
import {
	createMemoryOAuthTransactionStore,
} from "./memory-store.ts";
import {
	createPostgresOAuthTransactionStore,
} from "./postgres-store.ts";

export interface AthenaEmbeddedSocialRuntime {
	engine: AthenaSocialServerEngine;
	secret: string;
	social: NormalizedSocialAuthConfig;
	store: OAuthTransactionStore;
}

export interface ComposeEmbeddedSocialRuntimeInput {
	database?: AthenaAuthDatabase;
	secret?: string;
	social: NormalizedSocialAuthConfig;
}

function isRegisteredSocialProvider(id: string): boolean {
	return (
		typeof socialProviders[id as keyof typeof socialProviders] === "function"
	);
}

function configuredProviderIds(
	social: NormalizedSocialAuthConfig,
): string[] {
	return Object.entries(social.providers)
		.filter(
			([id, bag]) =>
				isRegisteredSocialProvider(id) &&
				Boolean(bag.clientId?.trim()) &&
				Boolean(bag.clientSecret?.trim()),
		)
		.map(([id]) => id)
		.sort();
}

export function hasConfiguredSocialProviders(
	social: NormalizedSocialAuthConfig | undefined,
): boolean {
	return Boolean(social && configuredProviderIds(social).length > 0);
}

export function advertisedSocialProviderIds(
	social: NormalizedSocialAuthConfig | undefined,
): string[] {
	return social ? configuredProviderIds(social) : [];
}

export function resolveSocialEncryptionSecret(input: {
	configSecret?: string;
	explicitSecret?: string;
	runtimeKeyMaterial?: string;
}): string | undefined {
	for (const value of [
		input.explicitSecret,
		input.configSecret,
		input.runtimeKeyMaterial,
	]) {
		const trimmed = value?.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return undefined;
}

export function composeEmbeddedSocialRuntime(
	input: ComposeEmbeddedSocialRuntimeInput,
): AthenaEmbeddedSocialRuntime | null {
	if (!hasConfiguredSocialProviders(input.social)) {
		return null;
	}
	const secret = input.secret?.trim();
	if (!secret) {
		return null;
	}
	const store = input.database
		? createPostgresOAuthTransactionStore(input.database)
		: createMemoryOAuthTransactionStore();
	const engine = createAthenaSocialServerEngine({
		secret,
		social: input.social,
		transactions: store,
	});
	return {
		engine,
		secret,
		social: input.social,
		store,
	};
}
