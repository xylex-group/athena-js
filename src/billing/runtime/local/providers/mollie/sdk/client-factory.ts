import type { NormalizedMollieBillingProviderConfig } from "../../../../../providers/types.ts";
import type { BillingResolvedCredential } from "../../../../credentials.ts";
import { resolveMollieRequestProfileId } from "../profile-target.ts";
import { assertMollieSdkClient } from "./assertions.ts";
import type { MollieSdkClient, MollieSdkClientOptions } from "./types.ts";

export class MollieSdkClientPool {
	private readonly clients = new Map<string, MollieSdkClient>();

	constructor(private readonly config: NormalizedMollieBillingProviderConfig) {}

	private construct(options: MollieSdkClientOptions): MollieSdkClient {
		const created =
			this.config.adapter != null
				? this.config.adapter(options)
				: new this.config.sdk(options);
		return assertMollieSdkClient(created, "mollie.sdk.construct");
	}

	clientFor(input: {
		credential: BillingResolvedCredential;
		requestedProfileId?: string | null;
	}): MollieSdkClient {
		const options = mollieSdkClientOptions({
			config: this.config,
			credential: input.credential,
			requestedProfileId: input.requestedProfileId,
		});
		const requested = input.requestedProfileId;
		if (requested != null && requested.length > 0) {
			return this.construct(options);
		}
		const key = mollieSdkClientKey(options);
		const existing = this.clients.get(key);
		if (existing != null) {
			return existing;
		}
		const created = this.construct(options);
		this.clients.set(key, created);
		return created;
	}
}

export function mollieSdkClientOptions(input: {
	config: NormalizedMollieBillingProviderConfig;
	credential: BillingResolvedCredential;
	requestedProfileId?: string | null;
}): MollieSdkClientOptions {
	const secret = input.credential.revealForProviderRuntime();
	const kind = input.config.credentialKind;
	if (kind === "api_key") {
		return {
			security: { apiKey: secret },
			serverURL: input.config.apiBaseUrl,
		};
	}
	const profileId = resolveMollieRequestProfileId({
		configuredProfileId:
			input.config.profileId ?? input.config.defaultProfileId,
		credentialKind: kind,
		requestedProfileId: input.requestedProfileId,
	});
	const security =
		kind === "advanced_access_token"
			? { advancedAccessToken: secret }
			: { oAuth: secret };
	return {
		profileId,
		security,
		serverURL: input.config.apiBaseUrl,
		testmode: input.credential.environment === "test",
	};
}

export function mollieSdkClientKey(options: MollieSdkClientOptions): string {
	const security = options.security ?? {};
	const scheme = security.apiKey
		? "apiKey"
		: security.advancedAccessToken
			? "advancedAccessToken"
			: "oAuth";
	return [
		scheme,
		options.testmode === true ? "test" : "live",
		options.profileId ?? "",
		options.serverURL ?? "",
	].join(":");
}
