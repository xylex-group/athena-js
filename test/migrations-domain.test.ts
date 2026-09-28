import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checksumMigrationSql,
  resolveMigrationExecution,
} from "../src/migrations/checksum.ts";
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
    Pick<MigrationFile, "version" | "name" | "filename">
): MigrationFile {
  const sql = partial.sql ?? `SELECT ${partial.version};`;
  return {
    checksum: partial.checksum ?? checksumMigrationSql(sql),
    filename: partial.filename,
    name: partial.name,
    path: partial.path ?? `/tmp/${partial.filename}`,
    sql,
    version: partial.version,
  };
}

function applied(
  partial: Partial<AppliedMigration> &
    Pick<AppliedMigration, "version" | "name" | "checksum">
): AppliedMigration {
  return {
    ...partial,
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

test("planMigrations rejects a changed transformed SQL execution identity", () => {
  const authoredSql = "CREATE TABLE users(id int);";
  const firstExecutionSql = "CREATE TABLE tenant_users(id int);";
  const changedExecutionSql = "CREATE TABLE account_users(id int);";
  const local = file({
    executionSql: changedExecutionSql,
    filename: "0001_users.sql",
    name: "users",
    sql: authoredSql,
    version: 1,
  });

  const plan = planMigrations({
    applied: [
      applied({
        checksum: checksumMigrationSql(authoredSql),
        executionChecksum: checksumMigrationSql(firstExecutionSql),
        executionTransformId: "tenant-scope",
        executionTransformVersion: "1",
        name: "users",
        version: 1,
      }),
    ],
    local: [local],
  });

  assert.equal(plan.applied.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.kind, "checksum-mismatch");
});

test("resolveMigrationExecution rejects a transform without execution SQL", () => {
  assert.throws(
    () =>
      resolveMigrationExecution({
        executionTransform: { id: "tenant-scope", version: "1" },
        sql: "CREATE TABLE users(id int);",
      }),
    /executionTransform requires executionSql/
  );
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
      ["0001_first.sql", "0002_second.sql", "0005_gapped.sql"]
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
      }
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
      }
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("planMigrations handles empty, pending, applied, mismatch, and db-ahead", () => {
  const local = [
    file({
      filename: "0001_initial.sql",
      name: "initial",
      sql: "A",
      version: 1,
    }),
    file({ filename: "0002_next.sql", name: "next", sql: "B", version: 2 }),
  ];
  const initial = local[0];
  const next = local[1];
  assert.ok(initial);
  assert.ok(next);

  assert.deepEqual(planMigrations({ applied: [], local: [] }).pending, []);

  const allPending = planMigrations({ applied: [], local });
  assert.equal(allPending.pending.length, 2);
  assert.equal(allPending.applied.length, 0);

  const allApplied = planMigrations({
    applied: [
      applied({ checksum: initial.checksum, name: "initial", version: 1 }),
      applied({ checksum: next.checksum, name: "next", version: 2 }),
    ],
    local,
  });
  assert.equal(allApplied.pending.length, 0);
  assert.equal(allApplied.applied.length, 2);

  const somePending = planMigrations({
    applied: [
      applied({ checksum: initial.checksum, name: "initial", version: 1 }),
    ],
    local,
  });
  assert.equal(somePending.applied.length, 1);
  assert.equal(somePending.pending.length, 1);
  assert.equal(somePending.pending[0]?.migration.version, 2);

  const mismatch = planMigrations({
    applied: [
      applied({ checksum: "deadbeef", name: "initial", version: 1 }),
      applied({ checksum: next.checksum, name: "next", version: 2 }),
    ],
    local,
  });
  assert.equal(mismatch.conflicts.length, 1);
  assert.equal(mismatch.conflicts[0]?.kind, "checksum-mismatch");

  const ahead = planMigrations({
    applied: [
      applied({ checksum: initial.checksum, name: "initial", version: 1 }),
      applied({
        checksum: checksumMigrationSql("C"),
        name: "add_index",
        version: 3,
      }),
    ],
    local: [initial],
  });
  assert.equal(
    ahead.conflicts.some((c) => c.kind === "missing-local"),
    true
  );
  assert.equal(
    ahead.conflicts.find((c) => c.kind === "missing-local")?.version,
    3
  );

  const renamed = planMigrations({
    applied: [
      applied({
        checksum: checksumMigrationSql("A"),
        name: "initial",
        version: 1,
      }),
    ],
    local: [
      file({
        filename: "0001_functions.sql",
        name: "functions",
        sql: "A",
        version: 1,
      }),
    ],
  });
  assert.equal(renamed.conflicts[0]?.kind, "name-mismatch");

  const inserted = planMigrations({
    applied: [
      applied({ checksum: initial.checksum, name: "initial", version: 1 }),
      applied({
        checksum: checksumMigrationSql("C"),
        name: "late",
        version: 3,
      }),
    ],
    local: [
      initial,
      next,
      file({
        filename: "0003_late.sql",
        name: "late",
        sql: "C",
        version: 3,
      }),
    ],
  });
  assert.equal(
    inserted.conflicts.some((c) => c.kind === "historical-insertion"),
    true
  );
  assert.equal(
    inserted.conflicts.find((c) => c.kind === "historical-insertion")?.version,
    2
  );
});
