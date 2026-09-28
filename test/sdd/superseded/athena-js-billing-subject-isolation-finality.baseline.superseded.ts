/**
 * Baseline: billing subject isolation found case (containment).
 * GREEN on freeze disk. Retire after target GREEN.
 * See docs/sdd/xylex/athena-js-billing-subject-isolation-finality/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { AthenaBillingAuthorizationError } from "../../src/billing/errors.ts";
import {
  authorizeBillingSubjectBinding,
  isProcessOwnedBillingPrincipal,
  PROCESS_OWNED_BILLING_PRINCIPAL,
} from "../../src/billing/runtime/rights.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function sessionMerchant(): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [
      parseAthenaRightKey("billing.sales-invoices.read"),
      parseAthenaRightKey("billing.subscriptions.write"),
      parseAthenaRightKey("billing.payments.read"),
    ],
    userId: "user_a",
  };
}

test("P?: src/billing/runtime/self does not exist", () => {
  assert.equal(existsSync(join(srcRoot, "billing", "runtime", "self")), false);
});

test("P?: src/billing/subject does not exist", () => {
  assert.equal(existsSync(join(srcRoot, "billing", "subject")), false);
});

test("P?: embedded billing catalog has no 0003", () => {
  const catalog = readSrc("migrations/embedded-billing/catalog.ts");
  assert.match(catalog, /0001_billing_canonical\.sql/);
  assert.match(catalog, /0002_billing_subject_bindings\.sql/);
  assert.equal(catalog.includes("0003_"), false);
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations",
        "embedded-billing",
        "sql",
        "0003_billing_subject_finality.sql"
      )
    ),
    false
  );
});

test("P?: process overlay principal uses userId billing-overlay", () => {
  assert.equal(PROCESS_OWNED_BILLING_PRINCIPAL.userId, "billing-overlay");
  assert.match(
    readSrc("billing/runtime/rights.ts"),
    /userId:\s*"billing-overlay"/
  );
});

test("P?: process overlay is detected by userId string equality", () => {
  assert.equal(
    isProcessOwnedBillingPrincipal({
      authenticated: true,
      grants: [],
      rights: [],
      userId: "billing-overlay",
    }),
    true
  );
  assert.equal(isProcessOwnedBillingPrincipal(sessionMerchant()), false);
});

test("P?: session principal is denied invoices.list after Rights", () => {
  const denied = authorizeBillingSubjectBinding(
    sessionMerchant(),
    "invoices.list"
  );
  assert.ok(denied instanceof AthenaBillingAuthorizationError);
  assert.equal(denied.code, "ATHENA_BILLING_AUTHORIZATION_DENIED");
  assert.deepEqual(denied.missing, []);
  assert.equal(denied.operation, "invoices.list");
});

test("P?: session principal is allowed prices.list without binding", () => {
  assert.equal(
    authorizeBillingSubjectBinding(sessionMerchant(), "prices.list"),
    undefined
  );
  assert.equal(
    authorizeBillingSubjectBinding(sessionMerchant(), "products.list"),
    undefined
  );
});

test("P?: process overlay is not subject-gated", () => {
  assert.equal(
    authorizeBillingSubjectBinding(
      PROCESS_OWNED_BILLING_PRINCIPAL,
      "invoices.list"
    ),
    undefined
  );
});

test("P?: browser billing transport exposes raw invoices.list", () => {
  const src = readSrc("billing/runtime/browser-transport.ts");
  assert.match(src, /call\("invoices\.list"/);
  assert.match(src, /call\("payments\.list"/);
  assert.match(src, /call\("subscriptions\.list"/);
  assert.equal(src.includes("self.invoices"), false);
});

test("P?: Mollie invoice list uses salesInvoices", () => {
  const src = readSrc("billing/runtime/local/providers/mollie/invoices.ts");
  assert.match(src, /return "salesInvoices"/);
  assert.match(src, /operation: "invoices\.list"/);
});

test("P?: billing HTTP advertises invoices.list not self.invoices.list", () => {
  const src = readSrc("next/billing-handlers.ts");
  assert.match(src, /"invoices\.list"/);
  assert.equal(src.includes("self.invoices.list"), false);
});

test("P?: 0002 still has global provider+provider_id unique indexes", () => {
  const sql = readSrc(
    "migrations/embedded-billing/sql/0002_billing_subject_bindings.sql"
  );
  assert.match(sql, /idx_billing_payments_provider_payment_id/);
  assert.match(
    sql,
    /UNIQUE INDEX IF NOT EXISTS idx_billing_payments_provider_payment_id[\s\S]*\(provider, provider_payment_id\)/
  );
});

test("P?: CLI catalog has no billing reconcile-subjects", () => {
  const catalog = readFileSync(
    join(srcRoot, "cli", "commands-catalog.ts"),
    "utf8"
  );
  assert.equal(catalog.includes("reconcile-subjects"), false);
});

test("P?: ingress SQL keys payments by provider + provider_payment_id", () => {
  const src = readSrc("billing/runtime/local/ingress/sql.ts");
  assert.match(src, /WHERE provider = \$1 AND provider_payment_id = \$2/);
  assert.equal(src.includes("subject_kind"), false);
});

test("P?: BillingSubjectRef remains user or organization", () => {
  const src = readSrc("billing/types.ts");
  assert.match(src, /export type BillingSubjectRef/);
  assert.match(src, /kind: "user"/);
  assert.match(src, /kind: "organization"/);
});

test("P?: bindings store email_snapshot not UNIQUE email", () => {
  const sql = readSrc(
    "migrations/embedded-billing/sql/0002_billing_subject_bindings.sql"
  );
  assert.match(sql, /email_snapshot/);
  assert.equal(sql.includes("UNIQUE(email"), false);
});

test("P?: no createBillingClient", () => {
  const index = readSrc("billing/index.ts");
  assert.equal(index.includes("createBillingClient"), false);
  assert.equal(
    existsSync(join(srcRoot, "billing", "create-billing-client.ts")),
    false
  );
});
