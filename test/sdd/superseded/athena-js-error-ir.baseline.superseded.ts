/**
 * Retired characterization baseline for the Error Spine slice.
 *
 * At the 26 August 2026 freeze, Storage classification was split across
 * provider message matching and transport status ternaries. This file is
 * retained as evidence of the pre-spine shape and is intentionally excluded
 * from the product test runner.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("B-EIR-FOUND: pre-spine Storage code invented catalog identity", () => {
  const source = readFileSync(
    new URL("../../src/storage/runtime/errors.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /mapProviderFailure/);
});
