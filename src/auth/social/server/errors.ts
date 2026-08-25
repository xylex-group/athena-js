/**
 * Internal social OAuth engine errors. Not a public Auth error family.
 * Do not export from package root.
 */

export class AthenaSocialServerError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "AthenaSocialServerError";
		this.code = code;
	}
}

export class AthenaSocialServerNotWiredError extends AthenaSocialServerError {
	constructor() {
		super(
			"ATHENA_AUTH_SOCIAL_SERVER_NOT_WIRED",
			"embedded social OAuth server engine is not wired for HTTP",
		);
	}
}

export class AthenaSocialOAuthProviderMixupError extends AthenaSocialServerError {
	constructor() {
		super(
			"ATHENA_AUTH_OAUTH_PROVIDER_MIXUP",
			"OAuth provider mix-up: callback provider does not match the transaction",
		);
	}
}
