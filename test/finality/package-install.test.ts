/**
 * Packed tarball consumer: @xylex-group/athena from .tmp/packages/*.tgz.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packDir = join(pkgRoot, ".tmp", "packages");
const consumer = join(pkgRoot, "test", "fixtures", "package-consumer");
const nextEmbedded = join(pkgRoot, "test", "fixtures", "next-embedded");

test("package-install: packed tarball is installed into package-consumer and next-embedded", () => {
	assert.equal(existsSync(packDir), true, ".tmp/packages must exist");
	const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
	assert.ok(tarballs.length > 0, "pnpm pack must write a .tgz");

	for (const fixture of [consumer, nextEmbedded]) {
		const resolved = join(fixture, "node_modules", "@xylex-group", "athena");
		assert.equal(
			existsSync(resolved),
			true,
			`${fixture} must install @xylex-group/athena`,
		);
		const pkg = JSON.parse(
			readFileSync(join(resolved, "package.json"), "utf8"),
		) as { name?: string };
		assert.equal(pkg.name, "@xylex-group/athena");
		const real = statSync(resolved);
		assert.ok(real.isDirectory());
	}

	const require = createRequire(join(consumer, "consume.mjs"));
	const packed = require.resolve("@xylex-group/athena");
	assert.match(packed.replaceAll("\\", "/"), /node_modules\/@xylex-group\/athena/);
	assert.doesNotMatch(packed.replaceAll("\\", "/"), /packages\/athena-js\/src\//);
});
