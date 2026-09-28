import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "./windows-defer-force-exit.mjs";
import {
  formatDirtyMigrationError,
  inspectDirtyMigrationWorktree,
  parseGitPorcelainLine,
} from "../src/migrations/git-worktree.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import {
  parsePorcelainV2,
  runGit,
} from "../src/migrations/source-control/git.ts";
import type {
  AppliedMigrationResult,
  MigrationBackend,
  MigrationFile,
} from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";

class MemoryBackend implements MigrationBackend {
  readonly kind = "memory";
  appliedSql: string[] = [];
  ensureLedgerCount = 0;

  async acquireLock(): Promise<void> {}
  async releaseLock(): Promise<void> {}
  async ensureLedger(): Promise<void> {
    this.ensureLedgerCount += 1;
  }
  async listAppliedMigrations() {
    return [];
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
    this.appliedSql.push(migration.sql);
    return {
      appliedAt: new Date(),
      checksum: migration.checksum,
      executionMs: 1,
      filename: migration.filename,
      name: migration.name,
      version: migration.version,
    };
  }
  async close(): Promise<void> {}
}

function writeProject(root: string, extraSql?: Record<string, string>): void {
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
  migrations: { directory: './athena/migrations' },
}
`,
    "utf8"
  );
  mkdirSync(join(root, "athena", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "athena", "migrations", "0001_initial.sql"),
    "SELECT 1;\n",
    "utf8"
  );
  if (extraSql) {
    for (const [name, sql] of Object.entries(extraSql)) {
      writeFileSync(join(root, "athena", "migrations", name), sql, "utf8");
    }
  }
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const n = 1;\n", "utf8");
}

function git(cwd: string, args: string[]): void {
  const command =
    args[0] === "commit"
      ? ["-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", ...args]
      : args;
  const result = runGit(cwd, command);
  assert.equal(
    result.status,
    0,
    `git ${command.join(" ")} failed: ${result.stderr || result.stdout}`
  );
}

function initRepo(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.email", "migrate@test.local"]);
  git(root, ["config", "user.name", "Migrate Test"]);
  git(root, [
    "add",
    "athena.config.ts",
    "athena/migrations/0001_initial.sql",
    "src/app.ts",
  ]);
  git(root, ["commit", "-m", "initial"]);
}

function removeTempRoot(root: string): void {
  rmSync(root, { force: true, maxRetries: 8, recursive: true, retryDelay: 25 });
}

test("parsePorcelainV2 maps machine-readable git status -z records", () => {
  const buffer = [
    "1 .M N... 100644 100644 100644 abc def ghi athena/migrations/0001_initial.sql",
    "? athena/migrations/0007_restore_forms_forms.sql",
    "2 R. N... 100644 100644 100644 abc def ghi R100 athena/migrations/0008_athena_functions.sql",
    "athena/migrations/0007_athena_functions.sql",
  ].join("\0");
  const records = parsePorcelainV2(`${buffer}\0`);
  assert.equal(records[0]?.kind, "ordinary");
  assert.equal(records[1]?.kind, "untracked");
  assert.equal(records[2]?.kind, "rename");
  assert.equal(
    records[2]?.origPath,
    "athena/migrations/0007_athena_functions.sql"
  );
});

test("parseGitPorcelainLine maps modify, untracked, delete, rename", () => {
  assert.deepEqual(
    parseGitPorcelainLine("M  athena/migrations/0007_athena_functions.sql"),
    {
      code: "M",
      path: "athena/migrations/0007_athena_functions.sql",
    }
  );
  assert.deepEqual(
    parseGitPorcelainLine("?? athena/migrations/0007_restore_forms_forms.sql"),
    {
      code: "??",
      path: "athena/migrations/0007_restore_forms_forms.sql",
    }
  );
  assert.deepEqual(
    parseGitPorcelainLine(" D athena/migrations/0003_form_deleted_at.sql"),
    {
      code: "D",
      path: "athena/migrations/0003_form_deleted_at.sql",
    }
  );
  assert.deepEqual(
    parseGitPorcelainLine(
      "R  athena/migrations/0007_athena_functions.sql -> athena/migrations/0008_athena_functions.sql"
    ),
    {
      code: "R",
      origPath: "athena/migrations/0007_athena_functions.sql",
      path: "athena/migrations/0008_athena_functions.sql",
    }
  );
});

test("dirty-tree error names the migration files", () => {
  const text = formatDirtyMigrationError({
    dirty: true,
    entries: [
      { code: "M", path: "athena/migrations/0007_athena_functions.sql" },
      { code: "??", path: "athena/migrations/0007_restore_forms_forms.sql" },
    ],
    inGitWorktree: true,
  });
  assert.match(text, /Migration safety check failed/);
  assert.match(text, /M athena\/migrations\/0007_athena_functions\.sql/);
  assert.match(text, /\?\? athena\/migrations\/0007_restore_forms_forms\.sql/);
  assert.match(text, /--allow-dirty-migrations/);
});

test("non-migration dirty files do not mark the worktree dirty for migrate", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-app-"));
  try {
    writeProject(root);
    initRepo(root);
    writeFileSync(join(root, "src", "app.ts"), "export const n = 2;\n", "utf8");
    const state = inspectDirtyMigrationWorktree({
      cwd: root,
      migrationsDirectory: "athena/migrations",
    });
    assert.equal(state.inGitWorktree, true);
    assert.equal(state.dirty, false);
    assert.deepEqual(state.entries, []);
  } finally {
    removeTempRoot(root);
  }
});

test("modified, untracked, deleted, and renamed migration files are dirty", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-mig-"));
  try {
    writeProject(root, { "0002_next.sql": "SELECT 2;\n" });
    initRepo(root);
    git(root, ["add", "athena/migrations/0002_next.sql"]);
    git(root, ["commit", "-m", "0002"]);

    writeFileSync(
      join(root, "athena", "migrations", "0001_initial.sql"),
      "SELECT 1; -- dirty\n",
      "utf8"
    );
    writeFileSync(
      join(root, "athena", "migrations", "0007_restore_forms_forms.sql"),
      "SELECT 7;\n",
      "utf8"
    );
    rmSync(join(root, "athena", "migrations", "0002_next.sql"));
    const state = inspectDirtyMigrationWorktree({
      cwd: root,
      migrationsDirectory: "athena/migrations",
    });
    assert.equal(state.dirty, true);
    const paths = state.entries.map((entry) => `${entry.code} ${entry.path}`);
    assert.ok(paths.some((line) => line.includes("0001_initial.sql")));
    assert.ok(
      paths.some((line) => line.includes("0007_restore_forms_forms.sql"))
    );
    assert.ok(paths.some((line) => line.includes("0002_next.sql")));
  } finally {
    removeTempRoot(root);
  }
});

test("renamed migration files are dirty", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-ren-"));
  try {
    writeProject(root, { "0002_next.sql": "SELECT 2;\n" });
    initRepo(root);
    git(root, ["add", "athena/migrations/0002_next.sql"]);
    git(root, ["commit", "-m", "0002"]);
    git(root, [
      "mv",
      "athena/migrations/0002_next.sql",
      "athena/migrations/0003_renamed.sql",
    ]);
    const state = inspectDirtyMigrationWorktree({
      cwd: root,
      migrationsDirectory: "athena/migrations",
    });
    assert.equal(state.dirty, true);
    assert.ok(
      state.entries.some(
        (entry) =>
          entry.path.includes("0003_renamed.sql") ||
          (entry.origPath ?? "").includes("0002_next.sql") ||
          entry.code.includes("R")
      )
    );
  } finally {
    removeTempRoot(root);
  }
});

test("dirty athena.config.ts is treated as migration-config drift", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-cfg-"));
  try {
    writeProject(root);
    initRepo(root);
    writeFileSync(
      join(root, "athena.config.ts"),
      `
export default {
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: 'postgres://localhost/other',
    database: 'other',
    schemas: ['public'],
  },
  migrations: { directory: './athena/migrations' },
}
`,
      "utf8"
    );
    const state = inspectDirtyMigrationWorktree({
      cwd: root,
      migrationsDirectory: "athena/migrations",
    });
    assert.equal(state.dirty, true);
    assert.ok(
      state.entries.some((entry) => entry.path.endsWith("athena.config.ts"))
    );
  } finally {
    removeTempRoot(root);
  }
});

test("apply fails closed on dirty migrations and does not touch the ledger", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-apply-"));
  const backend = new MemoryBackend();
  try {
    writeProject(root);
    initRepo(root);
    writeFileSync(
      join(root, "athena", "migrations", "0007_restore_forms_forms.sql"),
      "SELECT 7;\n",
      "utf8"
    );
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
        assert.equal(error.code, "INTEGRITY");
        assert.match(error.message, /0007_restore_forms_forms\.sql/);
        assert.match(error.message, /--allow-dirty-migrations/);
        return true;
      }
    );
    assert.equal(backend.ensureLedgerCount, 0);
    assert.deepEqual(backend.appliedSql, []);
  } finally {
    removeTempRoot(root);
  }
});

test("plan warns on dirty migrations but does not fail", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-plan-"));
  const warnings: string[] = [];
  try {
    writeProject(root);
    initRepo(root);
    writeFileSync(
      join(root, "athena", "migrations", "0001_initial.sql"),
      "SELECT 1; -- local\n",
      "utf8"
    );
    const summary = await runMigrations({
      createBackend: async () => new MemoryBackend(),
      cwd: root,
      log: (line) => warnings.push(line),
      mode: "plan",
    });
    assert.equal(summary.gitWorktree?.dirty, true);
    assert.ok(
      (summary.diagnostics ?? []).some(
        (item) => item.code === "ATHENA-MIG-GIT-001"
      )
    );
  } finally {
    removeTempRoot(root);
  }
});

test("apply --allow-dirty-migrations requires --yes off-TTY", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-git-allow-"));
  const backend = new MemoryBackend();
  try {
    writeProject(root);
    initRepo(root);
    writeFileSync(
      join(root, "athena", "migrations", "0002_next.sql"),
      "SELECT 2;\n",
      "utf8"
    );
    await assert.rejects(
      () =>
        runMigrations({
          allowDirtyMigrations: true,
          createBackend: async () => backend,
          cwd: root,
          log: () => undefined,
          mode: "apply",
        }),
      /allow-dirty-migrations --yes/
    );
    assert.deepEqual(backend.appliedSql, []);
    const summary = await runMigrations({
      allowDirtyMigrations: true,
      createBackend: async () => backend,
      cwd: root,
      log: () => undefined,
      mode: "apply",
      yes: true,
    });
    assert.ok(backend.appliedSql.length >= 1);
    assert.equal(summary.gitWorktree?.dirty, true);
  } finally {
    removeTempRoot(root);
  }
});
