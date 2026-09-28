import { strict as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureApplicationMigrationsDirectory } from "../src/migrations/ensure-directory.ts";

test("ensureApplicationMigrationsDirectory creates folder and keepfile", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-migrations-ensure-"));
  const directory = join(root, "athena", "migrations");
  try {
    const first = await ensureApplicationMigrationsDirectory({ directory });
    assert.equal(first.created, true);
    assert.equal(first.keepFileWritten, true);
    assert.equal(existsSync(join(directory, ".gitkeep")), true);

    const second = await ensureApplicationMigrationsDirectory({ directory });
    assert.equal(second.created, false);
    assert.equal(second.keepFileWritten, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensureApplicationMigrationsDirectory dry-run does not write", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-migrations-ensure-dry-"));
  const directory = join(root, "athena", "migrations");
  try {
    const result = await ensureApplicationMigrationsDirectory({
      directory,
      dryRun: true,
    });
    assert.equal(result.created, true);
    assert.equal(existsSync(directory), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
