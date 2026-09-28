import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadStaticCliProject } from "../src/cli/project/load-project.ts";
import type { AthenaConfig } from "../src/generator/types.ts";
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

  async inspectCatalog() {
    const { emptyPhysicalCatalog } = await import(
      "../src/migrations/analysis/catalog.ts"
    );
    return emptyPhysicalCatalog();
  }

  async applyMigration(
    migration: MigrationFile
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
    "utf8"
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
      createBackend: async () => backend,
      cwd: root,
      dryRun: true,
      log: (line) => logs.push(line),
      mode: "dry-run",
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
          l.includes("0001_initial.sql")
      ),
      true
    );
    assert.equal(
      logs.some(
        (l) =>
          l.includes("No database changes were made") ||
          l.includes("pending application migration")
      ),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runMigrations accepts a providerless config with an explicit database URL", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-local-config-"));
  const backend = new MemoryBackend();
  try {
    const migrations = join(root, "athena", "migrations");
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, "0001_initial.sql"), "SELECT 1;\n", "utf8");
    const config: AthenaConfig = {
      local: { port: 55_432 },
      migrations: { directory: "./athena/migrations" },
    };
    const summary = await runMigrations({
      config,
      createBackend: async () => backend,
      cwd: root,
      databaseUrl: "postgres://postgres:secret@127.0.0.1:55432/app",
      dryRun: true,
      mode: "dry-run",
    });
    assert.equal(summary.pendingCount, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("explicit databaseUrl overrides a staged direct provider before normalization", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-explicit-url-"));
  try {
    const migrations = join(root, "athena", "migrations");
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, "0001_initial.sql"), "SELECT 1;\n", "utf8");
    writeFileSync(
      join(root, "athena.config.ts"),
      `
export default {
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: process.env.ATHENA_MIGRATION_TEST_URL,
  },
  migrations: { directory: "./athena/migrations" },
};
`,
      "utf8"
    );
    writeFileSync(join(root, ".env"), "ATHENA_MIGRATION_TEST_URL=\n", "utf8");

    const staticProject = await loadStaticCliProject({ cwd: root });
    assert.equal(staticProject.athena.config.provider?.connectionString, "");

    const explicitUrl = "postgres://127.0.0.1:55432/local_app";
    const seenConnections: string[] = [];
    for (const options of [
      { config: staticProject.athena.config },
      { configPath: "athena.config.ts" },
    ]) {
      const backend = new MemoryBackend();
      await runMigrations({
        ...options,
        createBackend: async ({ connectionString }) => {
          seenConnections.push(connectionString);
          return backend;
        },
        cwd: root,
        databaseUrl: explicitUrl,
        dryRun: true,
        mode: "dry-run",
      });
    }

    assert.deepEqual(seenConnections, [explicitUrl, explicitUrl]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("explicit databaseUrl bypasses malformed configured provider fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-explicit-invalid-provider-"));
  try {
    const migrations = join(root, "athena", "migrations");
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, "0001_initial.sql"), "SELECT 1;\n", "utf8");
    const config: AthenaConfig = {
      migrations: { directory: "./athena/migrations" },
      provider: {
        connectionString: "",
        kind: "postgres",
        mode: "direct",
        schemas: {} as never,
      },
    };
    const explicitUrl = "postgres://127.0.0.1:55432/local_app";
    const summary = await runMigrations({
      config,
      createBackend: async ({ connectionString }) => {
        assert.equal(connectionString, explicitUrl);
        return new MemoryBackend();
      },
      cwd: root,
      databaseUrl: explicitUrl,
      dryRun: true,
      mode: "dry-run",
    });
    assert.equal(summary.pendingCount, 1);
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
        createBackend: async () => backend,
        cwd: root,
        log: () => undefined,
        mode,
      });
      assert.equal(summary.pendingCount, 1);
      assert.equal(backend.ensureLedgerCount, 0);
      assert.equal(backend.lockCount, 0);
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
          createBackend: async () => backend,
          cwd: root,
          log: () => undefined,
          mode: "apply",
        }),
      (error: unknown) => {
        assert.ok(error instanceof MigrationError);
        return true;
      }
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
          createBackend: async () => backend,
          cwd: root,
          log: () => undefined,
          mode: "apply",
        }),
      /Migration integrity error|checksum/i
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
      "utf8"
    );
    await assert.rejects(
      () =>
        runMigrations({
          createBackend: async () => new MemoryBackend(),
          cwd: root,
          log: () => undefined,
          mode: "status",
        }),
      /Gateway-backed migration execution is not yet supported/
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
      createBackend: async () => backend,
      cwd: root,
      log: () => undefined,
      mode: "apply",
    });
    assert.equal(summary.pendingCount, 0);
    assert.equal(summary.newlyApplied.length, 0);
    assert.equal(backend.appliedSql.length, 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("migrate status warns on unknown Auth generations; check and drift fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-unknown-auth-"));
  const unknownPlan = {
    appliedCount: 1,
    conflictCount: 1,
    driftCount: 0,
    entries: [
      {
        action: "none" as const,
        checksum: "abc",
        ledgerState: "applied" as const,
        name: "021_runtime_key_and_ledger",
        repairability: "idempotent" as const,
        schemaState: "healthy" as const,
        version: 21,
      },
      {
        action: "blocked" as const,
        checksum: "",
        ledgerState: "unknown" as const,
        name: "099_future_generation",
        repairability: "manual" as const,
        schemaState: "unknown" as const,
        version: 99,
      },
    ],
    hasBlockingDrift: false,
    health: "FUTURE_GENERATION" as const,
    pendingCount: 0,
  };
  try {
    writeProject(root, {});
    const status = await runMigrations({
      createBackend: async () => new MemoryBackend(),
      cwd: root,
      log: () => undefined,
      mode: "status",
      planAuthSchema: async () => unknownPlan,
    });
    assert.equal(
      status.diagnostics?.some(
        (item) => item.code === "ATHENA_AUTH_LEDGER_UNKNOWN"
      ),
      true
    );

    await assert.rejects(
      () =>
        runMigrations({
          createBackend: async () => new MemoryBackend(),
          cwd: root,
          log: () => undefined,
          mode: "check",
          planAuthSchema: async () => unknownPlan,
        }),
      (error: unknown) =>
        error instanceof MigrationError &&
        error.code === "HISTORY" &&
        /does not know/i.test(error.message)
    );
    await assert.rejects(
      () =>
        runMigrations({
          createBackend: async () => new MemoryBackend(),
          cwd: root,
          log: () => undefined,
          mode: "drift",
          planAuthSchema: async () => unknownPlan,
        }),
      /ATHENA_AUTH_LEDGER_UNKNOWN|does not know/i
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("migrate status fails closed when Embedded Auth is unreachable", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-auth-down-"));
  try {
    writeProject(root, { "0001_initial.sql": "SELECT 1;\n" });
    const refused = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      { code: "ECONNREFUSED" }
    );
    await assert.rejects(
      () =>
        runMigrations({
          createAuthDatabase: async () => {
            throw refused;
          },
          createBackend: async () => new MemoryBackend(),
          cwd: root,
          log: () => undefined,
          mode: "status",
        }),
      /ATHENA_AUTH_LEDGER_UNREACHABLE/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
