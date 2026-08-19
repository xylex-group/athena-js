/**
 * N2 — browser bundle cannot resolve pg or server-only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("N2: browser bundle cannot resolve pg or server-only", () => {
	const browserJs = readFileSync(join(pkgRoot, "dist", "browser.js"), "utf8");
	const nextClient = readFileSync(
		join(pkgRoot, "dist", "next", "client.js"),
		"utf8",
	);
	for (const [label, source] of [
		["browser.js", browserJs],
		["next/client.js", nextClient],
	] as const) {
		assert.doesNotMatch(
			source,
			/from ["']pg["']|require\(["']pg["']\)/,
			`${label} must not resolve pg`,
		);
		assert.doesNotMatch(
			source,
			/from ["']server-only["']|require\(["']server-only["']\)/,
			`${label} must not resolve server-only`,
		);
	}
});
