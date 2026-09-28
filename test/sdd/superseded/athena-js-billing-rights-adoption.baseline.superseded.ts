/**
 * SUPERSEDED by test/sdd/athena-js-billing-rights-adoption.target.test.ts
 *
 * Former characterization of freeze-HEAD defects:
 * - execute table used native grant-catalog keys (`billing.read` / `billing.manage`)
 * - `authorizeBillingOperation` ran before `getCapabilities`
 * - overlay held grant-catalog keys
 * - no billing errorNumber 4014
 *
 * Target suite is the CI source of truth. Do not invert titles in place.
 *
 * See docs/sdd/xylex/athena-js-billing-rights-adoption/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { AthenaBillingAuthorizationError } from "../../../src/billing/errors.ts";
import {
  authorizeBillingOperation,
  BILLING_CATALOG_RIGHTS,
  PROCESS_OWNED_BILLING_PRINCIPAL,
  requiredBillingRights,
} from "../../../src/billing/runtime/rights.ts";
import { parseAthenaRightKey } from "../../../src/rights/key.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const billingRoot = join(srcRoot, "billing");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function billingBlob(): string {
  return collectTsFiles(billingRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

test("B-BIL-GRANT-CATALOG: P?: local Billing execute table uses native grant-catalog keys not dialect payments.write", () => {
  const rightsPath = join(billingRoot, "runtime", "rights.ts");
  assert.equal(existsSync(rightsPath), true);
  const src = readFileSync(rightsPath, "utf8");
  assert.match(src, /parseAthenaRightKey\("billing\.manage"\)/);
  assert.match(src, /parseAthenaRightKey\("billing\.read"\)/);
  assert.match(src, /parseAthenaRightKey\("billing\.customer\.manage"\)/);
  assert.match(src, /parseAthenaRightKey\("billing\.refund\.manage"\)/);
  assert.match(src, /"billing\.subscription\.manage"/);
  assert.match(src, /parseAthenaRightKey\("billing\.document\.read"\)/);
  assert.match(src, /parseAthenaRightKey\("billing\.provider\.admin"\)/);
  assert.equal(
    src.includes('parseAthenaRightKey("billing.payments.write")'),
    false
  );
  assert.equal(
    src.includes('parseAthenaRightKey("billing.payments.read")'),
    false
  );
  assert.deepEqual(requiredBillingRights("payments.create"), [
    parseAthenaRightKey("billing.manage"),
  ]);
  assert.deepEqual(requiredBillingRights("payments.list"), [
    parseAthenaRightKey("billing.read"),
  ]);
  assert.deepEqual(requiredBillingRights("customers.create"), [
    parseAthenaRightKey("billing.customer.manage"),
  ]);
  assert.deepEqual(requiredBillingRights("refunds.create"), [
    parseAthenaRightKey("billing.refund.manage"),
  ]);
  assert.deepEqual(requiredBillingRights("subscriptions.create"), [
    parseAthenaRightKey("billing.subscription.manage"),
  ]);
  assert.deepEqual(requiredBillingRights("invoices.list"), [
    parseAthenaRightKey("billing.document.read"),
  ]);
  assert.deepEqual(requiredBillingRights("webhooks.create"), [
    parseAthenaRightKey("billing.provider.admin"),
  ]);
});

test("B-BIL-GATE-BEFORE-CAPS: P?: Billing Rights gate runs before getCapabilities", () => {
  const shared = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "shared.ts"),
    "utf8"
  );
  const authIdx = shared.indexOf("authorizeBillingOperation");
  const capsIdx = shared.indexOf("getCapabilities");
  assert.ok(authIdx >= 0 && capsIdx >= 0 && authIdx < capsIdx);
});

test("B-BIL-PROVIDER-NATIVE: P?: Mollie operation authority remains provider-native permissions", () => {
  const src = readFileSync(
    join(
      billingRoot,
      "runtime",
      "local",
      "providers",
      "operation-authority.ts"
    ),
    "utf8"
  );
  assert.match(src, /permissions: \["payments\.write"\]/);
  assert.match(src, /permissions: \["customers\.read"\]/);
  assert.equal(src.includes("parseAthenaRightKey"), false);
});

test("B-BIL-NO-HTTP: P?: Embedded Billing HTTP route is absent", () => {
  const blob = billingBlob();
  assert.equal(blob.includes("/api/athena/billing"), false);
  assert.equal(existsSync(join(srcRoot, "next", "billing-handlers.ts")), false);
});

test("B-BIL-SAFETY: P?: prepareBillingCommand still sits above providers", () => {
  const payments = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "payments.ts"),
    "utf8"
  );
  const prepareIdx = payments.indexOf("prepareBillingCommand");
  const resolveIdx = payments.indexOf("resolveLocalBillingProviderExecution");
  assert.ok(prepareIdx >= 0 && resolveIdx >= 0 && prepareIdx < resolveIdx);
});

test("B-BIL-MOLLIE-SDK: P?: official Mollie adapter still constructs the SDK", () => {
  const src = readFileSync(
    join(
      billingRoot,
      "runtime",
      "local",
      "providers",
      "mollie",
      "sdk",
      "official-adapter.ts"
    ),
    "utf8"
  );
  assert.match(src, /new Sdk\(options\)/);
  assert.match(src, /export function createOfficialMollieAdapter/);
});

test("B-BIL-NO-CREATE-CLIENT: P?: createBillingClient is absent", () => {
  const blob = billingBlob();
  assert.equal(blob.includes("createBillingClient"), false);
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as { exports?: Record<string, unknown> };
  assert.equal(pkg.exports?.["./billing/client"] == null, true);
});

test("B-BIL-NO-STORAGE-DENY: P?: Billing execute does not reuse storage 3003", () => {
  const blob = billingBlob();
  assert.equal(/\b3003\b/.test(blob), false);
});

test("B-BIL-OVERLAY: P?: omitted principal uses PROCESS_OWNED_BILLING_PRINCIPAL billing-overlay", () => {
  const shared = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "shared.ts"),
    "utf8"
  );
  assert.match(shared, /input\.principal \?\? PROCESS_OWNED_BILLING_PRINCIPAL/);
  assert.equal(PROCESS_OWNED_BILLING_PRINCIPAL.userId, "billing-overlay");
  assert.deepEqual(
    PROCESS_OWNED_BILLING_PRINCIPAL.rights,
    BILLING_CATALOG_RIGHTS
  );
  assert.deepEqual(PROCESS_OWNED_BILLING_PRINCIPAL.grants, []);
  assert.equal(
    authorizeBillingOperation(
      PROCESS_OWNED_BILLING_PRINCIPAL,
      "payments.create"
    ),
    undefined
  );
});

test("B-BIL-NO-4014: P?: Billing authorization deny is 403 without billing errorNumber 4014", () => {
  const errors = readFileSync(join(billingRoot, "errors.ts"), "utf8");
  assert.match(errors, /ATHENA_BILLING_AUTHORIZATION_DENIED/);
  assert.match(errors, /this\.status = 403/);
  assert.equal(/\b4014\b/.test(errors), false);
  assert.equal(/\b4014\b/.test(billingBlob()), false);
  const denied = new AthenaBillingAuthorizationError({
    missing: ["billing.manage"],
    operation: "payments.create",
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "ATHENA_BILLING_AUTHORIZATION_DENIED");
  assert.equal("errorNumber" in denied, false);
});
