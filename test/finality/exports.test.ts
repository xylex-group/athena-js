/**
 * N3 — `/server` cannot expose browser export conditions.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const pkg = require(join(pkgRoot, "package.json")) as {
	exports: Record<string, Record<string, string> | string>;
};

test("N3: exports[\"./server\"] has no browser condition", () => {
	const server = pkg.exports["./server"];
	assert.equal(typeof server, "object");
	assert.ok(server && !Array.isArray(server));
	assert.equal(
		Object.hasOwn(server as object, "browser"),
		false,
		"/server must not expose browser conditions",
	);
	assert.equal((server as { import?: string }).import, "./dist/server.js");
});
