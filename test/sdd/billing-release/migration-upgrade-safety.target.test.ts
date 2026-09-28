/**
 * RED: dirty unique-index upgrades fail with Athena remediation, not opaque 23505.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { billingSqlDir, readSrc } from "./helpers.ts";

test("released 0011 checksum/file is not rewritten", () => {
  const path = join(
    billingSqlDir,
    "0011_billing_subject_binding_uniqueness.sql"
  );
  assert.equal(existsSync(path), true);
  const catalog = readSrc("migrations", "embedded-billing", "catalog.ts");
  assert.match(catalog, /0011_billing_subject_binding_uniqueness\.sql/);
});

test("embedded billing apply preflights duplicate live bindings before 0011 uniqueness", () => {
  const apply = readSrc("migrations", "embedded-sql-apply.ts");
  const billing = readSrc("migrations", "embedded-billing", "catalog.ts");
  const combined = `${apply}\n${billing}`;
  assert.match(
    combined,
    /duplicate live bindings|conflicting live bindings|remediation/i
  );
});

test("0028 fails closed on duplicate live subscriptions before creating the claim unique index", () => {
  const path = join(
    billingSqlDir,
    "0028_billing_enrollment_fencing_and_plan_change.sql"
  );
  assert.equal(existsSync(path), true);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /COUNT|HAVING/);
  assert.match(sql, /RAISE EXCEPTION|ATHENA_BILLING/);
});
