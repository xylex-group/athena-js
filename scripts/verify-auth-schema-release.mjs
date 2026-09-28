#!/usr/bin/env node
/**
 * Fail-closed: Embedded Auth schema generation is part of runtime compatibility.
 * Changing ATHENA_AUTH_SCHEMA_GENERATION or canonical Auth migrations without
 * bumping @xylex-group/athena (and this lock) must fail release:verify.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(pkgRoot));
const lockPath = join(pkgRoot, "src", "auth", "schema-release.lock.json");

const SCHEMA_FILES = [
	"src/auth/contract/index.ts",
	"src/auth/schema/generation.ts",
	"src/auth/schema/migrations.ts",
	"src/auth/local/authorization-sql.ts",
	"src/auth/local/schema-manifest.ts",
	"src/auth/local/signing-keys-sql.ts",
];

export function readPackageVersion(root = pkgRoot) {
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	return String(pkg.version);
}

export function readAuthSchemaGeneration(root = pkgRoot) {
	const source = readFileSync(
		join(root, "src", "auth", "schema", "migrations.ts"),
		"utf8",
	);
	const versions = [...source.matchAll(/^\s*version:\s*(\d+),?\s*$/gm)].map(
		(match) => Number(match[1]),
	);
	if (
		versions.length === 0 ||
		versions.some((version) => !Number.isInteger(version))
	) {
		throw new Error(
			"Could not read Auth migration versions from the canonical migration catalog.",
		);
	}
	return Math.max(...versions);
}

export function fingerprintCanonicalAuthMigrations(root = pkgRoot) {
	const hash = createHash("sha256");
	for (const relativePath of SCHEMA_FILES) {
		hash.update(relativePath);
		hash.update("\0");
		hash.update(
			readFileSync(join(root, relativePath), "utf8").replace(/\r\n?/g, "\n")
		);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function computeAuthSchemaReleaseState(root = pkgRoot) {
	return {
		authSchemaGeneration: readAuthSchemaGeneration(root),
		canonicalMigrationFingerprint: fingerprintCanonicalAuthMigrations(root),
		packageVersion: readPackageVersion(root),
	};
}

function git(args, cwd) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		return null;
	}
	return (result.stdout || "").trim();
}

function schemaGitPaths() {
	return SCHEMA_FILES.map((file) =>
		relative(repoRoot, join(pkgRoot, file)).replaceAll("\\", "/"),
	);
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

function verifyAgainstGit(state) {
	const committedPkg = git(
		["show", "HEAD:packages/athena-js/package.json"],
		repoRoot,
	);
	if (committedPkg === null) {
		return;
	}
	let committedVersion;
	try {
		committedVersion = String(JSON.parse(committedPkg).version);
	} catch {
		return;
	}
	if (state.packageVersion !== committedVersion) {
		return;
	}
	const paths = schemaGitPaths();
	const dirty = git(["diff", "--name-only", "HEAD", "--", ...paths], repoRoot);
	if (dirty) {
		fail(
			`Auth schema files changed without bumping @xylex-group/athena (${state.packageVersion}).\nChanged:\n${dirty}\nBump the package version and update src/auth/schema-release.lock.json.`,
		);
	}
	const versionNeedle = `"version": "${state.packageVersion}"`;
	const bumpCommit = git(
		[
			"log",
			"-1",
			"--format=%H",
			"-S",
			versionNeedle,
			"--",
			"packages/athena-js/package.json",
		],
		repoRoot,
	);
	if (!bumpCommit) {
		return;
	}
	const later = git(
		["log", "--format=%H", `${bumpCommit}..HEAD`, "--", ...paths],
		repoRoot,
	);
	if (later) {
		fail(
			`Auth schema generation or canonical migrations changed after @xylex-group/athena@${state.packageVersion} was set (${bumpCommit.slice(0, 7)}).\nBump the package version (schema is runtime compatibility) and update src/auth/schema-release.lock.json.`,
		);
	}
}

function main() {
	const write = process.argv.includes("--write");
	const state = computeAuthSchemaReleaseState();
	if (write) {
		writeFileSync(lockPath, `${JSON.stringify(state, null, "\t")}\n`);
		console.log(
			`Wrote ${relative(pkgRoot, lockPath)} for @xylex-group/athena@${state.packageVersion} generation ${state.authSchemaGeneration}.`,
		);
		return;
	}
	let lock;
	try {
		lock = JSON.parse(readFileSync(lockPath, "utf8"));
	} catch (error) {
		fail(
			`Missing or invalid src/auth/schema-release.lock.json (${error instanceof Error ? error.message : error}). Run: node scripts/verify-auth-schema-release.mjs --write`,
		);
	}
	if (lock.packageVersion !== state.packageVersion) {
		fail(
			`src/auth/schema-release.lock.json packageVersion=${lock.packageVersion} does not match package.json ${state.packageVersion}. Update the lock with --write after the version bump.`,
		);
	}
	if (lock.authSchemaGeneration !== state.authSchemaGeneration) {
		fail(
			`ATHENA_AUTH_SCHEMA_GENERATION is ${state.authSchemaGeneration} but schema-release.lock.json has ${lock.authSchemaGeneration}. Schema generation is runtime compatibility: bump @xylex-group/athena and update the lock.`,
		);
	}
	if (
		lock.canonicalMigrationFingerprint !== state.canonicalMigrationFingerprint
	) {
		fail(
			`Canonical Auth migration fingerprint changed without updating src/auth/schema-release.lock.json (and likely without a package version bump).\nexpected ${lock.canonicalMigrationFingerprint}\nactual   ${state.canonicalMigrationFingerprint}`,
		);
	}
	verifyAgainstGit(state);
	console.log(
		`Auth schema release lock ok: @xylex-group/athena@${state.packageVersion} generation ${state.authSchemaGeneration}.`,
	);
}

const invoked =
	Boolean(process.argv[1]) &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
	main();
}
