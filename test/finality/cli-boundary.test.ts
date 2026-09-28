/**
 * Built CLI bundle must not depend on the `server-only` package.
 * `athena-js -v` never loads this file; `--help` and migrate help do.
 */

import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readBuilt(relativePath: string): string {
  const source = readFileSync(join(pkgRoot, "dist", relativePath), "utf8");
  assert.ok(
    source.length > 0,
    `dist/${relativePath} is empty after package build`
  );
  return source;
}

test("CLI bundle contains no server-only dependency", () => {
  const importServerOnly =
    /\bimport\s*["']server-only["']|\bfrom\s*["']server-only["']|\brequire\(\s*["']server-only["']\s*\)/;
  for (const relativePath of ["cli/index.js", "cli/index.cjs"] as const) {
    const cli = readBuilt(relativePath);
    assert.doesNotMatch(cli, importServerOnly, relativePath);
  }
});
