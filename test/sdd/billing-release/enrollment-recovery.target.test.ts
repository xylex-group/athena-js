/**
 * RED: crash-after-provider-create must recover via claim lease, not a second create.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { billingSqlDir, combinedBillingSql, readSrc } from "./helpers.ts";

test("P0: claim table has lease CAS columns", () => {
  const sql = combinedBillingSql();
  assert.match(sql, /lease_epoch/);
  assert.match(sql, /lease_owner/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /provider_create_key/);
});

test("P0: advance path CAS-leases the enrollment claim, not only checkout_sessions", () => {
  const advance = readSrc(
    "billing",
    "runtime",
    "self",
    "advance-enrollment.ts"
  );
  assert.match(advance, /lease_epoch/);
  assert.match(advance, /lease_expires_at/);
  assert.match(advance, /first_payment_paid/);
  assert.match(advance, /subscription_creating/);
});

test("P0: provider subscription metadata carries athenaEnrollmentClaimId", () => {
  const enroll = readSrc("billing", "runtime", "self", "enroll.ts");
  const advance = readSrc(
    "billing",
    "runtime",
    "self",
    "advance-enrollment.ts"
  );
  const combined = `${enroll}\n${advance}`;
  assert.match(combined, /athenaEnrollmentClaimId/);
  assert.equal(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: assert source does not embed these templates
    combined.includes("${idempotencyKey}:subscription") ||
      // biome-ignore lint/suspicious/noTemplateCurlyInString: assert source does not embed these templates
      combined.includes("${input.idempotencyKey}:subscription"),
    false,
    "subscription create must use claim-scoped financial identity"
  );
});

test("P0: duplicate live subscriptions fail closed in 0023, they are not auto-picked", () => {
  const path = join(
    billingSqlDir,
    "0023_billing_subscription_enrollment_claims.sql"
  );
  assert.equal(existsSync(path), true);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /RAISE|ATHENA_BILLING|fail/i);
  assert.doesNotMatch(sql, /LIMIT 1\s*;/i);
});
