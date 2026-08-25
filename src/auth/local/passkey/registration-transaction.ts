import { ATHENA_AUTH_TABLES } from "../../contract/index.ts";
import { base64Url } from "../../utils/base64.ts";
import type { AthenaAuthDatabase } from "../database.ts";
import { MemoryAuthStores } from "../memory-stores.ts";

export type AthenaPasskeyRegistrationMode = "authenticated" | "onboarding";

export interface AthenaPasskeyRegistrationTransaction {
	challengeHash: Uint8Array;
	consumedAt: Date | null;
	context: unknown;
	createdAt: Date;
	expiresAt: Date;
	id: string;
	mode: AthenaPasskeyRegistrationMode;
	rpId: string;
	userHandle: Uint8Array;
}

export interface AthenaPasskeyRegistrationTransactionCreate {
	challengeHash: Uint8Array;
	context?: unknown;
	expiresAt: Date;
	mode: AthenaPasskeyRegistrationMode;
	rpId: string;
	userHandle: Uint8Array;
}

interface RegistrationTransactionRow {
	challenge_hash: string;
	consumed_at: Date | string | null;
	context: string | null;
	created_at: Date | string;
	expires_at: Date | string;
	id: string;
	mode: string;
	rp_id: string;
	user_handle: string;
}

function asDate(value: Date | string | null | undefined): Date | null {
	if (!value) {
		return null;
	}
	return value instanceof Date ? value : new Date(value);
}

function encodeBytes(bytes: Uint8Array): string {
	return base64Url.encode(bytes, { padding: false });
}

function decodeBytes(value: string): Uint8Array {
	return base64Url.decode(value);
}

function parseContext(value: string | null): unknown {
	if (!value) {
		return undefined;
	}
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function serializeContext(value: unknown): string | null {
	if (value == null) {
		return null;
	}
	return JSON.stringify(value);
}

function toTransaction(
	row: RegistrationTransactionRow,
): AthenaPasskeyRegistrationTransaction {
	return {
		challengeHash: decodeBytes(row.challenge_hash),
		consumedAt: asDate(row.consumed_at),
		context: parseContext(row.context),
		createdAt: asDate(row.created_at) ?? new Date(),
		expiresAt: asDate(row.expires_at) ?? new Date(),
		id: row.id,
		mode: row.mode === "onboarding" ? "onboarding" : "authenticated",
		rpId: row.rp_id,
		userHandle: decodeBytes(row.user_handle),
	};
}

function expiredError(): Error {
	return new Error("passkey registration transaction expired");
}

function consumedError(): Error {
	return new Error("passkey registration transaction already consumed");
}

function missingError(): Error {
	return new Error("passkey registration transaction not found");
}

export class MemoryPasskeyRegistrationTransactionStore {
	constructor(private readonly stores: MemoryAuthStores) {}

	async create(
		input: AthenaPasskeyRegistrationTransactionCreate,
	): Promise<AthenaPasskeyRegistrationTransaction> {
		const stamp = new Date();
		const row: RegistrationTransactionRow = {
			challenge_hash: encodeBytes(input.challengeHash),
			consumed_at: null,
			context: serializeContext(input.context),
			created_at: stamp,
			expires_at: input.expiresAt,
			id: crypto.randomUUID(),
			mode: input.mode,
			rp_id: input.rpId,
			user_handle: encodeBytes(input.userHandle),
		};
		for (const existing of this.stores.passkeyRegistrationTransactions.values()) {
			if (existing.challenge_hash === row.challenge_hash) {
				const error = new Error(
					"duplicate key value violates unique constraint",
				);
				(error as { code?: string }).code = "23505";
				throw error;
			}
		}
		this.stores.passkeyRegistrationTransactions.set(row.id, row);
		return toTransaction(row);
	}

	async findActive(input: {
		challengeHash: Uint8Array;
		rpId: string;
	}): Promise<AthenaPasskeyRegistrationTransaction> {
		const encoded = encodeBytes(input.challengeHash);
		const now = Date.now();
		for (const row of this.stores.passkeyRegistrationTransactions.values()) {
			if (row.challenge_hash !== encoded || row.rp_id !== input.rpId) {
				continue;
			}
			if (row.consumed_at) {
				throw consumedError();
			}
			if ((asDate(row.expires_at)?.getTime() ?? 0) <= now) {
				throw expiredError();
			}
			return toTransaction(row);
		}
		throw missingError();
	}

	async consume(input: {
		challengeHash: Uint8Array;
		rpId: string;
	}): Promise<AthenaPasskeyRegistrationTransaction> {
		const encoded = encodeBytes(input.challengeHash);
		const now = Date.now();
		for (const row of this.stores.passkeyRegistrationTransactions.values()) {
			if (row.challenge_hash !== encoded || row.rp_id !== input.rpId) {
				continue;
			}
			if (row.consumed_at) {
				throw consumedError();
			}
			if ((asDate(row.expires_at)?.getTime() ?? 0) <= now) {
				throw expiredError();
			}
			row.consumed_at = new Date();
			return toTransaction(row);
		}
		throw missingError();
	}
}

export class PostgresPasskeyRegistrationTransactionStore {
	constructor(private readonly db: AthenaAuthDatabase) {}

	async create(
		input: AthenaPasskeyRegistrationTransactionCreate,
	): Promise<AthenaPasskeyRegistrationTransaction> {
		const result = await this.db.query<RegistrationTransactionRow>(
			`INSERT INTO ${ATHENA_AUTH_TABLES.passkeyRegistrationTransactions}
        (id, challenge_hash, rp_id, user_handle, mode, context, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
			[
				crypto.randomUUID(),
				encodeBytes(input.challengeHash),
				input.rpId,
				encodeBytes(input.userHandle),
				input.mode,
				serializeContext(input.context),
				input.expiresAt,
			],
		);
		const row = result.rows[0];
		if (!row) {
			throw new Error("Failed to create passkey registration transaction");
		}
		return toTransaction(row);
	}

	async findActive(input: {
		challengeHash: Uint8Array;
		rpId: string;
	}): Promise<AthenaPasskeyRegistrationTransaction> {
		const result = await this.db.query<RegistrationTransactionRow>(
			`SELECT * FROM ${ATHENA_AUTH_TABLES.passkeyRegistrationTransactions}
        WHERE challenge_hash = $1 AND rp_id = $2`,
			[encodeBytes(input.challengeHash), input.rpId],
		);
		const found = result.rows[0];
		if (!found) {
			throw missingError();
		}
		if (found.consumed_at) {
			throw consumedError();
		}
		if ((asDate(found.expires_at)?.getTime() ?? 0) <= Date.now()) {
			throw expiredError();
		}
		return toTransaction(found);
	}

	async consume(input: {
		challengeHash: Uint8Array;
		rpId: string;
	}): Promise<AthenaPasskeyRegistrationTransaction> {
		const result = await this.db.query<RegistrationTransactionRow>(
			`UPDATE ${ATHENA_AUTH_TABLES.passkeyRegistrationTransactions}
          SET consumed_at = NOW()
        WHERE challenge_hash = $1
          AND rp_id = $2
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING *`,
			[encodeBytes(input.challengeHash), input.rpId],
		);
		const row = result.rows[0];
		if (row) {
			return toTransaction(row);
		}
		const existing = await this.db.query<RegistrationTransactionRow>(
			`SELECT * FROM ${ATHENA_AUTH_TABLES.passkeyRegistrationTransactions}
        WHERE challenge_hash = $1 AND rp_id = $2`,
			[encodeBytes(input.challengeHash), input.rpId],
		);
		const found = existing.rows[0];
		if (!found) {
			throw missingError();
		}
		if (found.consumed_at) {
			throw consumedError();
		}
		throw expiredError();
	}
}

function resolvePostgresDatabase(storesOrDb: object): AthenaAuthDatabase {
	if (
		"query" in storesOrDb &&
		typeof (storesOrDb as AthenaAuthDatabase).query === "function"
	) {
		return storesOrDb as AthenaAuthDatabase;
	}
	const nested = (storesOrDb as { db?: unknown }).db;
	if (
		nested &&
		typeof nested === "object" &&
		"query" in nested &&
		typeof (nested as AthenaAuthDatabase).query === "function"
	) {
		return nested as AthenaAuthDatabase;
	}
	throw new Error("passkey registration transactions require a database");
}

export function createPasskeyRegistrationTransactionStore(
	storesOrDb: MemoryAuthStores | object,
):
	| MemoryPasskeyRegistrationTransactionStore
	| PostgresPasskeyRegistrationTransactionStore {
	if (storesOrDb instanceof MemoryAuthStores) {
		return new MemoryPasskeyRegistrationTransactionStore(storesOrDb);
	}
	return new PostgresPasskeyRegistrationTransactionStore(
		resolvePostgresDatabase(storesOrDb),
	);
}
