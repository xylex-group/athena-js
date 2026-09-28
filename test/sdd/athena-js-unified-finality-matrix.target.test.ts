/**
 * Unified finality matrix is the tracked 22-cell hard SSOT (Wave 7).
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertFinalityMatrixProofs,
  FINALITY_MATRIX,
} from "../../scripts/finality-matrix.mjs";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("unified matrix has 22 tracked hard cells plus documented adjacent proofs", () => {
  const hard = FINALITY_MATRIX.filter((cell) => cell.gate === "hard");
  assert.equal(hard.length, 22);
  assert.deepEqual(
    hard.map((cell) => cell.id),
    [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      21, 23, 24,
    ]
  );
  const adjacent = FINALITY_MATRIX.filter((cell) => cell.gate === "adjacent");
  assert.ok(adjacent.some((cell) => cell.title.includes("Chromium")));
  assert.ok(adjacent.some((cell) => cell.title.includes("physical")));
});

test("every matrix proof file exists on disk", () => {
  assertFinalityMatrixProofs(pkgRoot);
});

test("pnpm finality is the same orchestrator as test:finality", () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts.finality, pkg.scripts["test:finality"]);
  assert.match(pkg.scripts.finality ?? "", /run-finality\.mjs/);
});

test("run-finality imports the matrix and runs packed + script hard cells", () => {
  const source = readFileSync(
    join(pkgRoot, "scripts", "run-finality.mjs"),
    "utf8"
  );
  assert.match(source, /finality-matrix\.mjs/);
  assert.match(source, /assertFinalityMatrixProofs/);
  assert.match(source, /test:billing-release/);
  assert.match(source, /test:auth-schema-release/);
  assert.match(source, /audit:rn/);
  assert.match(source, /docs:check/);
  assert.match(source, /next-minimal-golden-social\.test\.ts/);
  assert.match(source, /next-minimal-golden-passkey\.test\.ts/);
  assert.match(source, /next-minimal-golden-auth-ui-pack\.test\.ts/);
  assert.match(source, /packed-transport-topology\.test\.ts/);
  assert.match(source, /token-key-store-postgres\.test\.ts/);
});

test("release:verify keeps schema lock + finality + tarball + examples hard gates", () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  const verify = pkg.scripts["release:verify"] ?? "";
  assert.match(verify, /verify-auth-schema-release/);
  assert.match(verify, /test:finality/);
  assert.match(verify, /test:tarball/);
  assert.match(verify, /test:examples/);
  assert.doesNotMatch(verify, /\|\||continue-on-error/);
});
