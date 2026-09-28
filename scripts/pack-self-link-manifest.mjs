#!/usr/bin/env node
/**
 * Workspace `package.json` keeps `"@xylex-group/athena": "link:"` for pnpm.
 * Packed / published manifests must not include that self-dependency.
 *
 * `pnpm pack` may skip `prepack` when ignore-scripts is set, so pack
 * callers should invoke strip/restore around pack as well as lifecycle hooks.
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = join(root, "package.json");
const backupDir = join(root, ".tmp");
const backupPath = join(backupDir, "package.json.prepack");
const SELF = "@xylex-group/athena";

export function stripPackSelfLink() {
	mkdirSync(backupDir, { recursive: true });
	if (!existsSync(backupPath)) {
		copyFileSync(pkgPath, backupPath);
	}
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	if (pkg.dependencies?.[SELF] === "link:") {
		delete pkg.dependencies[SELF];
		writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
	}
}

export function restorePackManifest() {
	if (existsSync(backupPath)) {
		copyFileSync(backupPath, pkgPath);
		rmSync(backupPath, { force: true });
	}
}

const invokedDirectly =
	typeof process.argv[1] === "string" &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
	const mode = process.argv[2];
	if (mode === "strip") {
		stripPackSelfLink();
	} else if (mode === "restore") {
		restorePackManifest();
	} else {
		console.error("usage: pack-self-link-manifest.mjs strip|restore");
		process.exit(1);
	}
}
