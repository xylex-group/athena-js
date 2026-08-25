import assert from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_MIGRATION_ADVISORY_LOCK } from "../src/auth/contract/index.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { classifyAuthLedgerQueryError } from "../src/auth/local/ledger-health.ts";
import {
	planAthenaAuthSchema,
	withAthenaAuthMigrationLock,
} from "../src/auth/local/schema.ts";
import {
	ATHENA_MIGRATION_LOCK_KEY1,
	ATHENA_MIGRATION_LOCK_KEY2,
} from "../src/migrations/postgres.ts";

test("missing auth ledger table is UNINITIALIZED, not unreachable", () => {
	assert.equal(
		classifyAuthLedgerQueryError(
			new Error('relation "athena.auth_schema_migrations" does not exist'),
		),
		"UNINITIALIZED",
	);
	assert.equal(
		classifyAuthLedgerQueryError({ code: "42P01", message: "undefined_table" }),
		"UNINITIALIZED",
	);
});

test("connection and privilege failures are not UNINITIALIZED", () => {
	const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
		code: "ECONNREFUSED",
	});
	assert.equal(classifyAuthLedgerQueryError(refused), "UNREACHABLE");
	assert.equal(
		classifyAuthLedgerQueryError({ code: "42501", message: "permission denied" }),
		"PERMISSION_DENIED",
	);
	assert.equal(
		classifyAuthLedgerQueryError(
			new AthenaAuthRuntimeError(500, "bad adapter", {
				code: "ATHENA_AUTH_DATABASE_RESULT_INVALID",
			}),
		),
		"INVALID_LEDGER",
	);
});

test("planAthenaAuthSchema fails closed on unreachable ledger reads", async () => {
	const refused = Object.assign(new Error("connect ECONNREFUSED"), {
		code: "ECONNREFUSED",
	});
	const database: AthenaAuthDatabase = {
		async close() {},
		async query() {
			throw refused;
		},
		async transaction(fn) {
			return fn(this);
		},
	};
	await assert.rejects(
		() => planAthenaAuthSchema(database),
		(error: unknown) =>
			error instanceof AthenaAuthRuntimeError &&
			error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE",
	);
});

test("planAthenaAuthSchema treats a missing ledger table as uninitialized pending history", async () => {
	const database: AthenaAuthDatabase = {
		async close() {},
		async query() {
			throw new Error('relation "athena.auth_schema_migrations" does not exist');
		},
		async transaction(fn) {
			return fn(this);
		},
	};
	const plan = await planAthenaAuthSchema(database, { inspectSchema: false });
	assert.equal(plan.health, "UNINITIALIZED");
	assert.ok(plan.pendingCount > 0);
	assert.equal(plan.conflictCount, 0);
});

test("Embedded Auth migration lock is independent of application ATHA/MIGS", async () => {
	assert.notEqual(ATHENA_AUTH_MIGRATION_ADVISORY_LOCK, ATHENA_MIGRATION_LOCK_KEY1);
	assert.notEqual(ATHENA_AUTH_MIGRATION_ADVISORY_LOCK, ATHENA_MIGRATION_LOCK_KEY2);

	const queries: Array<{ text: string; values?: unknown[] }> = [];
	const database: AthenaAuthDatabase = {
		async close() {},
		async query<T = Record<string, unknown>>(
			text: string,
			values?: unknown[],
		) {
			queries.push({ text, values });
			return { rowCount: 1, rows: [{ acquired: true }] as T[] };
		},
		async transaction(fn) {
			return fn(this);
		},
	};
	const result = await withAthenaAuthMigrationLock(database, async () => "locked");
	assert.equal(result, "locked");
	assert.ok(
		queries.some(
			(item) =>
				/pg_advisory_lock\(/.test(item.text) &&
				item.values?.[0] === ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
		),
	);
	assert.ok(queries.some((item) => /pg_advisory_unlock\(/.test(item.text)));
});
