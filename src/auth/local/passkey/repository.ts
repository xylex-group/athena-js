import { ATHENA_AUTH_TABLES } from "../../contract/index.ts";
import { normalizePasskeyDeviceType } from "../../passkey/metadata.ts";
import type { PasskeyRepository } from "../../passkey/server/repository.ts";
import type {
	AthenaStoredPasskey,
	AthenaStoredPasskeyCreate,
} from "../../passkey/server/types.ts";
import {
	parseStoredPasskeyTransports,
	serializePasskeyTransports,
} from "../../passkey/transports.ts";
import { base64Url } from "../../utils/base64.ts";
import type { AthenaAuthDatabase } from "../database.ts";
import { MemoryAuthStores } from "../memory-stores.ts";
import type { AuthPasskeyRow } from "../models.ts";
import type { PostgresAuthStores } from "../stores.ts";

function isAthenaAuthDatabase(value: object): value is AthenaAuthDatabase {
	return (
		"query" in value &&
		typeof (value as AthenaAuthDatabase).query === "function"
	);
}

function resolvePostgresDatabase(
	storesOrDb: PostgresAuthStores | AthenaAuthDatabase,
): AthenaAuthDatabase {
	if (isAthenaAuthDatabase(storesOrDb)) {
		return storesOrDb;
	}
	const nested = (storesOrDb as unknown as { db?: unknown }).db;
	if (nested && typeof nested === "object" && isAthenaAuthDatabase(nested)) {
		return nested;
	}
	throw new Error(
		"postgres passkey repository requires Auth stores or a database",
	);
}

function encodePasskeyBytes(bytes: Uint8Array): string {
	return base64Url.encode(bytes, { padding: false });
}

function decodePasskeyBytes(value: string): Uint8Array {
	return base64Url.decode(value);
}

function asDate(value: Date | string | null | undefined): Date {
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		return new Date(value);
	}
	return new Date();
}

function asBigInt(value: unknown): bigint {
	if (typeof value === "bigint") {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return BigInt(Math.trunc(value));
	}
	if (typeof value === "string" && value.trim()) {
		return BigInt(value);
	}
	throw new Error("passkey counter is not a bigint");
}

function assertNonNegativeCounter(value: bigint): void {
	if (value < 0n) {
		throw new Error("passkey counter must not be negative");
	}
}

function isZeroToZero(expected: bigint, next: bigint): boolean {
	return expected === 0n && next === 0n;
}

function assertIncreasingCounter(expected: bigint, next: bigint): void {
	assertNonNegativeCounter(expected);
	assertNonNegativeCounter(next);
	if (isZeroToZero(expected, next)) {
		return;
	}
	if (next <= expected) {
		throw new Error("passkey counter regression");
	}
}

function persistName(name: string | null | undefined): string {
	return name ?? "";
}

function domainName(name: string): string | null {
	return name === "" ? null : name;
}

function uniqueCredentialError(): Error {
	const error = new Error("duplicate key value violates unique constraint");
	(error as { code?: string }).code = "23505";
	return error;
}

function casMissError(): Error {
	return new Error("passkey credential counter CAS missed");
}

function notFoundError(): Error {
	return new Error("passkey not found");
}

function toStoredPasskey(row: AuthPasskeyRow): AthenaStoredPasskey {
	const transports = parseStoredPasskeyTransports(
		row.transports == null ? null : String(row.transports),
	);
	return {
		aaguid: row.aaguid ?? null,
		backedUp: Boolean(row.backed_up),
		counter: asBigInt(row.counter),
		createdAt: asDate(row.created_at),
		credentialId: decodePasskeyBytes(row.credential_id),
		deviceType: normalizePasskeyDeviceType(row.device_type),
		id: row.id,
		name: domainName(row.name),
		publicKey: decodePasskeyBytes(row.public_key),
		residentKey: row.resident_key == null ? null : Boolean(row.resident_key),
		transports: (transports ?? []) as AuthenticatorTransport[],
		updatedAt: asDate(row.updated_at),
		userId: row.user_id,
	};
}

function requireRow(
	row: AuthPasskeyRow | undefined,
	error: Error,
): AthenaStoredPasskey {
	if (!row) {
		throw error;
	}
	return toStoredPasskey(row);
}

/**
 * SQL PasskeyRepository against athena.passkeys (ADR 0034).
 * Counter CAS is one UPDATE … RETURNING *; zero rows is a canonical failure.
 */
export class LocalPasskeyRepository implements PasskeyRepository {
	constructor(private readonly db: AthenaAuthDatabase) {}

	async create(
		record: AthenaStoredPasskeyCreate,
	): Promise<AthenaStoredPasskey> {
		const counter = asBigInt(record.counter);
		assertNonNegativeCounter(counter);
		const result = await this.db.query<AuthPasskeyRow>(
			`INSERT INTO ${ATHENA_AUTH_TABLES.passkeys}
        (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, transports, aaguid, resident_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING *`,
			[
				record.id ?? crypto.randomUUID(),
				persistName(record.name),
				encodePasskeyBytes(record.publicKey),
				record.userId,
				encodePasskeyBytes(record.credentialId),
				counter,
				normalizePasskeyDeviceType(record.deviceType),
				Boolean(record.backedUp),
				serializePasskeyTransports(record.transports),
				record.aaguid,
				record.residentKey,
			],
		);
		return requireRow(result.rows[0], new Error("Failed to create passkey"));
	}

	async findByCredentialId(
		credentialId: Uint8Array,
	): Promise<AthenaStoredPasskey | null> {
		const result = await this.db.query<AuthPasskeyRow>(
			`SELECT * FROM ${ATHENA_AUTH_TABLES.passkeys} WHERE credential_id = $1`,
			[encodePasskeyBytes(credentialId)],
		);
		const row = result.rows[0];
		return row ? toStoredPasskey(row) : null;
	}

	async listByUser(userId: string): Promise<AthenaStoredPasskey[]> {
		const result = await this.db.query<AuthPasskeyRow>(
			`SELECT * FROM ${ATHENA_AUTH_TABLES.passkeys}
        WHERE user_id = $1
        ORDER BY created_at DESC`,
			[userId],
		);
		return result.rows.map((row) => toStoredPasskey(row));
	}

	async updateCounter(input: {
		credentialId: Uint8Array;
		expected: bigint;
		next: bigint;
	}): Promise<AthenaStoredPasskey> {
		assertIncreasingCounter(input.expected, input.next);
		if (isZeroToZero(input.expected, input.next)) {
			const current = await this.findByCredentialId(input.credentialId);
			if (!current || current.counter !== 0n) {
				throw casMissError();
			}
			return current;
		}
		const result = await this.db.query<AuthPasskeyRow>(
			`UPDATE ${ATHENA_AUTH_TABLES.passkeys}
          SET counter = $1,
              updated_at = NOW()
        WHERE credential_id = $2
          AND counter = $3
        RETURNING *`,
			[input.next, encodePasskeyBytes(input.credentialId), input.expected],
		);
		return requireRow(result.rows[0], casMissError());
	}

	async updateName(input: {
		id: string;
		userId: string;
		name: string;
	}): Promise<AthenaStoredPasskey> {
		const result = await this.db.query<AuthPasskeyRow>(
			`UPDATE ${ATHENA_AUTH_TABLES.passkeys}
          SET name = $1,
              updated_at = NOW()
        WHERE id = $2
          AND user_id = $3
        RETURNING *`,
			[persistName(input.name), input.id, input.userId],
		);
		return requireRow(result.rows[0], notFoundError());
	}

	async delete(input: { id: string; userId: string }): Promise<void> {
		const result = await this.db.query<AuthPasskeyRow>(
			`DELETE FROM ${ATHENA_AUTH_TABLES.passkeys}
        WHERE id = $1
          AND user_id = $2
        RETURNING *`,
			[input.id, input.userId],
		);
		if (!result.rows[0]) {
			throw notFoundError();
		}
	}
}

export class MemoryPasskeyRepository implements PasskeyRepository {
	constructor(private readonly stores: MemoryAuthStores) {}

	async create(
		record: AthenaStoredPasskeyCreate,
	): Promise<AthenaStoredPasskey> {
		const counter = asBigInt(record.counter);
		assertNonNegativeCounter(counter);
		const credentialId = encodePasskeyBytes(record.credentialId);
		for (const existing of this.stores.passkeys.values()) {
			if (existing.credential_id === credentialId) {
				throw uniqueCredentialError();
			}
		}
		const stamp = new Date();
		const row: AuthPasskeyRow = {
			aaguid: record.aaguid ?? null,
			backed_up: Boolean(record.backedUp),
			counter,
			created_at: stamp,
			credential_id: credentialId,
			device_type: normalizePasskeyDeviceType(record.deviceType),
			id: record.id ?? crypto.randomUUID(),
			name: persistName(record.name),
			public_key: encodePasskeyBytes(record.publicKey),
			resident_key: record.residentKey ?? null,
			transports: serializePasskeyTransports(record.transports),
			updated_at: stamp,
			user_id: record.userId,
		};
		this.stores.passkeys.set(row.id, row);
		return toStoredPasskey(row);
	}

	async findByCredentialId(
		credentialId: Uint8Array,
	): Promise<AthenaStoredPasskey | null> {
		const encoded = encodePasskeyBytes(credentialId);
		for (const row of this.stores.passkeys.values()) {
			if (row.credential_id === encoded) {
				return toStoredPasskey(row);
			}
		}
		return null;
	}

	async listByUser(userId: string): Promise<AthenaStoredPasskey[]> {
		return [...this.stores.passkeys.values()]
			.filter((row) => row.user_id === userId)
			.sort(
				(left, right) =>
					asDate(right.created_at).getTime() -
					asDate(left.created_at).getTime(),
			)
			.map((row) => toStoredPasskey(row));
	}

	async updateCounter(input: {
		credentialId: Uint8Array;
		expected: bigint;
		next: bigint;
	}): Promise<AthenaStoredPasskey> {
		assertIncreasingCounter(input.expected, input.next);
		const encoded = encodePasskeyBytes(input.credentialId);
		let found: AuthPasskeyRow | undefined;
		for (const row of this.stores.passkeys.values()) {
			if (row.credential_id === encoded) {
				found = row;
				break;
			}
		}
		if (!found || asBigInt(found.counter) !== input.expected) {
			throw casMissError();
		}
		if (isZeroToZero(input.expected, input.next)) {
			return toStoredPasskey(found);
		}
		found.counter = input.next;
		found.updated_at = new Date();
		return toStoredPasskey(found);
	}

	async updateName(input: {
		id: string;
		userId: string;
		name: string;
	}): Promise<AthenaStoredPasskey> {
		const row = this.stores.passkeys.get(input.id);
		if (!row || row.user_id !== input.userId) {
			throw notFoundError();
		}
		row.name = persistName(input.name);
		row.updated_at = new Date();
		return toStoredPasskey(row);
	}

	async delete(input: { id: string; userId: string }): Promise<void> {
		const row = this.stores.passkeys.get(input.id);
		if (!row || row.user_id !== input.userId) {
			throw notFoundError();
		}
		this.stores.passkeys.delete(input.id);
	}
}

export class PostgresPasskeyRepository extends LocalPasskeyRepository {
	constructor(storesOrDb: PostgresAuthStores | AthenaAuthDatabase) {
		super(resolvePostgresDatabase(storesOrDb));
	}
}

export function createMemoryPasskeyRepository(
	stores: MemoryAuthStores,
): PasskeyRepository {
	return new MemoryPasskeyRepository(stores);
}

export function createPostgresPasskeyRepository(
	storesOrDb: PostgresAuthStores | AthenaAuthDatabase,
): PasskeyRepository {
	return new PostgresPasskeyRepository(storesOrDb);
}

export function createPasskeyRepository(
	storesOrDb: MemoryAuthStores | PostgresAuthStores | AthenaAuthDatabase,
): PasskeyRepository {
	if (storesOrDb instanceof MemoryAuthStores) {
		return new MemoryPasskeyRepository(storesOrDb);
	}
	return new PostgresPasskeyRepository(storesOrDb);
}
