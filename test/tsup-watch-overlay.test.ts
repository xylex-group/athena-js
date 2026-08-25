import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("watch overlay skips the dts worker that OOMs next to Next/Vite", () => {
	const tsup = readFileSync(join(packageRoot, "tsup.config.ts"), "utf8");
	assert.match(tsup, /ATHENA_TSUP_WATCH/);
	assert.match(tsup, /dts:\s*isWatch\s*\?\s*false/);
	assert.match(tsup, /clean:\s*!isWatch/);

	const pkg = JSON.parse(
		readFileSync(join(packageRoot, "package.json"), "utf8"),
	) as { scripts: { dev: string } };
	assert.match(pkg.scripts.dev, /ATHENA_TSUP_WATCH=1/);
	assert.match(pkg.scripts.dev, /tsup --watch/);
});
