/**
 * RED: durable subject enrollment claims + request vs financial identity.
 * GREEN when 0023 exists and enroll serializes on the claim before provider work.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { billingSqlDir, combinedBillingSql, readSrc } from "./helpers.ts";

test("P0: enrollment claims migration exists after current 0022 ledger", () => {
  assert.equal(
    existsSync(
      join(billingSqlDir, "0023_billing_subscription_enrollment_claims.sql")
    ),
    true,
    "add 0023_billing_subscription_enrollment_claims.sql (0022 is already webhook rejection evidence)"
  );
});

test("P0: catalog lists billing_subscription_enrollment_claims", () => {
  const catalog = readSrc("migrations", "embedded-billing", "catalog.ts");
  assert.match(catalog, /billing_subscription_enrollment_claims/);
});

test("P0: live claim uniqueness is subject-scoped", () => {
  const sql = combinedBillingSql();
  assert.match(sql, /billing_subscription_enrollment_claims/);
  assert.match(sql, /UNIQUE\s*\(\s*subject_kind\s*,\s*subject_id\s*\)/i);
});

test("P0: enroll acquires a subject claim before live-subscription or provider work", () => {
  const enroll = readSrc("billing", "runtime", "self", "enroll.ts");
  assert.match(enroll, /acquireEnrollmentClaim|enrollment_claims/);
  const claimIdx = enroll.search(/enrollment_claims|acquireEnrollmentClaim/);
  const liveIdx = enroll.indexOf("LIVE_SELF_SUBSCRIPTION_SQL");
  const paymentIdx = enroll.indexOf("executeLocalBillingPaymentCreate");
  assert.ok(claimIdx >= 0, "claim acquisition missing");
  if (liveIdx >= 0) {
    assert.ok(
      claimIdx < liveIdx,
      "live subscription probe must not run before the durable claim"
    );
  }
  assert.ok(claimIdx < paymentIdx || paymentIdx < 0);
});

test("P0: caller idempotency is not the Mollie financial identity", () => {
  const enroll = readSrc("billing", "runtime", "self", "enroll.ts");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: assert source does not embed these templates
  assert.equal(enroll.includes("${idempotencyKey}:first-payment"), false);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: assert source does not embed these templates
  assert.equal(enroll.includes("${input.idempotencyKey}:subscription"), false);
  assert.match(enroll, /athena:billing:enrollment:/);
  assert.match(
    readSrc("billing", "subject", "errors.ts") +
      readSrc("billing", "errors.ts"),
    /ATHENA_BILLING_SUBJECT_ENROLLMENT_IN_PROGRESS/
  );
});
