import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = join(pkgRoot, "src");
const managerPath = join(srcRoot, "postgres", "pool", "manager.ts");

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

test("ACT-PG-POOL-02: raw PostgreSQL checkout is owned by the pool manager", () => {
  const violations = collectTsFiles(srcRoot)
    .filter((path) => path !== managerPath)
    .filter((path) => /\bpool\.connect\s*\(/.test(readFileSync(path, "utf8")));

  assert.deepEqual(
    violations,
    [],
    "PostgreSQL clients must be acquired through PostgresPoolManager"
  );
});

test("ACT-PG-POOL-03: production sources do not construct pg.Pool outside postgres/", () => {
  const postgresRoot = join(srcRoot, "postgres");
  const violations = collectTsFiles(srcRoot)
    .filter((path) => !path.startsWith(postgresRoot))
    .filter((path) => /new\s+Pool\s*\(/.test(readFileSync(path, "utf8")));
  assert.deepEqual(violations, []);
});
