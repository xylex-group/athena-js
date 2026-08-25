/**
 * Baseline — HTTP-only public billing module (still true after PR 1).
 * Inverted “no runtime / no page / no capabilities” cells live in
 * test/sdd/superseded/athena-js-local-billing.baseline.superseded.ts.
 *
 * See docs/sdd/xylex/athena-js-local-billing/dual-suite/dual-suite-spec.md
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const moduleSrc = readFileSync(
	join(here, "..", "..", "src", "billing", "module.ts"),
	"utf8",
);

test("P?: createBillingModule owns fetch and /billing/v1", () => {
	assert.match(moduleSrc, /fetchImpl|createBillingHttpTransport/);
	assert.match(moduleSrc, /\/billing\/v1\/payments/);
});

test("P?: public module is a flat HTTP method bag", () => {
	assert.match(moduleSrc, /listPayments:/);
	assert.match(moduleSrc, /createPayment:/);
	assert.doesNotMatch(moduleSrc, /readonly payments: BillingPaymentsNamespace/);
});
