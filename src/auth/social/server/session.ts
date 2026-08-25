import { AthenaSocialServerNotWiredError } from "./errors.ts";

export interface SocialSessionPort {
	acceptAfterCallback(session: unknown): Promise<never>;
}

/** Canonical session mint after social callback is a follow-on slice. */
export function createSocialSessionPort(): SocialSessionPort {
	return {
		acceptAfterCallback() {
			return Promise.reject(new AthenaSocialServerNotWiredError());
		},
	};
}
