#!/usr/bin/env node
/**
 * Pack @xylex-group/athena and validate the published type surface with ATTW.
 * The tarball is isolated in a temporary directory and always removed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "athena-js-attw-"));

function resolveBin(name) {
	return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(bin, args, options = {}) {
	return execFileSync(resolveBin(bin), args, {
		cwd: packageRoot,
		shell: process.platform === "win32",
		stdio: "inherit",
		...options,
	});
}

try {
	run("pnpm", ["pack", "--pack-destination", work]);

	const tarballs = readdirSync(work).filter((name) => name.endsWith(".tgz"));
	if (tarballs.length !== 1) {
		throw new Error(
			`attw: expected one packed tarball, found ${tarballs.length}`,
		);
	}

	const tarballPath = join(work, tarballs[0]);
	if (!existsSync(tarballPath)) {
		throw new Error(`attw: packed tarball not found: ${tarballPath}`);
	}

	run("pnpm", ["exec", "attw", tarballPath]);
} finally {
	rmSync(work, { force: true, recursive: true });
}
