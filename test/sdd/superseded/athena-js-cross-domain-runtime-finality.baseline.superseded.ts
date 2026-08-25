/**
 * SUPERSEDED by test/sdd/athena-js-cross-domain-runtime-finality.target.test.ts
 *
 * Former characterization of freeze-HEAD defects:
 * - no `src/runtime/finality` matrix
 * - discovery omitted `s3` and storage/billing capability flags
 * - browser-bundle audit omitted Mollie secret identifiers
 *
 * Target suite is the CI source of truth. Do not invert titles in place.
 * Not collected by pnpm test (superseded/ is skipped).
 *
 * See docs/sdd/xylex/athena-js-cross-domain-runtime-finality/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

test("B-FIN-NO-MATRIX: P?: runtime finality matrix module does not exist", () => {
	assert.equal(existsSync(join(srcRoot, "runtime", "finality")), false);
});

test("B-FIN-DISCOVERY-NO-S3: P?: discovery diagnostics.storage does not include s3", () => {
	const src = readFileSync(
		join(srcRoot, "gateway", "discovery-types.ts"),
		"utf8",
	);
	assert.match(
		src,
		/storage:\s*"http"\s*\|\s*"r2"\s*\|\s*"local"\s*\|\s*"none"/,
	);
	assert.equal(src.includes('"s3"'), false);
});

test("B-FIN-CAPS: P?: discovery capabilities omit storage and billing flags", () => {
	const src = readFileSync(
		join(srcRoot, "gateway", "discovery-types.ts"),
		"utf8",
	);
	assert.equal(/storage\?:\s*boolean/.test(src), false);
	assert.equal(/billing\?:\s*boolean/.test(src), false);
	const next = readFileSync(join(srcRoot, "next", "data-handlers.ts"), "utf8");
	assert.equal(next.includes("storage: hasStorageRuntime"), false);
	assert.equal(next.includes("billing: hasBillingRuntime"), false);
});

test("B-FIN-AUDIT-NO-MOLLIE: P?: browser bundle audit does not mention Mollie secrets", () => {
	const audit = readFileSync(
		join(pkgRoot, "scripts", "audit-browser-bundle-safety.mjs"),
		"utf8",
	);
	assert.equal(audit.includes("testKey"), false);
	assert.equal(audit.includes("liveKey"), false);
	assert.equal(audit.includes("createOfficialMollieAdapter"), false);
});

test("B-FIN-NO-CTOR: P?: createStorageClient createBillingClient createPrincipalClient are not exports", async () => {
	const mod = await import("../../../src/index.ts");
	assert.equal("createStorageClient" in mod, false);
	assert.equal("createBillingClient" in mod, false);
	assert.equal("createPrincipalClient" in mod, false);
});
