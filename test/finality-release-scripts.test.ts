/**
 * Athena 5 Finality — P14 release contract (INV-14 / CI-009).
 * Seam: packages/athena-js/package.json scripts.
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("P14: check:release exists and prepublishOnly is not weaker", async () => {
	const raw = await readFile(
		new URL("../package.json", import.meta.url),
		"utf8",
	);
	const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
	const release = pkg.scripts["check:release"];
	assert.equal(typeof release, "string");
	assert.match(release, /typecheck/);
	assert.match(release, /test/);
	assert.match(release, /build/);
	assert.match(release, /check:publint/);
	assert.match(release, /check:tarball/);
	assert.match(release, /docs:check/);
	assert.match(pkg.scripts.prepublishOnly, /release:verify/);
	assert.notEqual(pkg.scripts.prepublishOnly, "pnpm check:release");
	assert.match(
		pkg.scripts["release:verify"] ?? "",
		/test:finality\s*&&\s*(?:pnpm\s+)?test:tarball\s*&&\s*(?:pnpm\s+)?test:examples/,
	);
	assert.equal(typeof pkg.scripts["check:publint"], "string");
	assert.equal(typeof pkg.scripts["check:tarball"], "string");
	assert.equal(typeof pkg.scripts["docs:check"], "string");
	assert.equal(typeof pkg.scripts["test:parity:live"], "string");
	assert.equal(typeof pkg.scripts["test:embedded-next"], "string");
	assert.match(
		pkg.scripts["test:parity:live"],
		/parity-live|ATHENA_AUTH_URL|ATHENA_PARITY_REQUIRE_RUST/,
	);
});
