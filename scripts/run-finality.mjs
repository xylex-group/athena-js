#!/usr/bin/env node
/**
 * Local verification SSOT for @xylex-group/athena.
 * Fail-closed: stop on first failure (process.exit(1)).
 *
 * Ordered steps:
 * 1. typecheck
 * 2. unit / regression
 * 3. ownership
 * 4. package build
 * 5. package export tests
 * 6. browser bundle contamination
 * 7. create-athena-app fixture
 * 8. packed-tarball consumer / package-install
 * 9. ephemeral PostgreSQL
 * 10. Next.js embedded-next / next-embedded / nextE2E
 * 11. cleanup + leak / process checks
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tmpDir = join(root, ".tmp");
const reportPath = join(tmpDir, "athena-finality.json");
const packDir = join(tmpDir, "packages");
const statePath = join(tmpDir, "finality-state.json");

const CHECK_KEYS = [
	"unit",
	"ownership",
	"exports",
	"browserIsolation",
	"tarballConsumer",
	"postgres",
	"embeddedAuth",
	"nextE2E",
];

/** @type {Record<string, boolean>} */
const checks = Object.fromEntries(CHECK_KEYS.map((key) => [key, false]));

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function gitCommit() {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		throw new Error(`git rev-parse HEAD failed: ${result.stderr || result.status}`);
	}
	return (result.stdout || "").trim();
}

function writeReport(passed) {
	mkdirSync(tmpDir, { recursive: true });
	const pkg = readJson(join(root, "package.json"));
	const body = {
		"package": pkg.name,
		"version": pkg.version,
		"commit": gitCommit(),
		"passed": passed,
		"checks": { ...checks },
	};
	const tmp = `${reportPath}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
	writeFileSync(reportPath, readFileSync(tmp));
	rmSync(tmp, { force: true });
}

function failClosed(message) {
	destroyPostgres();
	restoreFixtureTrees();
	writeReport(false);
	console.error(`test:finality fail-closed: ${message}`);
	process.exit(1);
}

function resolveBin(name) {
	if (
		name.includes("/") ||
		name.includes("\\") ||
		name.endsWith(".exe") ||
		name.endsWith(".cmd") ||
		name.endsWith(".bat")
	) {
		return name;
	}
	return process.platform === "win32" ? `${name}.cmd` : name;
}

function windowsNeedsShell(bin) {
	if (process.platform !== "win32") {
		return false;
	}
	// Absolute Node / *.exe paths often contain "Program Files".
	return !(bin.includes(" ") || bin.endsWith(".exe"));
}

function run(bin, args, options = {}) {
	const { cwd = root, env, ...rest } = options;
	const resolved = resolveBin(bin);
	const result = spawnSync(resolved, args, {
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		shell: windowsNeedsShell(resolved),
		stdio: "inherit",
		...rest,
	});
	if (result.status !== 0) {
		failClosed(`${bin} ${args.join(" ")} exited ${result.status}`);
	}
	return result;
}

function nodeTest(files) {
	run(process.execPath, [
		"--import",
		"./test/register-server-only.mjs",
		"--import",
		"tsx",
		"--test",
		"--test-force-exit",
		...files,
	]);
}

function latestTarball() {
	if (!existsSync(packDir)) {
		throw new Error("missing .tmp/packages after pnpm pack");
	}
	const tgz = readdirSync(packDir)
		.filter((name) => name.endsWith(".tgz"))
		.sort();
	if (tgz.length === 0) {
		throw new Error("pnpm pack produced no .tgz in .tmp/packages");
	}
	return join(packDir, tgz[tgz.length - 1]);
}

/** Committed fixture manifests restored after packed installs (avoid leftover churn). */
const fixtureSnapshots = new Map();

function snapshotFixtureTree(fixtureDir) {
	const files = ["package.json", "pnpm-lock.yaml"];
	/** @type {Record<string, string | null>} */
	const snapshot = {};
	for (const name of files) {
		const path = join(fixtureDir, name);
		snapshot[name] = existsSync(path) ? readFileSync(path, "utf8") : null;
	}
	fixtureSnapshots.set(fixtureDir, snapshot);
}

function restoreFixtureTrees() {
	for (const [fixtureDir, snapshot] of fixtureSnapshots.entries()) {
		for (const [name, content] of Object.entries(snapshot)) {
			const path = join(fixtureDir, name);
			if (content === null) {
				rmSync(path, { force: true });
			} else {
				writeFileSync(path, content);
			}
		}
	}
	fixtureSnapshots.clear();
}

function rewriteFileDep(manifestPath, tarballPath) {
	const manifest = readJson(manifestPath);
	manifest.dependencies = {
		...manifest.dependencies,
		"@xylex-group/athena": `file:${tarballPath.replace(/\\/g, "/")}`,
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function installPackedConsumer(fixtureDir, tarballPath) {
	snapshotFixtureTree(fixtureDir);
	rewriteFileDep(join(fixtureDir, "package.json"), tarballPath);
	rmSync(join(fixtureDir, "node_modules"), { force: true, recursive: true });
	rmSync(join(fixtureDir, "pnpm-lock.yaml"), { force: true });
	run("pnpm", ["install", "--ignore-workspace"], {
		cwd: fixtureDir,
	});
}

function generateCreateAthenaAppFixture() {
	const nextEmbedded = join(root, "test", "fixtures", "next-embedded");
	const required = [
		"lib/athena/root.ts",
		"lib/athena/server.ts",
		"lib/athena/browser.ts",
		"app/api/athena/[...path]/route.ts",
		"app/api/auth/[...all]/route.ts",
		"package.json",
	];
	for (const rel of required) {
		if (!existsSync(join(nextEmbedded, rel))) {
			failClosed(`create-athena-app fixture missing ${rel}`);
		}
	}
	const generator = join(
		root,
		"..",
		"create-athena-app",
		"bin",
		"create-athena-app.mjs",
	);
	if (existsSync(generator)) {
		const help = spawnSync(process.execPath, [generator, "--help"], {
			cwd: root,
			encoding: "utf8",
			shell: false,
		});
		if (help.status !== 0) {
			failClosed("create-athena-app --help failed");
		}
	}
}

function launchPostgres() {
	const launcher = join(
		root,
		"test",
		"fixtures",
		"postgres-runtime",
		"launch.mjs",
	);
	const result = spawnSync(process.execPath, [launcher, "up"], {
		cwd: root,
		encoding: "utf8",
		env: process.env,
		shell: false,
	});
	if (result.status !== 0) {
		failClosed(
			`ephemeral PostgreSQL launch failed: ${result.stderr || result.stdout || result.status}`,
		);
	}
	const url = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1);
	if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
		failClosed("postgres-runtime did not print a postgres:// URI");
	}
	return url;
}

function destroyPostgres() {
	const launcher = join(
		root,
		"test",
		"fixtures",
		"postgres-runtime",
		"launch.mjs",
	);
	spawnSync(process.execPath, [launcher, "down"], {
		cwd: root,
		env: process.env,
		shell: false,
		stdio: "inherit",
	});
}

function assertNoLeakedFixtureProcesses(serverPid) {
	if (serverPid) {
		try {
			process.kill(serverPid, 0);
			try {
				process.kill(serverPid, "SIGTERM");
			} catch {
				// already gone
			}
			failClosed(`leaked next-embedded process ${serverPid}`);
		} catch {
			// ESRCH — process is gone
		}
	}
	if (existsSync(statePath)) {
		const state = readJson(statePath);
		if (state.ephemeral && state.containerName) {
			failClosed(
				`leaked ${state.engine || "docker"} container ${state.containerName}`,
			);
		}
	}
}

try {
	mkdirSync(tmpDir, { recursive: true });
	mkdirSync(packDir, { recursive: true });

	// 1. typecheck
	run("pnpm", ["typecheck"]);
	checks.unit = false;

	// 2. unit / regression
	run("pnpm", ["test"]);
	checks.unit = true;

	// 3. ownership
	nodeTest(["test/finality/ownership.test.ts"]);
	checks.ownership = true;

	// 4. package build
	run("pnpm", ["build"]);

	// 5. package export tests
	nodeTest(["test/finality/exports.test.ts"]);
	run("pnpm", ["check:exports"]);
	checks.exports = true;

	// 6. browser bundle contamination
	nodeTest(["test/finality/browser-boundary.test.ts"]);
	run("pnpm", ["test:browser-bundle"]);
	checks.browserIsolation = true;

	// 7. create-athena-app fixture
	generateCreateAthenaAppFixture();

	// 8. packed-tarball consumer
	run("pnpm", ["pack", "--pack-destination", packDir]);
	const tarball = latestTarball();
	installPackedConsumer(join(root, "test", "fixtures", "package-consumer"), tarball);
	installPackedConsumer(join(root, "test", "fixtures", "next-embedded"), tarball);
	nodeTest(["test/finality/package-install.test.ts"]);
	checks.tarballConsumer = true;

	// 9. ephemeral PostgreSQL (ATHENA_TEST_DATABASE_URL | DATABASE_URL | docker/podman)
	const databaseUrl = launchPostgres();
	process.env.ATHENA_TEST_DATABASE_URL = databaseUrl;
	process.env.DATABASE_URL = databaseUrl;
	checks.postgres = true;

	// 10. Next.js embedded-runtime E2E against the public packed package
	nodeTest(["test/finality/embedded-next.test.ts"]);
	checks.embeddedAuth = true;
	checks.nextE2E = true;

	// 11. cleanup + leak / process checks
	destroyPostgres();
	assertNoLeakedFixtureProcesses(undefined);
	restoreFixtureTrees();

	const passed = CHECK_KEYS.every((key) => checks[key] === true);
	if (!passed) {
		failClosed("one or more report checks remained false");
	}
	writeReport(true);
	console.log(`test:finality wrote ${reportPath}`);
} catch (error) {
	failClosed(error instanceof Error ? error.message : String(error));
}
