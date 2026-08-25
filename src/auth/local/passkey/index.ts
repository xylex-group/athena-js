export {
	createMemoryPasskeyChallengeStore,
	createPasskeyChallengeStore,
	createPostgresPasskeyChallengeStore,
	LocalPasskeyChallengeStore,
	MemoryPasskeyChallengeStore,
	type PasskeyVerificationHost,
	PostgresPasskeyChallengeStore,
} from "./challenge-store.ts";

export {
	createMemoryPasskeyRepository,
	createPasskeyRepository,
	createPostgresPasskeyRepository,
	LocalPasskeyRepository,
	MemoryPasskeyRepository,
	PostgresPasskeyRepository,
} from "./repository.ts";

export { handleGenerateAuthenticateOptionsRoute } from "./generate-authenticate-options.ts";
export { handleVerifyAuthenticationRoute } from "./verify-authentication.ts";
export {
	handleDeletePasskeyRoute,
	handleListUserPasskeysRoute,
	handleUpdatePasskeyRoute,
} from "./manage-passkeys.ts";
export { handleRelatedOriginsRoute } from "./related-origins.ts";
