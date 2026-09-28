/**
 * Baseline — current Mollie injection characterization that must stay true
 * through Phase 1 (N/N-1 constructor injection + Fetch helper until Phase 10).
 *
 * See docs/sdd/xylex/athena-js-mollie/dual-suite/dual-suite-spec.md
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

function read(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

test("B-MOLLIE-FETCH-HELPER: unofficial FetchMollieSdk still exists for N/N-1", () => {
  assert.equal(
    existsSync(join(pkgRoot, "test", "helpers", "fetch-mollie-sdk.ts")),
    true
  );
  const conformance = read("test/conformance/billing/mollie.test.ts");
  assert.match(conformance, /FetchMollieSdk/);
});

test("B-MOLLIE-OBJECT: public config still accepts an injected constructor", () => {
  const types = read("src/billing/providers/types.ts");
  assert.match(types, /export type MollieSdkConstructor/);
  assert.match(types, /sdk:\s*MollieSdkConstructor/);
});
