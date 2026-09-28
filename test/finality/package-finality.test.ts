/**
 * Published-package syntax guards.
 *
 * Runtime modules must not contain package-relative `new URL()` expressions:
 * bundlers interpret those expressions as asset dependencies instead of
 * filesystem calculations.
 */

import { strict as assert } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const packageRelativeUrl = /\bnew\s+URL\(\s*["'](?:\.\.?\/)+[^"']*["']\s*,\s*import\.meta\.url\s*\)/g;

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

test("runtime source contains no package-relative new URL import expressions", async () => {
  const violations: string[] = [];
  for (const path of await sourceFiles(sourceRoot)) {
    const source = await readFile(path, "utf8");
    if (packageRelativeUrl.test(source)) {
      violations.push(path.replaceAll("\\", "/"));
    }
    packageRelativeUrl.lastIndex = 0;
  }
  assert.deepEqual(violations, []);
});
