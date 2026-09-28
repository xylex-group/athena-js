#!/usr/bin/env node
/**
 * Junction `node_modules/@xylex-group/athena` → this package so in-repo
 * imports of the published name resolve. Not a package.json dependency:
 * `link:` is not registry-safe and must not appear in the packed manifest.
 */
import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function ensureDevSelfLink() {
	const root = dirname(dirname(fileURLToPath(import.meta.url)));
	const scopedDir = join(root, "node_modules", "@xylex-group");
	const linkPath = join(scopedDir, "athena");
	const type = process.platform === "win32" ? "junction" : "dir";

	mkdirSync(scopedDir, { recursive: true });
	try {
		const stat = lstatSync(linkPath);
		if (stat.isSymbolicLink() || stat.isDirectory()) {
			// Already linked. Do not process.exit — this file is also imported by
			// `run-unit-tests.mjs`, and exiting here would skip the entire suite.
			return;
		}
		rmSync(linkPath, { force: true, recursive: true });
	} catch {
		// missing
	}
	symlinkSync(root, linkPath, type);
}

ensureDevSelfLink();
