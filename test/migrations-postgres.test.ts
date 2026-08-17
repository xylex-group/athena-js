import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import {
	ATHENA_MIGRATION_LOCK_KEY1,
	ATHENA_MIGRATION_LOCK_KEY2,
	applyDatabaseToConnectionString,
	buildPostgresMigrationPoolOptions,
	PostgresMigrationBackend,
} from "../src/migrations/postgres.ts";
import type { MigrationFile } from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";
import type {
	AthenaPostgresClient,
	AthenaPostgresPool,
	QueryResult,
	QueryResultRow,
} from "../src/postgres/driver.ts";

function emptyResult<T extends QueryResultRow>(): QueryResult<T> {
	return {
		command: "SELECT",
		fields: [],
		oid: 0,
		rowCount: 0,
		rows: [],
	};
}

class FakeClient implements AthenaPostgresClient {
	readonly queries: Array<{ text: string; values?: unknown[] }> = [];
	failOnSqlIncludes: string | undefined;
	released = false;

	async query<T extends QueryResultRow = QueryResultRow>(
		text: string,
		values?: unknown[],
	): Promise<QueryResult<T>> {
		this.queries.push({ text, values });
		if (this.failOnSqlIncludes && text.includes(this.failOnSqlIncludes)) {
			throw new Error('relation "forms.forms" does not exist');
		}
		return emptyResult<T>();
	}

	release(): void {
		this.released = true;
	}
}

class FakePool implements AthenaPostgresPool {
	readonly client = new FakeClient();
	ended = false;

	async connect(): Promise<AthenaPostgresClient> {
		return this.client;
	}

	async end(): Promise<void> {
		this.ended = true;
	}

	async query<T extends QueryResultRow = QueryResultRow>(
		text: string,
		values?: unknown[],
	): Promise<QueryResult<T>> {
		return this.client.query(text, values);
	}
}

function migration(version: number, sql: string): MigrationFile {
	return {
		checksum: checksumMigrationSql(sql),
		filename: `${String(version).padStart(4, "0")}_m.sql`,
		name: "m",
		path: `/tmp/${version}.sql`,
		sql,
		version,
	};
}

test("postgres backend lock keys are stable", () => {
	assert.equal(ATHENA_MIGRATION_LOCK_KEY1, 0x41_54_48_41);
	assert.equal(ATHENA_MIGRATION_LOCK_KEY2, 0x4d_49_47_53);
});

test("applyDatabaseToConnectionString uses configured database when URL omits or differs", () => {
	assert.equal(
		applyDatabaseToConnectionString("postgres://localhost:5432/", "formations"),
		"postgres://localhost:5432/formations",
	);
	assert.equal(
		applyDatabaseToConnectionString(
			"postgres://localhost:5432/other",
			"formations",
		),
		"postgres://localhost:5432/formations",
	);
	assert.equal(
		applyDatabaseToConnectionString(
			"postgresql://localhost:5432/formations",
			"formations",
		),
		"postgresql://localhost:5432/formations",
	);
	assert.equal(
		applyDatabaseToConnectionString("postgres://localhost:5432/app", undefined),
		"postgres://localhost:5432/app",
	);
});

test("buildPostgresMigrationPoolOptions forwards database into pool config", () => {
	const options = buildPostgresMigrationPoolOptions(
		"postgres://localhost:5432/",
		"formations",
	);
	assert.equal(
		options.connectionString,
		"postgres://localhost:5432/formations",
	);
	assert.deepEqual(options.poolConfig, { database: "formations" });

	const withoutDb = buildPostgresMigrationPoolOptions(
		"postgres://localhost:5432/app",
	);
	assert.equal(withoutDb.connectionString, "postgres://localhost:5432/app");
	assert.deepEqual(withoutDb.poolConfig, {});
});

test("listAppliedMigrations treats missing ledger as empty", async () => {
	class MissingLedgerClient implements AthenaPostgresClient {
		async query<T extends QueryResultRow = QueryResultRow>(): Promise<
			QueryResult<T>
		> {
			const error = new Error(
				'relation "athena.schema_migrations" does not exist',
			) as Error & { code?: string };
			error.code = "42P01";
			throw error;
		}
		release(): void {
			// no-op
		}
	}

	class MissingLedgerPool implements AthenaPostgresPool {
		async connect() {
			return new MissingLedgerClient();
		}
		async end() {
			// no-op
		}
		async query<T extends QueryResultRow = QueryResultRow>() {
			return emptyResult<T>();
		}
	}

	const backend = new PostgresMigrationBackend({
		connectionString: "postgres://localhost/app",
		pool: new MissingLedgerPool(),
	});
	const applied = await backend.listAppliedMigrations();
	assert.deepEqual(applied, []);
	await backend.close();
});

test("postgres backend bootstraps ledger, locks, applies, and unlocks", async () => {
	const pool = new FakePool();
	const backend = new PostgresMigrationBackend({
		connectionString: "postgres://localhost/app",
		pool,
	});

	await backend.acquireLock();
	await backend.ensureLedger();
	const applied = await backend.listAppliedMigrations();
	assert.deepEqual(applied, []);

	const result = await backend.applyMigration(
		migration(1, "CREATE TABLE t(id int);"),
	);
	assert.equal(result.version, 1);
	assert.ok(result.executionMs >= 0);

	await backend.close();

	const texts = pool.client.queries.map((q) => q.text);
	assert.equal(
		texts.some((t) => t.includes("pg_advisory_lock")),
		true,
	);
	assert.equal(
		texts.some((t) =>
			t.includes("CREATE TABLE IF NOT EXISTS athena.schema_migrations"),
		),
		true,
	);
	assert.equal(texts.includes("BEGIN"), true);
	assert.equal(texts.includes("COMMIT"), true);
	assert.equal(
		texts.some((t) => t.includes("INSERT INTO athena.schema_migrations")),
		true,
	);
	assert.equal(
		texts.some((t) => t.includes("pg_advisory_unlock")),
		true,
	);
	assert.equal(pool.client.released, true);
	assert.equal(pool.ended, false); // pool was injected, backend must not end it
});

test("postgres backend rolls back on SQL failure and does not commit ledger", async () => {
	const pool = new FakePool();
	pool.client.failOnSqlIncludes = "BOOM";
	const backend = new PostgresMigrationBackend({
		connectionString: "postgres://localhost/app",
		pool,
	});

	await backend.acquireLock();
	await assert.rejects(
		() => backend.applyMigration(migration(2, "SELECT BOOM;")),
		(error: unknown) => {
			assert.ok(error instanceof MigrationError);
			assert.equal(error.code, "EXECUTION");
			assert.match(error.message, /Migration failed/);
			assert.match(error.message, /rolled back/);
			return true;
		},
	);

	const texts = pool.client.queries.map((q) => q.text);
	assert.equal(texts.includes("ROLLBACK"), true);
	assert.equal(texts.includes("COMMIT"), false);
	assert.equal(
		texts.some((t) => t.includes("INSERT INTO athena.schema_migrations")),
		false,
	);

	await backend.close();
	assert.equal(pool.client.released, true);
});

test("postgres backend releases lock on close after failure path", async () => {
	const pool = new FakePool();
	const backend = new PostgresMigrationBackend({
		connectionString: "postgres://localhost/app",
		pool,
	});
	await backend.acquireLock();
	pool.client.failOnSqlIncludes = "x";
	await assert.rejects(() => backend.applyMigration(migration(3, "SELECT x;")));
	await backend.close();
	assert.equal(
		pool.client.queries.some((q) => q.text.includes("pg_advisory_unlock")),
		true,
	);
});
