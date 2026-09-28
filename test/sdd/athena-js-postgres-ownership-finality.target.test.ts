import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_POSTGRES_POOL_CONNECT,
  ALLOWED_POSTGRES_POOL_MANAGER_FACTORIES,
  ALLOWED_POSTGRES_POOL_OWNERS,
} from "../../src/postgres/pool/ownership.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = join(pkgRoot, "src");

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

function srcKey(path: string): string {
  return `src/${relative(srcRoot, path).replaceAll("\\", "/")}`;
}

test("production PostgreSQL pool construction is owned by the approved root", () => {
  const allowed = new Set<string>(ALLOWED_POSTGRES_POOL_OWNERS);
  const violations: string[] = [];
  for (const file of collectTsFiles(srcRoot)) {
    const key = srcKey(file);
    const text = readFileSync(file, "utf8");
    if (/\bcreatePostgresPool\s*\(/.test(text) && !allowed.has(key)) {
      violations.push(`${key}: createPostgresPool(`);
    }
    if (/\bnew Pool(?:Constructor)?\s*\(/.test(text) && !allowed.has(key)) {
      violations.push(`${key}: new Pool(`);
    }
  }
  assert.deepEqual(violations, []);
});

test("production pool.connect is owned by PostgresPoolManager", () => {
  const allowed = new Set<string>(ALLOWED_POSTGRES_POOL_CONNECT);
  const violations: string[] = [];
  for (const file of collectTsFiles(srcRoot)) {
    const key = srcKey(file);
    const text = readFileSync(file, "utf8");
    if (/\bpool\.connect\s*\(/.test(text) && !allowed.has(key)) {
      violations.push(`${key}: pool.connect(`);
    }
  }
  assert.deepEqual(violations, []);
});

test("createPostgresPoolManager stays on ownership factories", () => {
  const allowed = new Set<string>(ALLOWED_POSTGRES_POOL_MANAGER_FACTORIES);
  const violations: string[] = [];
  for (const file of collectTsFiles(srcRoot)) {
    const key = srcKey(file);
    const text = readFileSync(file, "utf8");
    if (text.includes("createPostgresPoolManager") && !allowed.has(key)) {
      violations.push(key);
    }
  }
  assert.deepEqual(violations, []);
});
