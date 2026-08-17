import assert from "node:assert/strict";
import test from "node:test";
import {
  asNonEmptyString,
  asString,
  readTrimmedString,
} from "../src/utils/coercions.ts";

test("asNonEmptyString trims and returns undefined for empty/non-string", () => {
  assert.equal(asNonEmptyString("  hi  "), "hi");
  assert.equal(asNonEmptyString(""), undefined);
  assert.equal(asNonEmptyString("   "), undefined);
  assert.equal(asNonEmptyString(null), undefined);
  assert.equal(asNonEmptyString(42), undefined);
});

test("asString vs asNonEmptyString vs readTrimmedString", () => {
  assert.equal(asString(42), "42");
  assert.equal(asNonEmptyString(42), undefined);
  assert.equal(readTrimmedString(42), null);

  assert.equal(asString(""), null);
  assert.equal(asNonEmptyString(""), undefined);
  assert.equal(readTrimmedString(""), null);
});
