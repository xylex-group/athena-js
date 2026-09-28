/**
 * Keep-green / freeze characterization for next-minimal Billing auth finality.
 * Found-case defects (lookup without rights, instanceof-only encode) are inverted
 * in the target suite after implement — this file must stay GREEN.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NON_AUTHORITATIVE_IDENTITY_HEADERS } from "../../src/runtime/authority/headers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

test("B-NBA-KEEP: no createBillingClient; HTTP never assigns process overlay; x-rights non-authoritative", () => {
  assert.equal(
    readSrc("next/billing-handlers.ts").includes("createBillingClient"),
    false
  );
  assert.equal(
    readSrc("next/billing-handlers.ts").includes(
      "PROCESS_OWNED_BILLING_PRINCIPAL"
    ),
    false
  );
  assert.equal(NON_AUTHORITATIVE_IDENTITY_HEADERS.includes("x-rights"), true);
  assert.equal(NON_AUTHORITATIVE_IDENTITY_HEADERS.includes("x-user-id"), true);
  assert.equal(
    readSrc("billing/runtime/rights.ts").includes("principal.grants"),
    false
  );
});
