import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import type {
	AppliedMigration,
	AppliedMigrationResult,
	MigrationBackend,
	MigrationFile,
} from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";

class MemoryBackend implements MigrationBackend {
	readonly kind = "memory";
	lockCount = 0;
	unlockCount = 0;
	ensureLedgerCount = 0;
	closed = false;
	appliedSql: string[] = [];
	private rows: AppliedMigration[];

	constructor(rows: AppliedMigration[] = []) {
		this.rows = [...rows];
	}

	async acquireLock(): Promise<void> {
		this.lockCount += 1;
	}

	async releaseLock(): Promise<void> {
		this.unlockCount += 1;
	}

	async ensureLedger(): Promise<void> {
		this.ensureLedgerCount += 1;
	}

	async listAppliedMigrations(): Promise<AppliedMigration[]> {
		return [...this.rows];
	}

	async applyMigration(
		migration: MigrationFile,
	): Promise<AppliedMigrationResult> {
		if (migration.sql.includes("FAIL")) {
			throw new MigrationError("EXECUTION", "boom");
		}
		this.appliedSql.push(migration.sql);
		const row: AppliedMigrationResult = {
			appliedAt: new Date(),
			checksum: migration.checksum,
			executionMs: 5,
			filename: migration.filename,
			name: migration.name,
			version: migration.version,
		};
		this.rows.push(row);
		return row;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.releaseLock();
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
    schemas: ['public'],
  },
  migrations: {
    directory: './athena/migrations',
  },
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

test("runMigrations dry-run lists pending without applying", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-run-"));
	const backend = new MemoryBackend();
	try {
		writeProject(root, {
			"0001_initial.sql": "SELECT 1;\n",
			"0002_next.sql": "SELECT 2;\n",
		});
		const logs: string[] = [];
		const summary = await runMigrations({
			cwd: root,
			dryRun: true,
			mode: "dry-run",
			createBackend: async () => backend,
			log: (line) => logs.push(line),
		});
		assert.equal(summary.pendingCount, 2);
		assert.equal(backend.appliedSql.length, 0);
		assert.equal(backend.ensureLedgerCount, 0);
		assert.equal(backend.closed, true);
		assert.equal(
			logs.some(
				(l) =>
					l.includes("Pending migrations") ||
					l.includes("pending application migration") ||
					l.includes("0001_initial.sql"),
			),
			true,
		);
		assert.equal(
			logs.some(
				(l) =>
					l.includes("No database changes were made") ||
					l.includes("pending application migration"),
			),
			true,
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("status and plan do not bootstrap the ledger", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-inspect-"));
	try {
		writeProject(root, {
			"0001_initial.sql": "SELECT 1;\n",
		});

		for (const mode of ["status", "plan"] as const) {
			const backend = new MemoryBackend();
			const summary = await runMigrations({
				cwd: root,
				mode,
				createBackend: async () => backend,
				log: () => undefined,
			});
			assert.equal(summary.pendingCount, 1);
			assert.equal(backend.ensureLedgerCount, 0);
			assert.equal(backend.appliedSql.length, 0);
			assert.equal(backend.closed, true);
		}
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("runMigrations apply runs pending then stops after failure", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-apply-"));
	const backend = new MemoryBackend();
	try {
		writeProject(root, {
			"0001_ok.sql": "SELECT 1;\n",
			"0002_bad.sql": "SELECT FAIL;\n",
			"0003_never.sql": "SELECT 3;\n",
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
				return true;
			},
		);
		assert.deepEqual(backend.appliedSql, ["SELECT 1;\n"]);
		assert.equal(backend.closed, true);
		assert.equal(backend.lockCount, 1);
		assert.equal(backend.ensureLedgerCount, 1);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("runMigrations fails closed on checksum mismatch", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-checksum-"));
	const sql = "SELECT 1;\n";
	const backend = new MemoryBackend([
		{
			appliedAt: new Date(),
			checksum: "0".repeat(64),
			executionMs: 1,
			name: "initial",
			version: 1,
		},
	]);
	try {
		writeProject(root, { "0001_initial.sql": sql });
		await assert.rejects(
			() =>
				runMigrations({
					cwd: root,
					mode: "apply",
					createBackend: async () => backend,
					log: () => undefined,
				}),
			/Migration integrity error|checksum/i,
		);
		assert.equal(backend.appliedSql.length, 0);
		assert.equal(backend.closed, true);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("runMigrations rejects gateway provider", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-gw-"));
	try {
		writeFileSync(
			join(root, "athena.config.ts"),
			`
export default {
  provider: {
    kind: 'postgres',
    mode: 'gateway',
    gatewayUrl: 'https://example.com',
    apiKey: 'secret',
    database: 'app_db',
  },
}
`,
			"utf8",
		);
		await assert.rejects(
			() =>
				runMigrations({
					cwd: root,
					mode: "status",
					createBackend: async () => new MemoryBackend(),
					log: () => undefined,
				}),
			/Gateway-backed migration execution is not yet supported/,
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("normalize path uses checksum of exact local SQL for applied match", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-mig-match-"));
	const sql = "SELECT 42;\n";
	const backend = new MemoryBackend([
		{
			appliedAt: new Date(),
			checksum: checksumMigrationSql(sql),
			executionMs: 2,
			name: "initial",
			version: 1,
		},
	]);
	try {
		writeProject(root, { "0001_initial.sql": sql });
		const summary = await runMigrations({
			cwd: root,
			mode: "apply",
			createBackend: async () => backend,
			log: () => undefined,
		});
		assert.equal(summary.pendingCount, 0);
		assert.equal(summary.newlyApplied.length, 0);
		assert.equal(backend.appliedSql.length, 0);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
