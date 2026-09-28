/**
 * RED: connection identity is owner + provider + environment + credential slot.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { billingSqlDir, combinedBillingSql, readSrc } from "./helpers.ts";

test("forward-only owner-slot migration exists after enrollment claims", () => {
  assert.equal(
    existsSync(join(billingSqlDir, "0024_billing_connection_owner_slot.sql")),
    true
  );
  const sql = combinedBillingSql();
  assert.match(
    sql,
    /owner_kind[\s\S]*owner_id[\s\S]*provider[\s\S]*environment[\s\S]*credential_reference/
  );
});

test("materialize ON CONFLICT matches the owner-slot identity", () => {
  const materialize = readSrc(
    "billing",
    "runtime",
    "local",
    "connections",
    "materialize.ts"
  );
  assert.equal(
    materialize.includes(
      "ON CONFLICT (provider, account_reference, environment)"
    ),
    false
  );
  assert.match(
    materialize,
    /ON CONFLICT \(owner_kind,\s*owner_id,\s*provider,\s*environment,\s*credential_reference\)/
  );
  assert.doesNotMatch(materialize, /owner_kind = EXCLUDED\.owner_kind/);
});

test("financial writes do not use sole-active connection resolution", () => {
  const enroll = readSrc("billing", "runtime", "self", "enroll.ts");
  assert.equal(enroll.includes("resolveActiveBillingConnection"), false);
  assert.match(enroll, /BillingConnectionSelector/);
});

test("pending customer provisioning is leased and reclaimable", () => {
  const ensure = readSrc("billing", "subject", "ensure-provider-customer.ts");
  assert.match(ensure, /lease_expires_at/);
  assert.match(ensure, /lease_epoch/);
  assert.match(ensure, /attempt_id/);
});
