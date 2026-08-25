import type { PasskeyChallengeStore } from "../../passkey/server/challenge-store.ts";
import type {
	AthenaPasskeyChallenge,
	AthenaPasskeyChallengeConsume,
	AthenaPasskeyChallengeCreate,
	AthenaPasskeyChallengePurpose,
} from "../../passkey/server/types.ts";
import { base64Url } from "../../utils/base64.ts";
import type { AthenaAuthDatabase } from "../database.ts";
import type { MemoryAuthStores } from "../memory-stores.ts";
import type { AuthVerificationRow } from "../models.ts";
import { PostgresAuthStores } from "../stores.ts";

const CHALLENGE_HASH_BYTES = 32;
const PASSKEY_PURPOSES = new Set<AthenaPasskeyChallengePurpose>([
	"authentication",
	"registration",
]);

export interface PasskeyVerificationHost {
	consumeVerificationByIdentifierAndValue(
		identifier: string,
		value: string,
	): Promise<AuthVerificationRow | undefined>;
	createVerification(input: {
		expiresAt: Date;
		id: string;
		identifier: string;
		value: string;
	}): Promise<AuthVerificationRow>;
	expirePasskeyVerifications(now: Date): Promise<number>;
}

function isPasskeyVerificationHost(
	value: object,
): value is PasskeyVerificationHost {
	return (
		"createVerification" in value &&
		typeof (value as PasskeyVerificationHost).createVerification ===
			"function" &&
		"consumeVerificationByIdentifierAndValue" in value &&
		typeof (value as PasskeyVerificationHost)
			.consumeVerificationByIdentifierAndValue === "function" &&
		"expirePasskeyVerifications" in value &&
		typeof (value as PasskeyVerificationHost).expirePasskeyVerifications ===
			"function"
	);
}

function isAthenaAuthDatabase(value: object): value is AthenaAuthDatabase {
	return (
		"query" in value &&
		typeof (value as AthenaAuthDatabase).query === "function"
	);
}

function encodeValue(challengeHash: Uint8Array): string {
	return base64Url.encode(challengeHash, { padding: false });
}

async function rpIdHashToken(rpId: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)),
	);
	return encodeValue(digest);
}

function userToken(userId: string | null): string {
	return userId === null ? "anonymous" : userId;
}

async function bindIdentifier(input: {
	purpose: AthenaPasskeyChallengePurpose;
	rpId: string;
	userId: string | null;
}): Promise<{ identifier: string; rpId: string }> {
	const rpId = input.rpId.trim();
	if (rpId.length === 0 || rpId.includes(":")) {
		throw new Error("passkey challenge rpId is invalid");
	}
	if (
		input.userId !== null &&
		(input.userId.length === 0 || input.userId.includes(":"))
	) {
		throw new Error("passkey challenge userId is invalid");
	}
	const rpHash = await rpIdHashToken(rpId);
	return {
		identifier: `passkey:${input.purpose}:${rpHash}:${userToken(input.userId)}`,
		rpId,
	};
}

function assertPurpose(
	purpose: string,
): asserts purpose is AthenaPasskeyChallengePurpose {
	if (!PASSKEY_PURPOSES.has(purpose as AthenaPasskeyChallengePurpose)) {
		throw new Error("passkey challenge purpose is invalid");
	}
}

function assertChallengeHash(challengeHash: Uint8Array): void {
	if (challengeHash.byteLength !== CHALLENGE_HASH_BYTES) {
		throw new Error("passkey challengeHash must be a 32-byte SHA-256 digest");
	}
}

function validateCreate(input: AthenaPasskeyChallengeCreate): void {
	assertPurpose(input.purpose);
	assertChallengeHash(input.challengeHash);
	if (input.purpose === "registration" && input.userId === null) {
		throw new Error("registration passkey challenges require a userId");
	}
}

function toChallenge(
	row: AuthVerificationRow,
	input: {
		challengeHash: Uint8Array;
		purpose: AthenaPasskeyChallengePurpose;
		rpId: string;
		userId: string | null;
	},
	consumedAt: Date | null,
): AthenaPasskeyChallenge {
	return {
		challengeHash: new Uint8Array(input.challengeHash),
		consumedAt,
		createdAt: new Date(row.created_at),
		expiresAt: new Date(row.expires_at),
		id: row.id,
		purpose: input.purpose,
		rpId: input.rpId,
		userId: input.userId,
	};
}

export class LocalPasskeyChallengeStore implements PasskeyChallengeStore {
	constructor(private readonly host: PasskeyVerificationHost) {}

	async create(
		input: AthenaPasskeyChallengeCreate,
	): Promise<AthenaPasskeyChallenge> {
		validateCreate(input);
		const { identifier, rpId } = await bindIdentifier(input);
		const row = await this.host.createVerification({
			expiresAt: input.expiresAt,
			id: crypto.randomUUID(),
			identifier,
			value: encodeValue(input.challengeHash),
		});
		return toChallenge(row, { ...input, rpId }, null);
	}

	async consume(
		input: AthenaPasskeyChallengeConsume,
	): Promise<AthenaPasskeyChallenge> {
		assertPurpose(input.purpose);
		assertChallengeHash(input.challengeHash);
		const { identifier, rpId } = await bindIdentifier(input);
		const row = await this.host.consumeVerificationByIdentifierAndValue(
			identifier,
			encodeValue(input.challengeHash),
		);
		if (!row) {
			throw new Error("passkey challenge consume missed");
		}
		return toChallenge(row, { ...input, rpId }, new Date());
	}

	async expire(now?: Date): Promise<number> {
		return this.host.expirePasskeyVerifications(now ?? new Date());
	}
}

export class MemoryPasskeyChallengeStore extends LocalPasskeyChallengeStore {}

export class PostgresPasskeyChallengeStore extends LocalPasskeyChallengeStore {
	constructor(storesOrDb: PostgresAuthStores | AthenaAuthDatabase) {
		super(resolvePostgresHost(storesOrDb));
	}
}

function resolvePostgresHost(
	storesOrDb: PostgresAuthStores | AthenaAuthDatabase | PasskeyVerificationHost,
): PasskeyVerificationHost {
	if (isPasskeyVerificationHost(storesOrDb)) {
		return storesOrDb;
	}
	if (isAthenaAuthDatabase(storesOrDb)) {
		return new PostgresAuthStores(storesOrDb);
	}
	throw new Error(
		"postgres passkey challenge store requires Auth stores or a database",
	);
}

export function createMemoryPasskeyChallengeStore(
	stores: MemoryAuthStores,
): PasskeyChallengeStore {
	return new MemoryPasskeyChallengeStore(stores);
}

export function createPostgresPasskeyChallengeStore(
	storesOrDb: PostgresAuthStores | AthenaAuthDatabase,
): PasskeyChallengeStore {
	return new PostgresPasskeyChallengeStore(storesOrDb);
}

export function createPasskeyChallengeStore(
	storesOrDb: PasskeyVerificationHost | AthenaAuthDatabase,
): PasskeyChallengeStore {
	if (isPasskeyVerificationHost(storesOrDb)) {
		return new LocalPasskeyChallengeStore(storesOrDb);
	}
	if (isAthenaAuthDatabase(storesOrDb)) {
		return new PostgresPasskeyChallengeStore(storesOrDb);
	}
	throw new Error("passkey challenge store requires Auth stores or a database");
}
