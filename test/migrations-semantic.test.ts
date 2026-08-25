import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import {
	analyzeMigrationFile,
	compileMigrations,
	DIAGNOSTIC_CODES,
} from "../src/migrations/analysis/index.ts";
import { catalogToProjected } from "../src/migrations/analysis/projected-schema.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import type {
	AppliedMigration,
	AppliedMigrationResult,
	MigrationBackend,
	MigrationFile,
} from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";
import { emptyPhysicalCatalog } from "../src/migrations/analysis/catalog.ts";

const fixtures = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"migrations",
);

function file(version: number, filename: string, sql: string): MigrationFile {
	return {
		checksum: checksumMigrationSql(sql),
		filename,
		name: filename.replace(/^\d+_/, "").replace(/\.sql$/, ""),
		path: filename,
		sql,
		version,
	};
}

class MemoryBackend implements MigrationBackend {
	readonly kind = "memory";
	appliedSql: string[] = [];
	private readonly rows: AppliedMigration[];
	private readonly catalog;

	constructor(
		rows: AppliedMigration[] = [],
		catalog = emptyPhysicalCatalog(),
	) {
		this.rows = [...rows];
		this.catalog = catalog;
	}

	async acquireLock(): Promise<void> {}
	async releaseLock(): Promise<void> {}
	async ensureLedger(): Promise<void> {}
	async listAppliedMigrations(): Promise<AppliedMigration[]> {
		return [...this.rows];
	}
	async inspectCatalog() {
		return this.catalog;
	}
	async applyMigration(
		migration: MigrationFile,
	): Promise<AppliedMigrationResult> {
		this.appliedSql.push(migration.sql);
		const row: AppliedMigrationResult = {
			appliedAt: new Date(),
			checksum: migration.checksum,
			executionMs: 1,
			filename: migration.filename,
			name: migration.name,
			version: migration.version,
		};
		this.rows.push(row);
		return row;
	}
	async close(): Promise<void> {}
}

function writeProject(root: string, sqlFiles: Record<string, string>): void {
	writeFileSync(
		join(root, "athena.config.ts"),
		`
export default {
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: 'postgres://localhost/app_db',
    database: 'app_db',
    schemas: ['public', 'forms', 'athena'],
  },
  migrations: { directory: './athena/migrations' },
}
`,
		"utf8",
	);
	const dir = join(root, "athena", "migrations");
	mkdirSync(dir, { recursive: true });
	for (const [name, sql] of Object.entries(sqlFiles)) {
		writeFileSync(join(dir, name), sql, "utf8");
	}
}

const bootstrapSql = readFileSync(
	join(fixtures, "speedrun-0001-forms-bootstrap.sql"),
	"utf8",
);
const functionSql = readFileSync(
	join(fixtures, "speedrun-0007-admin-forms-records.sql"),
	"utf8",
);

test("function → table created earlier PASS", async () => {
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [
			file(1, "0001_forms_bootstrap.sql", bootstrapSql),
			file(7, "0007_athena_functions.sql", functionSql),
		],
	});
	assert.equal(
		result.diagnostics.filter((d) => d.classification !== "dynamic_sql").length,
		0,
	);
	assert.equal(
		result.analyses[1].dependencies.some(
			(d) =>
				d.object.kind === "table" &&
				d.object.schema === "forms" &&
				d.object.name === "forms",
		),
		true,
	);
});

test("function → table created later FAIL", async () => {
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [
			file(1, "0001_fn.sql", functionSql),
			file(2, "0002_table.sql", bootstrapSql),
		],
	});
	assert.ok(
		result.diagnostics.some(
			(d) =>
				d.classification === "ordering" &&
				d.object.kind === "table" &&
				d.object.name === "forms",
		),
	);
});

test("function → nonexistent table FAIL", async () => {
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [file(7, "0007_athena_functions.sql", functionSql)],
	});
	assert.ok(
		result.diagnostics.some(
			(d) =>
				d.code === DIAGNOSTIC_CODES.DEP_MISSING &&
				d.object.kind === "table" &&
				d.object.name === "forms",
		),
	);
});

test("function → existing table missing column FAIL", async () => {
	const sql = `
CREATE OR REPLACE FUNCTION public.admin_forms_records()
RETURNS TABLE (deleted_at text)
LANGUAGE sql AS $$
  SELECT f.deleted_at::text FROM forms.forms AS f;
$$;
`;
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [
			file(1, "0001_forms_bootstrap.sql", bootstrapSql),
			file(7, "0007_fn.sql", sql),
		],
	});
	assert.ok(
		result.diagnostics.some(
			(d) =>
				d.object.kind === "column" &&
				d.object.name === "deleted_at",
		),
	);
});

test("ledger applied + physical table missing is PHYSICAL_SCHEMA_DRIFT", async () => {
	const bootstrap = file(1, "0001_forms_bootstrap.sql", bootstrapSql);
	const fn = file(7, "0007_athena_functions.sql", functionSql);
	const result = await compileMigrations({
		appliedVersions: new Set([1]),
		catalog: emptyPhysicalCatalog(),
		files: [bootstrap, fn],
	});
	assert.ok(
		result.diagnostics.some(
			(d) =>
				d.classification === "physical_schema_drift" &&
				d.object.kind === "table" &&
				d.object.name === "forms" &&
				d.expectedProvider?.filename === "0001_forms_bootstrap.sql",
		),
	);
});

test("table created then dropped before function FAIL", async () => {
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [
			file(1, "0001_create.sql", bootstrapSql),
			file(2, "0002_drop.sql", "DROP TABLE forms.forms;\n"),
			file(3, "0003_fn.sql", functionSql),
		],
	});
	assert.ok(
		result.diagnostics.some(
			(d) => d.object.kind === "table" && d.object.name === "forms",
		),
	);
});

test("table created in same migration before function PASS", async () => {
	const sql = `${bootstrapSql}\n${functionSql}\n`;
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [file(1, "0001_together.sql", sql)],
	});
	assert.equal(
		result.diagnostics.filter((d) => d.classification !== "dynamic_sql")
			.length,
		0,
	);
});

test("table created after function in same migration FAIL", async () => {
	const sql = `${functionSql}\n${bootstrapSql}\n`;
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [file(1, "0001_wrong_order.sql", sql)],
	});
	assert.ok(result.diagnostics.length > 0);
});

test("quoted identifiers, CTE, JOIN, LATERAL parse", async () => {
	const sql = `
CREATE VIEW public.v AS
WITH x AS (SELECT 1 AS id)
SELECT q."id"
FROM x AS q
JOIN x AS r ON r.id = q.id
LEFT JOIN LATERAL (SELECT q.id) AS lat ON true;
`;
	const analysis = await analyzeMigrationFile(
		file(1, "0001_view.sql", sql),
	);
	assert.ok(analysis.statements.length >= 1);
});

test("dynamic EXECUTE is classified dynamic", async () => {
	const sql = `
CREATE FUNCTION public.execute_report(schema_name text, table_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('SELECT * FROM %I.%I', schema_name, table_name);
END;
$$;
`;
	const analysis = await analyzeMigrationFile(file(9, "0009_reporting.sql", sql));
	assert.ok(analysis.dependencies.some((d) => d.confidence === "dynamic"));
});

test("speedrun-formations incident: migrate apply does not execute 0007", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-sem-"));
	const catalog = {
		objects: [],
		schema: catalogToProjected([{ kind: "schema", name: "forms" }]),
	};
	const backend = new MemoryBackend(
		[
			{
				appliedAt: new Date("2026-08-17T13:30:49.765Z"),
				checksum: checksumMigrationSql(bootstrapSql),
				executionMs: 163,
				name: "forms_bootstrap",
				version: 1,
			},
		],
		catalog,
	);
	try {
		writeProject(root, {
			"0001_forms_bootstrap.sql": bootstrapSql,
			"0007_athena_functions.sql": functionSql,
		});
		await assert.rejects(
			() =>
				runMigrations({
					cwd: root,
					mode: "apply",
					createBackend: async () => backend,
					log: () => undefined,
				}),
			(error: unknown) => {
				assert.ok(error instanceof MigrationError);
				assert.equal(error.code, "SEMANTIC");
				assert.match(error.message, /forms\.forms/);
				assert.match(error.message, /physical/i);
				assert.match(error.message, /No migrations were executed/);
				return true;
			},
		);
		assert.deepEqual(backend.appliedSql, []);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("replay speedrun-formations bootstrap+function from empty projected state", async () => {
	const result = await compileMigrations({
		appliedVersions: new Set(),
		files: [
			file(1, "0001_forms_bootstrap.sql", bootstrapSql),
			file(3, "0003_deleted_at.sql", `
ALTER TABLE forms.forms
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone NULL;
`),
			file(7, "0007_athena_functions.sql", functionSql),
		],
	});
	assert.equal(
		result.diagnostics.filter((d) => d.classification !== "dynamic_sql").length,
		0,
	);
});
