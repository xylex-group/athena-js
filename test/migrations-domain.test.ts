import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import {
	DEFAULT_MIGRATIONS_DIRECTORY,
	discoverMigrations,
	parseMigrationFilename,
} from "../src/migrations/discovery.ts";
import { planMigrations } from "../src/migrations/planner.ts";
import type {
	AppliedMigration,
	MigrationFile,
} from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";

function file(
	partial: Partial<MigrationFile> &
		Pick<MigrationFile, "version" | "name" | "filename">,
): MigrationFile {
	const sql = partial.sql ?? `SELECT ${partial.version};`;
	return {
		checksum: partial.checksum ?? checksumMigrationSql(sql),
		name: partial.name,
		filename: partial.filename,
		path: partial.path ?? `/tmp/${partial.filename}`,
		sql,
		version: partial.version,
	};
}

function applied(
	partial: Partial<AppliedMigration> &
		Pick<AppliedMigration, "version" | "name" | "checksum">,
): AppliedMigration {
	return {
		appliedAt: partial.appliedAt ?? new Date("2026-01-01T00:00:00.000Z"),
		checksum: partial.checksum,
		executionMs: partial.executionMs ?? 1,
		name: partial.name,
		version: partial.version,
	};
}

test("DEFAULT_MIGRATIONS_DIRECTORY is athena/migrations", () => {
	assert.equal(DEFAULT_MIGRATIONS_DIRECTORY, "athena/migrations");
});

test("parseMigrationFilename accepts multi-digit versions", () => {
	assert.deepEqual(parseMigrationFilename("0001_initial.sql"), {
		name: "initial",
		version: 1,
	});
	assert.deepEqual(parseMigrationFilename("12_add_users.sql"), {
		name: "add_users",
		version: 12,
	});
	assert.deepEqual(parseMigrationFilename("10001_big.sql"), {
		name: "big",
		version: 10_001,
	});
	assert.equal(parseMigrationFilename("initial.sql"), undefined);
	assert.equal(parseMigrationFilename("0001.sql"), undefined);
});

test("checksumMigrationSql is deterministic and content-sensitive", () => {
	const a = checksumMigrationSql("CREATE TABLE t (id int);\n");
	const b = checksumMigrationSql("CREATE TABLE t (id int);\n");
	const c = checksumMigrationSql("CREATE TABLE t (id int);\r\n");
	assert.equal(a, b);
	assert.notEqual(a, c);
	assert.match(a, /^[a-f0-9]{64}$/);
});

test("discoverMigrations loads ordered files and ignores incidental non-sql", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-disc-"));
	try {
		const dir = join(root, "athena", "migrations");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "README.md"), "# hi\n", "utf8");
		writeFileSync(join(dir, ".gitkeep"), "", "utf8");
		writeFileSync(join(dir, "0002_second.sql"), "SELECT 2;\n", "utf8");
		writeFileSync(join(dir, "0001_first.sql"), "SELECT 1;\n", "utf8");
		writeFileSync(join(dir, "0005_gapped.sql"), "SELECT 5;\n", "utf8");

		const migrations = await discoverMigrations({
			cwd: root,
			directory: "athena/migrations",
		});
		assert.equal(migrations.length, 3);
		assert.deepEqual(
			migrations.map((m) => m.filename),
			["0001_first.sql", "0002_second.sql", "0005_gapped.sql"],
		);
		assert.equal(migrations[0]?.version, 1);
		assert.equal(migrations[0]?.checksum, checksumMigrationSql("SELECT 1;\n"));
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("discoverMigrations returns empty for missing directory", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-missing-"));
	try {
		const migrations = await discoverMigrations({
			cwd: root,
			directory: "athena/migrations",
		});
		assert.deepEqual(migrations, []);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("discoverMigrations rejects malformed sql filenames", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-bad-"));
	try {
		const dir = join(root, "athena", "migrations");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "not_a_migration.sql"), "SELECT 1;\n", "utf8");
		await assert.rejects(
			() => discoverMigrations({ cwd: root, directory: "athena/migrations" }),
			(error: unknown) => {
				assert.ok(error instanceof MigrationError);
				assert.equal(error.code, "DISCOVERY");
				assert.match(error.message, /Malformed migration filename/);
				assert.match(error.message, /not_a_migration\.sql/);
				return true;
			},
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("discoverMigrations rejects duplicate versions", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-dup-"));
	try {
		const dir = join(root, "migs");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "0003_users.sql"), "SELECT 1;\n", "utf8");
		writeFileSync(join(dir, "0003_orders.sql"), "SELECT 2;\n", "utf8");
		await assert.rejects(
			() => discoverMigrations({ cwd: root, directory: "migs" }),
			(error: unknown) => {
				assert.ok(error instanceof MigrationError);
				assert.match(error.message, /Duplicate migration version 0003/);
				assert.match(error.message, /0003_users\.sql/);
				assert.match(error.message, /0003_orders\.sql/);
				return true;
			},
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("planMigrations handles empty, pending, applied, mismatch, and db-ahead", () => {
	const local = [
		file({
			version: 1,
			name: "initial",
			filename: "0001_initial.sql",
			sql: "A",
		}),
		file({ version: 2, name: "next", filename: "0002_next.sql", sql: "B" }),
	];
	const initial = local[0];
	const next = local[1];
	assert.ok(initial);
	assert.ok(next);

	assert.deepEqual(planMigrations({ local: [], applied: [] }).pending, []);

	const allPending = planMigrations({ local, applied: [] });
	assert.equal(allPending.pending.length, 2);
	assert.equal(allPending.applied.length, 0);

	const allApplied = planMigrations({
		local,
		applied: [
			applied({ version: 1, name: "initial", checksum: initial.checksum }),
			applied({ version: 2, name: "next", checksum: next.checksum }),
		],
	});
	assert.equal(allApplied.pending.length, 0);
	assert.equal(allApplied.applied.length, 2);

	const somePending = planMigrations({
		local,
		applied: [
			applied({ version: 1, name: "initial", checksum: initial.checksum }),
		],
	});
	assert.equal(somePending.applied.length, 1);
	assert.equal(somePending.pending.length, 1);
	assert.equal(somePending.pending[0]?.migration.version, 2);

	const mismatch = planMigrations({
		local,
		applied: [
			applied({ version: 1, name: "initial", checksum: "deadbeef" }),
			applied({ version: 2, name: "next", checksum: next.checksum }),
		],
	});
	assert.equal(mismatch.conflicts.length, 1);
	assert.equal(mismatch.conflicts[0]?.kind, "checksum-mismatch");

	const ahead = planMigrations({
		local: [initial],
		applied: [
			applied({ version: 1, name: "initial", checksum: initial.checksum }),
			applied({
				version: 3,
				name: "add_index",
				checksum: checksumMigrationSql("C"),
			}),
		],
	});
	assert.equal(
		ahead.conflicts.some((c) => c.kind === "missing-local"),
		true,
	);
	assert.equal(
		ahead.conflicts.find((c) => c.kind === "missing-local")?.version,
		3,
	);
});
