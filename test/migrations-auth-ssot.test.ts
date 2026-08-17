import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { usage } from "../src/cli/index.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import type {
  AppliedMigration,
  AppliedMigrationResult,
  MigrationBackend,
  MigrationFile,
} from "../src/migrations/types.ts";

class MemoryBackend implements MigrationBackend {
  readonly kind = "memory";
  private readonly rows: AppliedMigration[];

  constructor(rows: AppliedMigration[] = []) {
    this.rows = [...rows];
  }

  async acquireLock(): Promise<void> {}
  async releaseLock(): Promise<void> {}
  async ensureLedger(): Promise<void> {}
  async listAppliedMigrations(): Promise<AppliedMigration[]> {
    return [...this.rows];
  }
  async applyMigration(migration: MigrationFile): Promise<AppliedMigrationResult> {
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

function writeProject(root: string): void {
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
  mkdirSync(join(root, "athena", "migrations"), { recursive: true });
}

test("T-migrate-auth: migrate help names Auth schema", () => {
  const text = usage("migrate");
  assert.match(text, /embedded Auth|Auth schema/i);
});

test("T-migrate-auth: migrate plan lists Auth ledger names", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-auth-"));
  const logs: string[] = [];
  try {
    writeProject(root);
    await runMigrations({
      createBackend: async () => new MemoryBackend(),
      cwd: root,
      log: (message) => {
        logs.push(message);
      },
      mode: "plan",
    });
    const output = logs.join("\n");
    assert.match(output, /021_runtime_key_and_ledger/);
    assert.match(output, /Auth/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
