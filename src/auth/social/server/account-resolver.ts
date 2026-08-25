import { AthenaSocialServerNotWiredError } from "./errors.ts";

export interface SocialAccountResolver {
	resolve(input: {
		email?: string;
		providerId: string;
		providerUserId: string;
	}): Promise<never>;
}

/** Collision / account linking is a follow-on HTTP slice. */
export function createSocialAccountResolver(): SocialAccountResolver {
	return {
		resolve() {
			return Promise.reject(new AthenaSocialServerNotWiredError());
		},
	};
}
