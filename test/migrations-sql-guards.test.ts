import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverMigrations } from "../src/migrations/discovery.ts";
import {
	assertMigrationSqlAllowsOuterTransaction,
	findTransactionControlStatement,
	stripSqlCommentsAndLiterals,
} from "../src/migrations/sql-guards.ts";
import { MigrationError } from "../src/migrations/types.ts";
import { PostgresMigrationBackend } from "../src/migrations/postgres.ts";
import type {
	AthenaPostgresClient,
	AthenaPostgresPool,
	QueryResult,
	QueryResultRow,
} from "../src/postgres/driver.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";

test("stripSqlCommentsAndLiterals removes comments and quotes", () => {
	const sql = `
    -- COMMIT here
    SELECT 'COMMIT', $$ROLLBACK$$, $tag$BEGIN TRANSACTION$tag$;
    /* START TRANSACTION */
    CREATE TABLE t(id int);
  `;
	const stripped = stripSqlCommentsAndLiterals(sql);
	assert.equal(findTransactionControlStatement(stripped), undefined);
	assert.match(stripped, /CREATE TABLE/);
});

test("findTransactionControlStatement detects COMMIT and ROLLBACK", () => {
	assert.equal(findTransactionControlStatement("COMMIT;"), "COMMIT");
	assert.equal(
		findTransactionControlStatement("ROLLBACK WORK;"),
		"ROLLBACK WORK",
	);
	assert.equal(
		findTransactionControlStatement("START TRANSACTION;"),
		"START TRANSACTION",
	);
	assert.equal(
		findTransactionControlStatement("BEGIN TRANSACTION;"),
		"BEGIN TRANSACTION",
	);
	assert.equal(findTransactionControlStatement("ABORT;"), "ABORT");
});

test("PL/pgSQL BEGIN/END blocks are allowed", () => {
	const sql = `
CREATE FUNCTION foo() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1;
END;
$$;
`;
	assert.equal(findTransactionControlStatement(sql), undefined);
	assert.doesNotThrow(() => assertMigrationSqlAllowsOuterTransaction(sql));
});

test("assertMigrationSqlAllowsOuterTransaction fails closed", () => {
	assert.throws(
		() =>
			assertMigrationSqlAllowsOuterTransaction(
				"CREATE TABLE t(id int);\nCOMMIT;\n",
				"0001_bad.sql",
			),
		(error: unknown) => {
			assert.ok(error instanceof MigrationError);
			assert.match(error.message, /COMMIT/);
			assert.match(error.message, /0001_bad\.sql/);
			return true;
		},
	);
});

test("discoverMigrations rejects transaction control SQL", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-txn-"));
	try {
		const dir = join(root, "migs");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "0001_bad.sql"),
			"CREATE TABLE t(id int);\nCOMMIT;\n",
			"utf8",
		);
		await assert.rejects(
			() => discoverMigrations({ cwd: root, directory: "migs" }),
			/Transaction control statement COMMIT/,
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("applyMigration rejects transaction control before BEGIN", async () => {
	class TrackingClient implements AthenaPostgresClient {
		queries: string[] = [];
		async query<T extends QueryResultRow = QueryResultRow>(
			text: string,
		): Promise<QueryResult<T>> {
			this.queries.push(text);
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			};
		}
		release(): void {
			// no-op
		}
	}

	class TrackingPool implements AthenaPostgresPool {
		client = new TrackingClient();
		async connect() {
			return this.client;
		}
		async end() {
			// no-op
		}
		async query<T extends QueryResultRow = QueryResultRow>(text: string) {
			return this.client.query<T>(text);
		}
	}

	const pool = new TrackingPool();
	const backend = new PostgresMigrationBackend({
		connectionString: "postgres://localhost/app",
		pool,
	});
	const sql = "COMMIT;";
	await assert.rejects(
		() =>
			backend.applyMigration({
				checksum: checksumMigrationSql(sql),
				filename: "0009_bad.sql",
				name: "bad",
				path: "/tmp/0009_bad.sql",
				sql,
				version: 9,
			}),
		/Transaction control/,
	);
	assert.equal(pool.client.queries.length, 0);
	await backend.close();
});
