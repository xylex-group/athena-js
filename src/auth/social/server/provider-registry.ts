import type { NormalizedSocialAuthConfig } from "./social-config.ts";
import type { OAuthProvider } from "../../oauth2/types.ts";
import { socialProviders } from "../../social-providers/registry.ts";
import { AthenaSocialServerError } from "./errors.ts";

export function resolveSocialProvider(
	config: NormalizedSocialAuthConfig,
	providerId: string,
): OAuthProvider {
	const options = config.providers[providerId];
	if (!options?.clientId?.trim()) {
		throw new AthenaSocialServerError(
			"ATHENA_AUTH_OAUTH_PROVIDER_UNKNOWN",
			`social provider ${providerId} is not configured`,
		);
	}
	if (!options.clientSecret?.trim()) {
		throw new AthenaSocialServerError(
			"ATHENA_AUTH_OAUTH_CLIENT_SECRET_REQUIRED",
			`social provider ${providerId} requires a client secret`,
		);
	}
	const factory =
		socialProviders[providerId as keyof typeof socialProviders];
	if (typeof factory !== "function") {
		throw new AthenaSocialServerError(
			"ATHENA_AUTH_OAUTH_PROVIDER_UNKNOWN",
			`social provider ${providerId} is not in the registry`,
		);
	}
	return factory({
		...options,
		clientId: options.clientId,
		clientSecret: options.clientSecret,
	} as never);
}
