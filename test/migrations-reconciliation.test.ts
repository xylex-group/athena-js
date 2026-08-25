import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeMigrationFile } from "../src/migrations/analysis/analyzer.ts";
import { catalogToProjected } from "../src/migrations/analysis/projected-schema.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import { parseCommand } from "../src/cli/index.ts";
import {
	isHighAutoRepair,
	reconcileVersion,
} from "../src/migrations/reconciliation/engine.ts";
import { assembleReconciliationReport } from "../src/migrations/reconciliation/assemble.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import type {
	AppliedMigration,
	AppliedMigrationResult,
	MigrationBackend,
	MigrationFile,
} from "../src/migrations/types.ts";
import type { ArchivedMigrationSource } from "../src/migrations/reconciliation/types.ts";
import { emptyPhysicalCatalog } from "../src/migrations/analysis/catalog.ts";
import type { PhysicalCatalog } from "../src/migrations/analysis/catalog.ts";

const FORMS_SQL = `
CREATE SCHEMA IF NOT EXISTS forms;
CREATE TABLE IF NOT EXISTS forms.forms (
  id uuid PRIMARY KEY,
  title text NOT NULL
);
`.trim();

const ORGS_SQL = `
CREATE SCHEMA IF NOT EXISTS organizations;
CREATE TABLE IF NOT EXISTS organizations.organizations (
  id uuid PRIMARY KEY
);
`.trim();

function file(
	version: number,
	filename: string,
	sql: string,
	committed = true,
): MigrationFile {
	return {
		checksum: checksumMigrationSql(sql),
		filename,
		name: filename.replace(/^\d+_/, "").replace(/\.sql$/, ""),
		path: filename,
		provenance: committed
			? {
					dirty: false,
					gitBlobSha: "blob-sha",
					headCommit: "abc123",
					relativePath: `athena/migrations/${filename}`,
					repositoryRoot: "/repo",
					tracked: true,
					vcs: "git",
				}
			: undefined,
		sql,
		version,
	};
}

function ledger(
	version: number,
	name: string,
	sql: string,
): AppliedMigration {
	return {
		appliedAt: new Date("2026-01-01T00:00:00Z"),
		checksum: checksumMigrationSql(sql),
		executionMs: 1,
		name,
		version,
	};
}

function archive(
	version: number,
	sql: string,
	sourcePath?: string,
): ArchivedMigrationSource {
	return {
		checksum: checksumMigrationSql(sql),
		sourcePath,
		sql,
		version,
	};
}

function physicalFromSqlCreates(
	...objects: Parameters<typeof catalogToProjected>[0]
): ReturnType<typeof catalogToProjected> {
	return catalogToProjected(objects);
}

class MemoryBackend implements MigrationBackend {
	readonly kind = "memory";
	appliedSql: string[] = [];
	repaired: Array<{ checksum: string; version: number }> = [];
	journals: unknown[] = [];
	private readonly rows: AppliedMigration[];
	private readonly archives: ArchivedMigrationSource[];
	private readonly catalog: PhysicalCatalog;

	constructor(input: {
		archives?: ArchivedMigrationSource[];
		catalog?: PhysicalCatalog;
		rows?: AppliedMigration[];
	} = {}) {
		this.rows = [...(input.rows ?? [])];
		this.archives = [...(input.archives ?? [])];
		this.catalog = input.catalog ?? emptyPhysicalCatalog();
	}

	async acquireLock(): Promise<void> {}
	async releaseLock(): Promise<void> {}
	async ensureLedger(): Promise<void> {}
	async listAppliedMigrations(): Promise<AppliedMigration[]> {
		return [...this.rows];
	}
	async listArchivedSources(): Promise<ArchivedMigrationSource[]> {
		return [...this.archives];
	}
	async inspectCatalog(): Promise<PhysicalCatalog> {
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
	async repairLedgerChecksum(version: number, checksum: string): Promise<void> {
		this.repaired.push({ version, checksum });
		const row = this.rows.find((item) => item.version === version);
		if (row) {
			row.checksum = checksum;
		}
	}
	async insertReconciliation(row: unknown): Promise<void> {
		this.journals.push(row);
	}
	async close(): Promise<void> {}
}

function gitInit(root: string): void {
	const run = (args: string[]) =>
		spawnSync("git", args, {
			cwd: root,
			encoding: "utf8",
			windowsHide: true,
		});
	run(["init"]);
	run(["config", "user.email", "reconcile@test"]);
	run(["config", "user.name", "Reconcile Test"]);
	run(["add", "-A"]);
	const commit = run(["commit", "-m", "init"]);
	if (commit.status !== 0) {
		throw new Error(commit.stderr || commit.stdout || "git commit failed");
	}
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
    schemas: ['public', 'forms', 'organizations', 'athena'],
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

test("parseCommand supports migrate reconcile --apply --json", () => {
	assert.deepEqual(parseCommand(["migrate", "reconcile"]), {
		command: "migrate",
		configPath: undefined,
		dryRun: false,
		explainTarget: undefined,
		json: false,
		plain: false,
		strict: false,
		allowDirty: false,
		applyReconcile: false,
		yes: false,
		mode: "reconcile",
	});
	assert.deepEqual(parseCommand(["migrate", "reconcile", "--apply", "--yes"]), {
		command: "migrate",
		configPath: undefined,
		dryRun: false,
		explainTarget: undefined,
		json: false,
		plain: false,
		strict: false,
		allowDirty: false,
		applyReconcile: true,
		yes: true,
		mode: "reconcile",
	});
	assert.equal(
		parseCommand(["migrate", "reconcile", "--json"]).command === "migrate" &&
			parseCommand(["migrate", "reconcile", "--json"]).json,
		true,
	);
	assert.throws(
		() => parseCommand(["migrate", "--apply"]),
		/Unexpected "--apply"/,
	);
	assert.throws(
		() => parseCommand(["migrate", "reconcile", "--dry-run"]),
		/--dry-run cannot be combined with migrate reconcile/,
	);
});

test("case 1: ledger wrong, repo + physical agree → HIGH repair-ledger", async () => {
	const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
	const analysis = await analyzeMigrationFile(repo);
	const diagnosis = reconcileVersion({
		laterDependenciesSatisfied: true,
		ledger: {
			checksum: checksumMigrationSql(ORGS_SQL),
			name: repo.name,
			version: 7,
		},
		physical: catalogToProjected(analysis.effects.creates),
		repository: {
			checksum: repo.checksum,
			committed: true,
			filename: repo.filename,
			name: repo.name,
			path: repo.path,
			sql: repo.sql,
			version: 7,
		},
		repositoryAnalysis: analysis,
	});
	assert.equal(diagnosis.classification, "LEDGER_SOURCE_DIVERGENCE");
	assert.equal(diagnosis.confidence, "HIGH");
	assert.equal(diagnosis.action.kind, "repair-ledger");
	assert.equal(isHighAutoRepair(diagnosis), true);
	if (diagnosis.action.kind === "repair-ledger") {
		assert.equal(diagnosis.action.fromChecksum, checksumMigrationSql(ORGS_SQL));
		assert.equal(diagnosis.action.toChecksum, repo.checksum);
	}
});

test("case 2: repo wrong, ledger + archived source agree → HIGH restore-local-source", async () => {
	const archived = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
	const archiveAnalysis = await analyzeMigrationFile(
		file(7, "0007_restore_forms_forms.sql", FORMS_SQL),
	);
	const repoFile = file(7, "0007_restore_forms_forms.sql", ORGS_SQL);
	const repoAnalysis = await analyzeMigrationFile(repoFile);
	const diagnosis = reconcileVersion({
		archive: archived,
		archiveAnalysis,
		laterDependenciesSatisfied: true,
		ledger: {
			checksum: archived.checksum,
			name: "restore_forms_forms",
			version: 7,
		},
		physical: catalogToProjected(archiveAnalysis.effects.creates),
		repository: {
			checksum: repoFile.checksum,
			committed: true,
			filename: repoFile.filename,
			name: repoFile.name,
			path: repoFile.path,
			sql: repoFile.sql,
			version: 7,
		},
		repositoryAnalysis: repoAnalysis,
	});
	assert.equal(diagnosis.classification, "SOURCE_DRIFT");
	assert.equal(diagnosis.confidence, "HIGH");
	assert.equal(diagnosis.action.kind, "restore-local-source");
	assert.equal(isHighAutoRepair(diagnosis), true);
});

test("case 3: physical wrong, repo + ledger agree → PHYSICAL_DRIFT forward repair, never rewrite history", async () => {
	const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
	const analysis = await analyzeMigrationFile(repo);
	const diagnosis = reconcileVersion({
		laterDependenciesSatisfied: true,
		ledger: {
			checksum: repo.checksum,
			name: repo.name,
			version: 7,
		},
		physical: physicalFromSqlCreates({ kind: "schema", name: "public" }),
		repository: {
			checksum: repo.checksum,
			committed: true,
			filename: repo.filename,
			name: repo.name,
			path: repo.path,
			sql: repo.sql,
			version: 7,
		},
		repositoryAnalysis: analysis,
	});
	assert.equal(diagnosis.classification, "PHYSICAL_DRIFT");
	assert.equal(diagnosis.confidence, "HIGH");
	assert.equal(diagnosis.action.kind, "create-forward-repair");
	assert.equal(isHighAutoRepair(diagnosis), false);
});

test("case 4: Git forms + ledger orgs + both objects exist → AMBIGUOUS refuse", async () => {
	const repoFile = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
	const repoAnalysis = await analyzeMigrationFile(repoFile);
	const archiveAnalysis = await analyzeMigrationFile(
		file(7, "0007_orgs.sql", ORGS_SQL),
	);
	const diagnosis = reconcileVersion({
		archive: archive(7, ORGS_SQL),
		archiveAnalysis,
		laterDependenciesSatisfied: true,
		ledger: {
			checksum: checksumMigrationSql(ORGS_SQL),
			name: "organizations",
			version: 7,
		},
		physical: catalogToProjected([
			...repoAnalysis.effects.creates,
			...archiveAnalysis.effects.creates,
		]),
		repository: {
			checksum: repoFile.checksum,
			committed: true,
			filename: repoFile.filename,
			name: repoFile.name,
			path: repoFile.path,
			sql: repoFile.sql,
			version: 7,
		},
		repositoryAnalysis: repoAnalysis,
	});
	assert.equal(diagnosis.classification, "AMBIGUOUS_HISTORY");
	assert.equal(diagnosis.confidence, "AMBIGUOUS");
	assert.equal(diagnosis.action.kind, "manual-review");
	assert.equal(isHighAutoRepair(diagnosis), false);
	assert.match(
		diagnosis.action.kind === "manual-review" ? diagnosis.action.reason : "",
		/Cannot determine which migration was actually executed/,
	);
	assert.match(
		diagnosis.action.kind === "manual-review" ? diagnosis.action.reason : "",
		/Automatic repair is unsafe/,
	);
});

test("uncommitted repository bytes are not HIGH auto-repair even when physical matches", async () => {
	const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL, false);
	const analysis = await analyzeMigrationFile(repo);
	const diagnosis = reconcileVersion({
		laterDependenciesSatisfied: true,
		ledger: {
			checksum: checksumMigrationSql(ORGS_SQL),
			name: repo.name,
			version: 7,
		},
		physical: catalogToProjected(analysis.effects.creates),
		repository: {
			checksum: repo.checksum,
			committed: false,
			filename: repo.filename,
			name: repo.name,
			path: repo.path,
			sql: repo.sql,
			version: 7,
		},
		repositoryAnalysis: analysis,
	});
	assert.equal(isHighAutoRepair(diagnosis), false);
	assert.equal(diagnosis.confidence, "AMBIGUOUS");
});

test("assembleReconciliationReport classifies case 1 from files + ledger + catalog", async () => {
	const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
	const analysis = await analyzeMigrationFile(repo);
	const report = await assembleReconciliationReport({
		analyses: [analysis],
		applied: [ledger(7, repo.name, ORGS_SQL)],
		archives: [],
		files: [repo],
		physical: catalogToProjected(analysis.effects.creates),
	});
	assert.equal(report.diagnoses[0]?.classification, "LEDGER_SOURCE_DIVERGENCE");
	assert.equal(report.autoEligibleCount, 1);
});

test("migrate reconcile diagnoses checksum mismatch without executing SQL", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-reconcile-"));
	const backend = new MemoryBackend({
		rows: [ledger(7, "restore_forms_forms", ORGS_SQL)],
		catalog: {
			objects: [],
			schema: catalogToProjected(
				(await analyzeMigrationFile(file(7, "0007_restore_forms_forms.sql", FORMS_SQL)))
					.effects.creates,
			),
		},
	});
	try {
		writeProject(root, { "0007_restore_forms_forms.sql": FORMS_SQL });
		const logs: string[] = [];
		const summary = await runMigrations({
			cwd: root,
			createBackend: async () => backend,
			log: (message) => {
				logs.push(message);
			},
			mode: "reconcile",
		});
		assert.equal(backend.appliedSql.length, 0);
		assert.ok(summary.reconciliation);
		assert.equal(
			logs.join("\n").includes("Migration SQL will NOT be executed"),
			true,
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("migrate reconcile --apply repairs HIGH ledger checksum and never runs migration SQL", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-reconcile-apply-"));
	const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
	const analysis = await analyzeMigrationFile(repo);
	const backend = new MemoryBackend({
		rows: [ledger(7, repo.name, ORGS_SQL)],
		catalog: {
			objects: analysis.effects.creates,
			schema: catalogToProjected(analysis.effects.creates),
		},
	});
	try {
		writeProject(root, { "0007_restore_forms_forms.sql": FORMS_SQL });
		gitInit(root);
		await runMigrations({
			applyReconcile: true,
			cwd: root,
			createBackend: async () => backend,
			mode: "reconcile",
			yes: true,
		});
		assert.equal(backend.appliedSql.length, 0);
		assert.equal(backend.repaired.length, 1);
		assert.equal(backend.repaired[0]?.checksum, repo.checksum);
		assert.equal(backend.journals.length, 1);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("migrate reconcile --apply restores archived SQL into the repository", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-reconcile-restore-"));
	const archived = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
	const archiveAnalysis = await analyzeMigrationFile(
		file(7, "0007_restore_forms_forms.sql", FORMS_SQL),
	);
	const backend = new MemoryBackend({
		archives: [archived],
		rows: [
			{
				appliedAt: new Date(),
				checksum: archived.checksum,
				executionMs: 1,
				name: "restore_forms_forms",
				version: 7,
			},
		],
		catalog: {
			objects: archiveAnalysis.effects.creates,
			schema: catalogToProjected(archiveAnalysis.effects.creates),
		},
	});
	try {
		writeProject(root, { "0007_restore_forms_forms.sql": ORGS_SQL });
		gitInit(root);
		await runMigrations({
			applyReconcile: true,
			cwd: root,
			createBackend: async () => backend,
			mode: "reconcile",
			yes: true,
		});
		assert.equal(backend.appliedSql.length, 0);
		assert.equal(
			readFileSync(
				join(root, "athena", "migrations", "0007_restore_forms_forms.sql"),
				"utf8",
			).trim(),
			FORMS_SQL,
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
