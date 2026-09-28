/**
 * SUPERSEDED by test/sdd/athena-schema-policy-impact.target.test.ts (PR F GREEN).
 * Former characterization of schema diff without --policy-impact after Wave 1.
 *
 * See docs/sdd/xylex/athena-policy/SPEC.md and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { schemaCatalog } from "../../../src/cli/commands/schema/catalog.ts";
import { parse } from "../../../src/cli/commands/schema/index.ts";
import { AthenaCliError } from "../../../src/cli/errors.ts";
import type { SchemaDiffCommand } from "../../../src/cli/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

test("B-SCH-NO-POLICY-IMPACT: SchemaDiffCommand has no policyImpact; parse rejects --policy-impact", () => {
  const typesSrc = readSrc("cli/types.ts");
  const start = typesSrc.indexOf("export interface SchemaDiffCommand");
  const end = typesSrc.indexOf("export interface SchemaSnapshotCommand");
  assert.ok(start >= 0 && end > start);
  const block = typesSrc.slice(start, end);
  assert.match(block, /command:\s*"schema-diff"/);
  assert.match(block, /json:\s*boolean/);
  assert.match(block, /migration:\s*boolean/);
  assert.equal(/\bpolicyImpact\b/.test(block), false);

  const parsed = parse(["diff", "--json", "--migration"]) as SchemaDiffCommand;
  assert.equal(parsed.command, "schema-diff");
  assert.equal(parsed.json, true);
  assert.equal(parsed.migration, true);
  assert.equal("policyImpact" in parsed, false);

  assert.throws(
    () => parse(["diff", "--policy-impact"]),
    (error: unknown) => {
      assert.ok(error instanceof AthenaCliError);
      assert.equal(error.code, "CLI003");
      assert.match(error.message, /Unknown option "--policy-impact"/);
      assert.match(error.message, /schema diff/);
      return true;
    }
  );

  const diffEntry = schemaCatalog.find(
    (entry) => entry.command === "schema diff"
  );
  assert.ok(diffEntry);
  assert.ok(diffEntry.flags);
  assert.equal(diffEntry.flags.includes("--policy-impact"), false);
  assert.ok(diffEntry.flags.includes("--json"));
  assert.ok(diffEntry.flags.includes("--migration"));

  const parseSrc = readSrc("cli/commands/schema/index.ts");
  assert.match(parseSrc, /function parseDiffFlags/);
  assert.equal(parseSrc.includes("policy-impact"), false);
  assert.equal(parseSrc.includes("policyImpact"), false);
});
