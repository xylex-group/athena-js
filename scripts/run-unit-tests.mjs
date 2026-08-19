#!/usr/bin/env node
/**
 * Unit / regression runner. Excludes the superseded local-finality baseline
 * characterization file so `pnpm test` stays the product suite.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SUPERSEDED = new Set(["local-verification-finality.baseline.test.ts"]);

function collect(dir, prefix) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "superseded") {
			continue;
		}
		const nextPrefix = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...collect(join(dir, entry.name), nextPrefix));
			continue;
		}
		if (!entry.name.endsWith(".test.ts") || SUPERSEDED.has(entry.name)) {
			continue;
		}
		out.push(nextPrefix);
	}
	return out;
}

const selected = [
	...readdirSync(join(root, "test"))
		.filter((name) => name.endsWith(".test.ts"))
		.map((name) => `test/${name}`),
	...collect(join(root, "test", "sdd"), "test/sdd"),
	...collect(join(root, "test", "conformance"), "test/conformance"),
];

const result = spawnSync(
	process.execPath,
	[
		"--import",
		"./test/register-server-only.mjs",
		"--import",
		"tsx",
		"--test",
		"--test-force-exit",
		...selected,
	],
	{
		cwd: root,
		// Node lives under "C:\Program Files\..."; shell:true splits the path.
		shell: false,
		stdio: "inherit",
	},
);

process.exit(typeof result.status === "number" ? result.status : 1);
