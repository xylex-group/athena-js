/**
 * Slice 04 TARGET — embedded PasskeyRepository (desired Memory+Postgres CAS).
 *
 * RED on CURRENT: `src/auth/local/passkey/repository.ts` absent; no Memory/Postgres
 * factories; no UNIQUE/list-scope/user-predicate/CAS SQL/concurrent winner.
 * GREEN after adapter: UNIQUE 23505, user-scoped rename/delete, one UPDATE CAS
 * RETURNING *, zero rows canonical throw, transports JSON TEXT, BE/BS reuse.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/04-passkey-repository-cas.md
 * Draft ADR 0034. IDs T-REPO-* only (not T-CHAL-* / T-PERS-* / T-REG-* / T-AUTHN-*).
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-runtime-finality.repository.target.test.ts
 *
 * Baseline retired: test/sdd/superseded/passkey-runtime-finality.repository.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inspect } from "node:util";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import committedManifest from "../../contracts/auth/schema-migrations.manifest.json" with {
	type: "json",
};
import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { createAuthModule } from "../../src/auth/client.ts";
import type { AthenaAuthDatabase } from "../../src/auth/local/database.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { getAthenaAuthSchemaManifest } from "../../src/auth/local/schema.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import {
	AUTHDATA_BE,
	AUTHDATA_BS,
	mapPasskeyAuthenticatorMetadata,
} from "../../src/auth/passkey/metadata.ts";
import type { PasskeyRepository } from "../../src/auth/passkey/server/repository.ts";
import { createAthenaPasskeyServerEngine } from "../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../src/auth/passkey/server/errors.ts";
import type {
	AthenaStoredPasskey,
	AthenaStoredPasskeyCreate,
} from "../../src/auth/passkey/server/types.ts";
import {
	parseStoredPasskeyTransports,
	serializePasskeyTransports,
} from "../../src/auth/passkey/transports.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const localPasskeyDir = join(srcRoot, "auth", "local", "passkey");
const localRepositoryPath = join(localPasskeyDir, "repository.ts");
const localIndexPath = join(localPasskeyDir, "index.ts");
const challengeStorePath = join(localPasskeyDir, "challenge-store.ts");
const modelsPath = join(srcRoot, "auth", "local", "models.ts");

const SAMPLE_PG =
	"postgresql://postgres@127.0.0.1:5432/athena_passkey_repository_cas_target";

const JS_005_CHECKSUM =
	"15819ba7636e29b718acc94fe9cf9ad5959202e18de6193f8fea2962718cfa17";

/** Track A P6 inventory amend: POST verify-registration is no longer a stay-true gap. */
const SIX_REMAINING_PASSKEY_ROUTES = [
	"GET /passkey/list-user-passkeys",
	"POST /passkey/delete-passkey",
	"POST /passkey/generate-authenticate-options",
	"POST /passkey/update-passkey",
	"POST /passkey/verify-authentication",
] as const;

const REPO_FACTORY_EXPORTS = [
	"createMemoryPasskeyRepository",
	"createPostgresPasskeyRepository",
	"createPasskeyRepository",
] as const;

const CHALLENGE_STORE_EXPORTS = [
	"createMemoryPasskeyChallengeStore",
	"createPasskeyChallengeStore",
	"createPostgresPasskeyChallengeStore",
	"LocalPasskeyChallengeStore",
	"MemoryPasskeyChallengeStore",
	"PostgresPasskeyChallengeStore",
] as const;

const CAS_SQL =
	/UPDATE[\s\S]*?(?:athena\.passkeys|\$\{ATHENA_AUTH_TABLES\.passkeys\})[\s\S]*?SET[\s\S]*?counter\s*=[\s\S]*?updated_at\s*=\s*NOW\(\)[\s\S]*?WHERE[\s\S]*?credential_id\s*=[\s\S]*?AND[\s\S]*?counter\s*=[\s\S]*?RETURNING\s+\*/i;

const RENAME_SQL =
	/UPDATE[\s\S]*?(?:athena\.passkeys|\$\{ATHENA_AUTH_TABLES\.passkeys\})[\s\S]*?SET[\s\S]*?name\s*=[\s\S]*?updated_at\s*=\s*NOW\(\)[\s\S]*?WHERE[\s\S]*?(?:id\s*=[\s\S]*?user_id\s*=|user_id\s*=[\s\S]*?id\s*=)[\s\S]*?RETURNING\s+\*/i;

const DELETE_SQL =
	/DELETE\s+FROM[\s\S]*?(?:athena\.passkeys|\$\{ATHENA_AUTH_TABLES\.passkeys\})[\s\S]*?WHERE[\s\S]*?(?:id\s*=[\s\S]*?user_id\s*=|user_id\s*=[\s\S]*?id\s*=)[\s\S]*?RETURNING\s+\*/i;

type PasskeySqlRow = {
	aaguid: string | null;
	backed_up: boolean;
	counter: bigint;
	created_at: Date;
	credential_id: string;
	device_type: string;
	id: string;
	name: string;
	public_key: string;
	resident_key: boolean | null;
	transports: string | null;
	updated_at: Date;
	user_id: string;
};

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function inventoryKnownMissing(): string {
	const src = readPkg("test/auth-route-inventory.test.ts");
	const match = src.match(
		/const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/,
	);
	assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
	return match[1] ?? "";
}

function extractBalanced(src: string, start: number, openAt: number): string {
	let depth = 0;
	for (let i = openAt; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") {
			depth += 1;
		} else if (ch === "}") {
			depth -= 1;
			if (depth === 0) {
				return src.slice(start, i + 1);
			}
		}
	}
	throw new Error(`unbalanced block starting at ${start}`);
}

function extractFn(src: string, name: string): string {
	const re = new RegExp(`(?:async\\s+)?${name}\\s*\\(`);
	const start = src.search(re);
	assert.ok(start >= 0, `missing function ${name} in repository adapter`);
	const paramOpen = src.indexOf("(", start);
	let depth = 0;
	let paramClose = -1;
	for (let i = paramOpen; i < src.length; i++) {
		const ch = src[i];
		if (ch === "(") {
			depth += 1;
		} else if (ch === ")") {
			depth -= 1;
			if (depth === 0) {
				paramClose = i;
				break;
			}
		}
	}
	assert.ok(paramClose >= 0, `unclosed params for ${name}`);
	const openAt = src.indexOf("{", paramClose);
	assert.ok(openAt >= 0, `missing body for ${name}`);
	return extractBalanced(src, start, openAt);
}

function requireAdapterSources(): { indexSrc: string; repoSrc: string } {
	assert.equal(
		existsSync(localRepositoryPath),
		true,
		"found case: src/auth/local/passkey/repository.ts is absent (no PasskeyRepository adapter)",
	);
	assert.equal(
		existsSync(localIndexPath),
		true,
		"src/auth/local/passkey/index.ts must exist",
	);
	return {
		indexSrc: readFileSync(localIndexPath, "utf8"),
		repoSrc: readFileSync(localRepositoryPath, "utf8"),
	};
}

function encodeCredentialId(bytes: Uint8Array): string {
	return Buffer.from(bytes)
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	for (let i = 0; i < left.byteLength; i++) {
		if (left[i] !== right[i]) {
			return false;
		}
	}
	return true;
}

function asRepo(value: unknown): PasskeyRepository {
	const repo = value as PasskeyRepository;
	assert.equal(typeof repo.create, "function");
	assert.equal(typeof repo.findByCredentialId, "function");
	assert.equal(typeof repo.listByUser, "function");
	assert.equal(typeof repo.updateCounter, "function");
	assert.equal(typeof repo.updateName, "function");
	assert.equal(typeof repo.delete, "function");
	return repo;
}

async function constructFromExport(
	factory: unknown,
	arg: unknown,
): Promise<PasskeyRepository | null> {
	if (typeof factory !== "function") {
		return null;
	}
	try {
		const maybe = (factory as (input: unknown) => unknown)(arg);
		const resolved =
			typeof (maybe as Promise<unknown>)?.then === "function"
				? await (maybe as Promise<unknown>)
				: maybe;
		if (resolved && typeof (resolved as { create?: unknown }).create === "function") {
			return asRepo(resolved);
		}
	} catch {
		/* try construct */
	}
	try {
		return asRepo(
			new (factory as new (input: unknown) => PasskeyRepository)(arg),
		);
	} catch {
		return null;
	}
}

async function loadLocalPasskeyModule(): Promise<Record<string, unknown>> {
	requireAdapterSources();
	return (await import(pathToFileURL(localIndexPath).href)) as Record<
		string,
		unknown
	>;
}

function normalizeSql(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function placeholderIndex(fragment: string, column: string): number {
	const match = fragment.match(
		new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`, "i"),
	);
	return match ? Number(match[1]) - 1 : -1;
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
	throw new Error(`yielding passkey db: not a bigint (${inspect(value)})`);
}

function toPgRow(row: PasskeySqlRow): Record<string, unknown> {
	return {
		aaguid: row.aaguid,
		backed_up: row.backed_up,
		counter: row.counter.toString(),
		created_at: row.created_at,
		credential_id: row.credential_id,
		device_type: row.device_type,
		id: row.id,
		name: row.name,
		public_key: row.public_key,
		resident_key: row.resident_key,
		transports: row.transports,
		updated_at: row.updated_at,
		user_id: row.user_id,
	};
}

class UniqueViolationError extends Error {
	readonly code = "23505";

	constructor() {
		super("duplicate key value violates unique constraint");
		this.name = "UniqueViolationError";
	}
}

class YieldingPasskeyDb implements AthenaAuthDatabase {
	readonly rows: PasskeySqlRow[] = [];

	async query<T = Record<string, unknown>>(
		text: string,
		values: unknown[] = [],
	): Promise<{ rowCount: number; rows: T[] }> {
		await Promise.resolve();
		const result = this.execute(text, values);
		return result as { rowCount: number; rows: T[] };
	}

	async transaction<T>(
		fn: (db: AthenaAuthDatabase) => Promise<T>,
	): Promise<T> {
		return fn(this);
	}

	private execute(
		text: string,
		values: unknown[],
	): { rowCount: number; rows: Record<string, unknown>[] } {
		const sql = normalizeSql(text);
		if (/INSERT\s+INTO\s+athena\.passkeys/i.test(sql)) {
			return this.executeInsert(sql, values);
		}
		if (/UPDATE\s+athena\.passkeys/i.test(sql)) {
			return this.executeUpdate(sql, values);
		}
		if (/DELETE\s+FROM\s+athena\.passkeys/i.test(sql)) {
			return this.executeDelete(sql, values);
		}
		if (/SELECT\s+[\s\S]*FROM\s+athena\.passkeys/i.test(sql)) {
			return this.executeSelect(sql, values);
		}
		throw new Error(`yielding passkey db does not execute: ${sql}`);
	}

	private executeInsert(
		sql: string,
		values: unknown[],
	): { rowCount: number; rows: Record<string, unknown>[] } {
		const parsed = sql.match(
			/INSERT\s+INTO\s+athena\.passkeys\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
		);
		assert.ok(parsed, `INSERT must list columns: ${sql}`);
		const columns = (parsed[1] ?? "")
			.split(",")
			.map((part) => part.trim().toLowerCase());
		const placeholders = (parsed[2] ?? "").split(",").map((part) => part.trim());
		const record: Record<string, unknown> = {};
		for (let i = 0; i < columns.length; i++) {
			const column = columns[i];
			const token = placeholders[i] ?? "";
			const dollar = token.match(/^\$(\d+)$/);
			if (!column) {
				continue;
			}
			if (dollar) {
				record[column] = values[Number(dollar[1]) - 1];
			} else if (/^now\(\)$/i.test(token)) {
				record[column] = new Date();
			} else if (/^null$/i.test(token)) {
				record[column] = null;
			}
		}
		const credentialId = String(record.credential_id ?? "");
		if (this.rows.some((row) => row.credential_id === credentialId)) {
			throw new UniqueViolationError();
		}
		const stamp = new Date();
		const row: PasskeySqlRow = {
			aaguid:
				record.aaguid == null || record.aaguid === ""
					? null
					: String(record.aaguid),
			backed_up: Boolean(record.backed_up),
			counter: asBigInt(record.counter ?? 0n),
			created_at:
				record.created_at instanceof Date
					? record.created_at
					: stamp,
			credential_id: credentialId,
			device_type: String(record.device_type ?? "singleDevice"),
			id: String(record.id ?? crypto.randomUUID()),
			name: String(record.name ?? ""),
			public_key: String(record.public_key ?? ""),
			resident_key:
				record.resident_key == null ? null : Boolean(record.resident_key),
			transports:
				record.transports == null || record.transports === ""
					? null
					: String(record.transports),
			updated_at:
				record.updated_at instanceof Date ? record.updated_at : stamp,
			user_id: String(record.user_id ?? ""),
		};
		this.rows.push(row);
		return { rowCount: 1, rows: [toPgRow(row)] };
	}

	private executeUpdate(
		sql: string,
		values: unknown[],
	): { rowCount: number; rows: Record<string, unknown>[] } {
		const whereAt = sql.search(/\bWHERE\b/i);
		assert.ok(whereAt >= 0, `UPDATE must include WHERE: ${sql}`);
		const setSql = sql.slice(0, whereAt);
		const whereSql = sql.slice(whereAt);
		const updated: PasskeySqlRow[] = [];
		for (const row of this.rows) {
			if (!this.matchesWhere(row, whereSql, values)) {
				continue;
			}
			const counterIdx = placeholderIndex(setSql, "counter");
			const nameIdx = placeholderIndex(setSql, "name");
			if (counterIdx >= 0) {
				row.counter = asBigInt(values[counterIdx]);
			}
			if (nameIdx >= 0) {
				row.name = String(values[nameIdx] ?? "");
			}
			if (/updated_at\s*=\s*NOW\(\)/i.test(setSql)) {
				row.updated_at = new Date();
			}
			updated.push(row);
		}
		return {
			rowCount: updated.length,
			rows: updated.map((row) => toPgRow(row)),
		};
	}

	private executeDelete(
		sql: string,
		values: unknown[],
	): { rowCount: number; rows: Record<string, unknown>[] } {
		const whereAt = sql.search(/\bWHERE\b/i);
		assert.ok(whereAt >= 0, `DELETE must include WHERE: ${sql}`);
		const whereSql = sql.slice(whereAt);
		const kept: PasskeySqlRow[] = [];
		const deleted: PasskeySqlRow[] = [];
		for (const row of this.rows) {
			if (this.matchesWhere(row, whereSql, values)) {
				deleted.push(row);
			} else {
				kept.push(row);
			}
		}
		this.rows.length = 0;
		this.rows.push(...kept);
		return {
			rowCount: deleted.length,
			rows: deleted.map((row) => toPgRow(row)),
		};
	}

	private executeSelect(
		sql: string,
		values: unknown[],
	): { rowCount: number; rows: Record<string, unknown>[] } {
		const whereAt = sql.search(/\bWHERE\b/i);
		const whereSql = whereAt >= 0 ? sql.slice(whereAt) : "";
		let matched = this.rows.filter((row) =>
			whereAt >= 0 ? this.matchesWhere(row, whereSql, values) : true,
		);
		if (/ORDER BY\s+created_at\s+DESC/i.test(sql)) {
			matched = [...matched].sort(
				(a, b) => b.created_at.getTime() - a.created_at.getTime(),
			);
		}
		return {
			rowCount: matched.length,
			rows: matched.map((row) => toPgRow(row)),
		};
	}

	private matchesWhere(
		row: PasskeySqlRow,
		whereSql: string,
		values: unknown[],
	): boolean {
		const credentialIdx = placeholderIndex(whereSql, "credential_id");
		if (
			credentialIdx >= 0 &&
			row.credential_id !== String(values[credentialIdx])
		) {
			return false;
		}
		const idIdx = placeholderIndex(whereSql, "id");
		if (idIdx >= 0 && row.id !== String(values[idIdx])) {
			return false;
		}
		const userIdx = placeholderIndex(whereSql, "user_id");
		if (userIdx >= 0 && row.user_id !== String(values[userIdx])) {
			return false;
		}
		const counterIdx = placeholderIndex(whereSql, "counter");
		if (counterIdx >= 0 && row.counter !== asBigInt(values[counterIdx])) {
			return false;
		}
		return true;
	}
}

async function instantiateMemoryRepo(): Promise<{
	repo: PasskeyRepository;
	stores: MemoryAuthStores;
}> {
	const mod = await loadLocalPasskeyModule();
	const stores = new MemoryAuthStores();
	const candidates = [
		mod.createMemoryPasskeyRepository,
		mod.createPasskeyRepository,
		mod.MemoryPasskeyRepository,
		mod.LocalPasskeyRepository,
	];
	for (const candidate of candidates) {
		const repo = await constructFromExport(candidate, stores);
		if (repo) {
			return { repo, stores };
		}
	}
	assert.fail(
		"local/passkey must export a Memory PasskeyRepository factory or class",
	);
}

async function instantiatePostgresRepo(): Promise<{
	db: YieldingPasskeyDb;
	repo: PasskeyRepository;
	stores: PostgresAuthStores;
}> {
	const mod = await loadLocalPasskeyModule();
	const db = new YieldingPasskeyDb();
	const stores = new PostgresAuthStores(db);
	const candidates = [
		mod.createPostgresPasskeyRepository,
		mod.PostgresPasskeyRepository,
		mod.createPasskeyRepository,
		mod.LocalPasskeyRepository,
	];
	for (const candidate of candidates) {
		const repo =
			(await constructFromExport(candidate, db)) ??
			(await constructFromExport(candidate, stores));
		if (repo) {
			return { db, repo, stores };
		}
	}
	assert.fail(
		"local/passkey must export a Postgres PasskeyRepository factory or class",
	);
}

type RepoKind = "memory" | "postgres";

async function withEachRepo(
	run: (input: {
		db?: YieldingPasskeyDb;
		kind: RepoKind;
		repo: PasskeyRepository;
		stores: MemoryAuthStores | PostgresAuthStores;
	}) => Promise<void>,
): Promise<void> {
	{
		const memory = await instantiateMemoryRepo();
		await run({ kind: "memory", repo: memory.repo, stores: memory.stores });
	}
	{
		const postgres = await instantiatePostgresRepo();
		await run({
			db: postgres.db,
			kind: "postgres",
			repo: postgres.repo,
			stores: postgres.stores,
		});
	}
}

function sampleCreate(
	overrides: Partial<AthenaStoredPasskeyCreate> & {
		credentialId?: Uint8Array;
		userId?: string;
	} = {},
): AthenaStoredPasskeyCreate {
	return {
		aaguid: null,
		backedUp: false,
		counter: 0n,
		credentialId: overrides.credentialId ?? new Uint8Array([1, 2, 3, 4, 5]),
		deviceType: "singleDevice",
		name: "primary",
		publicKey: new Uint8Array([9, 8, 7, 6]),
		residentKey: null,
		transports: ["internal"],
		userId: overrides.userId ?? "user-a",
		...overrides,
	};
}

function isUniqueViolation(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error as { code?: string }).code === "23505"
	);
}

async function assertCanonicalFailure(
	action: () => Promise<unknown>,
	message: string,
): Promise<void> {
	try {
		const result = await action();
		assert.fail(
			`${message}: expected canonical throw, got ${inspect(result)}`,
		);
	} catch (error) {
		if (error instanceof assert.AssertionError) {
			throw error;
		}
		assert.ok(error instanceof Error, message);
		assert.equal(
			error instanceof AthenaPasskeyServerNotWiredError,
			false,
			`${message}: must not be the unwired engine error`,
		);
	}
}

function isCasWinner(
	result: PromiseSettledResult<AthenaStoredPasskey>,
	next: bigint,
): boolean {
	return (
		result.status === "fulfilled" && result.value.counter === next
	);
}

function memoryPasskeyRows(stores: MemoryAuthStores): Record<string, unknown>[] {
	const map = (stores as { passkeys?: Map<string, Record<string, unknown>> })
		.passkeys;
	assert.ok(
		map instanceof Map,
		"MemoryAuthStores.passkeys map must exist for persistence inspect",
	);
	return [...map.values()];
}

function persistedTransports(
	kind: RepoKind,
	stores: MemoryAuthStores | PostgresAuthStores,
	db: YieldingPasskeyDb | undefined,
	credentialId: Uint8Array,
): string | null {
	const encoded = encodeCredentialId(credentialId);
	if (kind === "postgres") {
		assert.ok(db, "postgres inspect requires yielding db");
		const row = db.rows.find((entry) => entry.credential_id === encoded);
		assert.ok(row, "postgres row missing after create");
		return row.transports;
	}
	const rows = memoryPasskeyRows(stores as MemoryAuthStores);
	const row = rows.find((entry) => {
		const id = entry.credential_id ?? entry.credentialId;
		if (id instanceof Uint8Array) {
			return encodeCredentialId(id) === encoded;
		}
		return String(id) === encoded;
	});
	assert.ok(row, "memory passkeys row missing after create");
	const raw = row.transports;
	if (Array.isArray(raw)) {
		return serializePasskeyTransports(raw as string[]);
	}
	if (raw == null || raw === "") {
		return null;
	}
	assert.equal(
		typeof raw,
		"string",
		"Memory transports must persist as JSON-array string or NULL",
	);
	return String(raw);
}

test("T-REPO-ADAPTER: repository.ts exists; Memory+Postgres factories exported from index.ts; implements PasskeyRepository", async () => {
	const { indexSrc, repoSrc } = requireAdapterSources();
	for (const name of REPO_FACTORY_EXPORTS) {
		assert.match(
			indexSrc,
			new RegExp(`\\b${name}\\b`),
			`local/passkey/index.ts must export ${name}`,
		);
	}
	for (const name of CHALLENGE_STORE_EXPORTS) {
		assert.match(
			indexSrc,
			new RegExp(`\\b${name}\\b`),
			`challenge-store re-export ${name} must remain`,
		);
	}
	assert.match(repoSrc, /PasskeyRepository/);
	assert.match(repoSrc, /\bcreate\s*\(/);
	assert.match(repoSrc, /\bfindByCredentialId\s*\(/);
	assert.match(repoSrc, /\blistByUser\s*\(/);
	assert.match(repoSrc, /\bupdateCounter\s*\(/);
	assert.match(repoSrc, /\bupdateName\s*\(/);
	assert.match(repoSrc, /\bdelete\s*\(/);

	const modelsSrc = existsSync(modelsPath)
		? readFileSync(modelsPath, "utf8")
		: "";
	assert.match(
		`${modelsSrc}\n${repoSrc}`,
		/\bAuthPasskeyRow\b/,
		"AuthPasskeyRow must exist for the passkeys persistence row",
	);

	const stores = new MemoryAuthStores();
	assert.ok(
		"passkeys" in stores &&
			(stores as { passkeys?: unknown }).passkeys instanceof Map,
		"MemoryAuthStores must expose a passkeys map",
	);

	const memory = await instantiateMemoryRepo();
	asRepo(memory.repo);
	const postgres = await instantiatePostgresRepo();
	asRepo(postgres.repo);
});

test("T-REPO-CAS-SQL: one UPDATE SET counter=$next, updated_at=NOW() WHERE credential_id=$id AND counter=$expected RETURNING *; no SELECT-then-UPDATE", () => {
	const { repoSrc } = requireAdapterSources();
	const storesSrc = readPkg("src/auth/local/stores.ts");
	const combined = `${repoSrc}\n${storesSrc}`;
	assert.match(
		combined,
		CAS_SQL,
		"found case: counter write is not one UPDATE … SET counter, updated_at=NOW() WHERE credential_id AND counter=$expected RETURNING *",
	);
	const cas = extractFn(repoSrc, "updateCounter");
	assert.equal(
		/SELECT[\s\S]*FROM[\s\S]*passkeys[\s\S]*UPDATE/i.test(cas),
		false,
		"updateCounter must not SELECT-then-UPDATE",
	);
	assert.equal(
		/UPDATE[\s\S]*SET[\s\S]*counter\s*=[\s\S]*WHERE[\s\S]*credential_id\s*=(?![\s\S]*counter\s*=)/i.test(
			cas,
		),
		false,
		"last-write-wins UPDATE SET counter WHERE credential_id (no expected) is forbidden",
	);
	assert.equal(
		/\bawait\b/.test(cas) && /SELECT/i.test(cas),
		false,
		"CAS must not await a SELECT before the mutating UPDATE",
	);
});

test("T-REPO-USER-PREDICATE: updateName / delete SQL (and Memory) include user_id in WHERE; no fetch-then-trust", () => {
	const { repoSrc } = requireAdapterSources();
	const storesSrc = readPkg("src/auth/local/stores.ts");
	const combined = `${repoSrc}\n${storesSrc}`;
	assert.match(
		combined,
		RENAME_SQL,
		"updateName must be UPDATE … SET name, updated_at=NOW() WHERE id AND user_id RETURNING *",
	);
	assert.match(
		combined,
		DELETE_SQL,
		"delete must be DELETE FROM passkeys WHERE id AND user_id RETURNING *",
	);
	const rename = extractFn(repoSrc, "updateName");
	const del = extractFn(repoSrc, "delete");
	assert.match(rename, /userId|user_id/);
	assert.match(del, /userId|user_id/);
	assert.equal(
		/findBy(?:Id|CredentialId)[\s\S]{0,400}userId\s*===/.test(del),
		false,
		"delete must not SELECT then trust row.userId === input.userId",
	);
	assert.equal(
		/findBy(?:Id|CredentialId)[\s\S]{0,400}userId\s*===/.test(rename),
		false,
		"updateName must not SELECT then trust row.userId === input.userId",
	);
});

test("T-REPO-UNIQUE: duplicate credential_id create fails (UNIQUE / 23505)", async () => {
	await withEachRepo(async ({ repo, kind }) => {
		const record = sampleCreate({
			credentialId: new Uint8Array([10, 20, 30, kind === "memory" ? 1 : 2]),
		});
		const first = await repo.create(record);
		assert.ok(bytesEqual(first.credentialId, record.credentialId));
		try {
			await repo.create({
				...record,
				userId: "other-user",
				name: "clone",
			});
			assert.fail(`${kind}: second insert of the same credential_id must fail`);
		} catch (error) {
			if (error instanceof assert.AssertionError) {
				throw error;
			}
			assert.equal(
				isUniqueViolation(error),
				true,
				`${kind}: duplicate credential_id must throw with code 23505 (found case: second insert of the same encoded id)`,
			);
		}
		const listed = await repo.listByUser(record.userId);
		assert.equal(listed.length, 1, `${kind}: duplicate must not insert a second row`);
	});
});

test("T-REPO-LIST-USER: listByUser returns only the current user's rows", async () => {
	await withEachRepo(async ({ repo, kind }) => {
		const a1 = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([40, 1, kind === "memory" ? 1 : 2]),
				name: "a-one",
				userId: "user-a",
			}),
		);
		await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([40, 2, kind === "memory" ? 1 : 2]),
				name: "b-one",
				userId: "user-b",
			}),
		);
		const a2 = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([40, 3, kind === "memory" ? 1 : 2]),
				name: "a-two",
				userId: "user-a",
			}),
		);
		const listed = await repo.listByUser("user-a");
		assert.equal(
			listed.every((row) => row.userId === "user-a"),
			true,
			`${kind}: found case: user B's row must not appear in user A's list`,
		);
		assert.equal(listed.length, 2, `${kind}: user-a must see both of their credentials`);
		const ids = new Set(listed.map((row) => row.id));
		assert.equal(ids.has(a1.id), true);
		assert.equal(ids.has(a2.id), true);
		assert.equal(
			listed.some((row) => row.name === "b-one"),
			false,
		);
	});
});

test("T-REPO-DELETE-SCOPE: wrong userId is not-found; victim row unchanged", async () => {
	await withEachRepo(async ({ repo, kind }) => {
		const victim = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([50, 1, kind === "memory" ? 1 : 2]),
				userId: "victim",
			}),
		);
		await assertCanonicalFailure(
			() => repo.delete({ id: victim.id, userId: "attacker" }),
			`${kind}: found case: attacker user id + victim passkey id must not delete`,
		);
		const still = await repo.findByCredentialId(victim.credentialId);
		assert.ok(still, `${kind}: victim row must remain`);
		assert.equal(still.id, victim.id);
		assert.equal(still.userId, "victim");
		await repo.delete({ id: victim.id, userId: "victim" });
		assert.equal(await repo.findByCredentialId(victim.credentialId), null);
	});
});

test("T-REPO-RENAME-SCOPE: wrong userId is not-found; name unchanged", async () => {
	await withEachRepo(async ({ repo, kind }) => {
		const victim = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([51, 1, kind === "memory" ? 1 : 2]),
				name: "original",
				userId: "victim",
			}),
		);
		await assertCanonicalFailure(
			() =>
				repo.updateName({
					id: victim.id,
					name: "hijacked",
					userId: "attacker",
				}),
			`${kind}: found case: attacker user id + victim passkey id must not rename`,
		);
		const still = await repo.findByCredentialId(victim.credentialId);
		assert.ok(still);
		assert.equal(still.name, "original", `${kind}: victim name must be unchanged`);
		const renamed = await repo.updateName({
			id: victim.id,
			name: "renamed",
			userId: "victim",
		});
		assert.equal(renamed.name, "renamed");
		assert.ok(renamed.updatedAt instanceof Date);
	});
});

test("T-REPO-CAS-REGRESS: next<=expected or expected mismatch is rejected; stored counter unchanged", async () => {
	await withEachRepo(async ({ repo, kind }) => {
		const created = await repo.create(
			sampleCreate({
				counter: 5n,
				credentialId: new Uint8Array([60, 1, kind === "memory" ? 1 : 2]),
			}),
		);
		assert.equal(created.counter, 5n);
		await assertCanonicalFailure(
			() =>
				repo.updateCounter({
					credentialId: created.credentialId,
					expected: 5n,
					next: 4n,
				}),
			`${kind}: found case: expected=5, next=4 must reject without a write`,
		);
		await assertCanonicalFailure(
			() =>
				repo.updateCounter({
					credentialId: created.credentialId,
					expected: 5n,
					next: 5n,
				}),
			`${kind}: next === expected is non-increasing and must reject`,
		);
		const afterRegress = await repo.findByCredentialId(created.credentialId);
		assert.ok(afterRegress);
		assert.equal(afterRegress.counter, 5n, `${kind}: stored counter must stay 5`);

		await assertCanonicalFailure(
			() =>
				repo.updateCounter({
					credentialId: created.credentialId,
					expected: 4n,
					next: 6n,
				}),
			`${kind}: found case: stale expected must reject`,
		);
		const afterStale = await repo.findByCredentialId(created.credentialId);
		assert.ok(afterStale);
		assert.equal(afterStale.counter, 5n);

		const advanced = await repo.updateCounter({
			credentialId: created.credentialId,
			expected: 5n,
			next: 6n,
		});
		assert.equal(advanced.counter, 6n);
		assert.ok(advanced.updatedAt instanceof Date);
	});
});

test("T-REPO-CAS-ZERO: missing id or raced expected throws; never silent success; stored unchanged", async () => {
	await withEachRepo(async ({ repo, kind }) => {
		const missingId = new Uint8Array([70, 9, kind === "memory" ? 1 : 2]);
		await assertCanonicalFailure(
			() =>
				repo.updateCounter({
					credentialId: missingId,
					expected: 0n,
					next: 1n,
				}),
			`${kind}: missing credential id must throw (never null / never success)`,
		);
		assert.equal(await repo.findByCredentialId(missingId), null);

		const created = await repo.create(
			sampleCreate({
				counter: 0n,
				credentialId: new Uint8Array([70, 1, kind === "memory" ? 1 : 2]),
			}),
		);
		const winner = await repo.updateCounter({
			credentialId: created.credentialId,
			expected: 0n,
			next: 1n,
		});
		assert.equal(winner.counter, 1n);
		await assertCanonicalFailure(
			() =>
				repo.updateCounter({
					credentialId: created.credentialId,
					expected: 0n,
					next: 1n,
				}),
			`${kind}: raced/regressed expected after a winner must throw`,
		);
		const stored = await repo.findByCredentialId(created.credentialId);
		assert.ok(stored);
		assert.equal(stored.counter, 1n);
	});
});

test("T-REPO-CAS-RACE: two concurrent updateCounter with the same expected yield exactly one winner (Memory)", async () => {
	const { repo } = await instantiateMemoryRepo();
	const created = await repo.create(
		sampleCreate({
			counter: 0n,
			credentialId: new Uint8Array([80, 1, 1]),
		}),
	);
	const results = await Promise.allSettled([
		repo.updateCounter({
			credentialId: created.credentialId,
			expected: 0n,
			next: 1n,
		}),
		repo.updateCounter({
			credentialId: created.credentialId,
			expected: 0n,
			next: 1n,
		}),
	]);
	const winners = results.filter((item) =>
		isCasWinner(item as PromiseSettledResult<AthenaStoredPasskey>, 1n),
	);
	assert.equal(
		winners.length,
		1,
		"found case: overlapping Memory promises both seeing counter 0 must have exactly one winner",
	);
	const stored = await repo.findByCredentialId(created.credentialId);
	assert.ok(stored);
	assert.equal(stored.counter, 1n);
	const { repoSrc } = requireAdapterSources();
	const cas = extractFn(repoSrc, "updateCounter");
	const memoryClass = /class\s+MemoryPasskeyRepository[\s\S]*class\s+Postgres/i.test(
		repoSrc,
	)
		? repoSrc.slice(
				repoSrc.search(/class\s+MemoryPasskeyRepository/),
				repoSrc.search(/class\s+PostgresPasskeyRepository/) >= 0
					? repoSrc.search(/class\s+PostgresPasskeyRepository/)
					: repoSrc.length,
			)
		: cas;
	const memoryCas = /updateCounter/.test(memoryClass)
		? extractFn(memoryClass, "updateCounter")
		: cas;
	assert.equal(
		/\bawait\b/.test(memoryCas),
		false,
		"Memory CAS must mutate in one synchronous section (no await between match and write)",
	);
});

test("T-REPO-CAS-RACE: two concurrent updateCounter with the same expected yield exactly one winner (Postgres / in-process SQL)", async () => {
	const { repo } = await instantiatePostgresRepo();
	const created = await repo.create(
		sampleCreate({
			counter: 0n,
			credentialId: new Uint8Array([80, 1, 2]),
		}),
	);
	const results = await Promise.allSettled([
		repo.updateCounter({
			credentialId: created.credentialId,
			expected: 0n,
			next: 1n,
		}),
		repo.updateCounter({
			credentialId: created.credentialId,
			expected: 0n,
			next: 1n,
		}),
	]);
	const winners = results.filter((item) =>
		isCasWinner(item as PromiseSettledResult<AthenaStoredPasskey>, 1n),
	);
	assert.equal(
		winners.length,
		1,
		"found case: overlapping Postgres queries both seeing counter 0 must have exactly one winner",
	);
	const stored = await repo.findByCredentialId(created.credentialId);
	assert.ok(stored);
	assert.equal(stored.counter, 1n);
});

test("T-REPO-TRANSPORTS: JSON-array string round-trip; empty persists NULL", async () => {
	await withEachRepo(async ({ repo, kind, stores, db }) => {
		const listed = ["internal", "hybrid"] as AuthenticatorTransport[];
		const created = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([90, 1, kind === "memory" ? 1 : 2]),
				transports: listed,
			}),
		);
		assert.deepEqual([...created.transports], listed);
		const found = await repo.findByCredentialId(created.credentialId);
		assert.ok(found);
		assert.deepEqual([...found.transports], listed);
		assert.equal(
			persistedTransports(kind, stores, db, created.credentialId),
			serializePasskeyTransports(listed),
			`${kind}: transports must persist as JSON-array string`,
		);
		assert.equal(
			serializePasskeyTransports(listed),
			JSON.stringify(["internal", "hybrid"]),
		);

		const empty = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([90, 2, kind === "memory" ? 1 : 2]),
				transports: [],
				userId: "user-empty",
			}),
		);
		assert.deepEqual([...empty.transports], []);
		assert.equal(
			persistedTransports(kind, stores, db, empty.credentialId),
			null,
			`${kind}: empty transports must persist NULL`,
		);
		assert.equal(parseStoredPasskeyTransports(null), null);
	});
});

test("T-REPO-BE-BS: reuse mapPasskeyAuthenticatorMetadata + transports helpers; multiDevice !== backedUp", async () => {
	const { repoSrc } = requireAdapterSources();
	assert.match(
		repoSrc,
		/mapPasskeyAuthenticatorMetadata|parseStoredPasskeyTransports|serializePasskeyTransports/,
		"adapter must reuse existing mapper / transports helpers (no second BE/BS table)",
	);
	assert.equal(
		/AUTHDATA_BE\s*=/.test(repoSrc) || /0x08/.test(repoSrc),
		false,
		"must not fork BE/BS flag mapping inside repository.ts",
	);

	const xor = mapPasskeyAuthenticatorMetadata({
		flags: AUTHDATA_BE,
		transports: ["internal"],
	});
	assert.equal(xor.deviceType, "multiDevice");
	assert.equal(xor.backedUp, false);
	assert.notEqual(xor.deviceType === "multiDevice", xor.backedUp);
	assert.equal(xor.transports, serializePasskeyTransports(["internal"]));

	const both = mapPasskeyAuthenticatorMetadata({
		flags: AUTHDATA_BE | AUTHDATA_BS,
		transports: null,
	});
	assert.equal(both.deviceType, "multiDevice");
	assert.equal(both.backedUp, true);

	await withEachRepo(async ({ repo, kind }) => {
		const created = await repo.create(
			sampleCreate({
				backedUp: xor.backedUp,
				credentialId: new Uint8Array([91, 1, kind === "memory" ? 1 : 2]),
				deviceType: xor.deviceType,
				transports: ["internal"],
			}),
		);
		assert.equal(created.deviceType, "multiDevice");
		assert.equal(created.backedUp, false);
		const found = await repo.findByCredentialId(created.credentialId);
		assert.ok(found);
		assert.equal(found.deviceType, "multiDevice");
		assert.equal(found.backedUp, false);
	});
});

test("T-REPO-UPDATED-AT: CAS and rename set updated_at = NOW(); returned updatedAt is a Date", async () => {
	const { repoSrc } = requireAdapterSources();
	assert.match(
		extractFn(repoSrc, "updateCounter"),
		/updated_at\s*=\s*NOW\(\)/i,
	);
	assert.match(extractFn(repoSrc, "updateName"), /updated_at\s*=\s*NOW\(\)/i);

	await withEachRepo(async ({ repo, kind }) => {
		const created = await repo.create(
			sampleCreate({
				credentialId: new Uint8Array([92, 1, kind === "memory" ? 1 : 2]),
				name: "before",
			}),
		);
		assert.ok(
			created.updatedAt instanceof Date,
			`${kind}: create must populate updatedAt from column/DEFAULT`,
		);
		const cas = await repo.updateCounter({
			credentialId: created.credentialId,
			expected: created.counter,
			next: created.counter + 1n,
		});
		assert.ok(cas.updatedAt instanceof Date);
		assert.equal(cas.updatedAt === null, false);
		const renamed = await repo.updateName({
			id: created.id,
			name: "after",
			userId: created.userId,
		});
		assert.ok(renamed.updatedAt instanceof Date);
		assert.equal(renamed.name, "after");
	});
});

test("T-REPO-FAIL-CLOSED: passkeys:false; six remaining missing routes; construct throw; 005 checksum; public eight methods", () => {
	assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
	assert.equal(
		readPkg("src/auth/capabilities.ts").includes("passkeyEnabled"),
		true,
	);
	assert.deepEqual(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.social, {
		providers: [],
	});

	const listed = inventoryKnownMissing();
	for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
		assert.equal(
			listed.includes(`"${route}"`),
			false,
			`KNOWN_MISSING_IN_LOCAL must not list served ${route}`,
		);
	}

	assert.throws(
		() =>
			createClient({
				auth: { passkeys: true } as never,
				databaseUrl: SAMPLE_PG,
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED",
	);

	assert.equal(CANONICAL_PASSKEY_METHODS.length, 8);
	const auth = createAuthModule({
		capabilities: ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
	}).auth;
	assert.deepEqual(
		Object.keys(auth.passkey).sort(),
		[...CANONICAL_PASSKEY_METHODS, "register", "signIn"].sort(),
	);

	assert.equal(
		(committedManifest as Record<string, string>)["005"],
		JS_005_CHECKSUM,
	);
	assert.equal(getAthenaAuthSchemaManifest()["005"], JS_005_CHECKSUM);
});

test("T-REPO-NO-CEREMONY: no generate/verify wiring; engine not wired; no JWT/Social; challenge-store unchanged", () => {
	const { repoSrc, indexSrc } = requireAdapterSources();
	assert.equal(
		/generateRegistrationOptions|verifyRegistrationResponse|@simplewebauthn/.test(
			repoSrc,
		),
		false,
		"repository adapter must not implement WebAuthn generate/verify",
	);
	assert.equal(
		/\bjwt\b|jsonwebtoken|createOAuth|social-oauth/i.test(
			`${repoSrc}\n${indexSrc}`,
		),
		false,
		"repository slice must not add JWT or Social OAuth",
	);

	assert.throws(
		() =>
			createAthenaPasskeyServerEngine({
				audit: {} as never,
				challenges: {} as never,
				clock: {} as never,
				credentials: {} as never,
				sessions: {} as never,
			}).startRegistration({} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);

	const moduleSrc = readPkg("src/auth/passkey/client-module.ts");
	assert.equal(
		/createAthenaPasskeyServerEngine|passkey\/server/.test(moduleSrc),
		false,
		"createPasskeyModule must not import or call the local server engine",
	);

	assert.equal(existsSync(challengeStorePath), true);
	const challengeSrc = readFileSync(challengeStorePath, "utf8");
	assert.match(challengeSrc, /consumeVerificationByIdentifierAndValue/);
	assert.equal(
		/\bconsumed_at\b/.test(challengeSrc),
		false,
		"challenge-store must stay consume-by-DELETE (no consumed_at)",
	);
	assert.equal(
		/INSERT\s+INTO\s+(?:athena\.passkeys|\$\{ATHENA_AUTH_TABLES\.passkeys\})/i.test(
			challengeSrc,
		),
		false,
		"must not rewrite challenge-store to CRUD athena.passkeys",
	);
});
