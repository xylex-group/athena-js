#!/usr/bin/env node
/**
 * Local verification SSOT for @xylex-group/athena.
 * Fail-closed: stop on first failure (process.exit(1)).
 *
 * Ordered steps:
 * 1. typecheck
 * 2. unit / regression and stabilization finality
 * 3. ownership
 * 4. package build
 * 5. package export tests
 * 6. browser bundle contamination
 * 7. create-athena-app fixture
 * 8. packed-tarball consumer / package-install
 * 9. PostgreSQL release proofs
 * 10. Next.js embedded-next / next-embedded / nextE2E
 * 11. packed next-minimal golden-path / social / passkey
 * 12. RN audit + Auth UI export graph + docs/contract drift
 * 13. cleanup + leak / process checks
 *
 * Tracked cells: scripts/finality-matrix.mjs
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
import { assertFinalityMatrixProofs } from "./finality-matrix.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tmpDir = join(root, ".tmp");
const reportPath = join(tmpDir, "athena-finality.json");
const packDir = join(tmpDir, "packages");
const statePath = join(tmpDir, "finality-state.json");

const CHECK_KEYS = [
	"unit",
	"stabilization",
	"ownership",
	"exports",
	"browserIsolation",
	"tarballConsumer",
	"postgres",
	"embeddedAuth",
	"nextE2E",
	"nextMinimalGolden",
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
		throw new Error(
			`git rev-parse HEAD failed: ${result.stderr || result.status}`,
		);
	}
	return (result.stdout || "").trim();
}

function writeReport(passed) {
	mkdirSync(tmpDir, { recursive: true });
	const pkg = readJson(join(root, "package.json"));
	const body = {
		checks: { ...checks },
		commit: gitCommit(),
		package: pkg.name,
		passed: passed,
		version: pkg.version,
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
	if (process.platform !== "win32") {
		return name;
	}
	// Corepack/npm shims are *.cmd; Bun's Windows binary is bun.exe.
	if (name === "bun") {
		return "bun.exe";
	}
	return `${name}.cmd`;
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

function nodeTest(files, options = {}) {
	const forceExit = options.forceExit !== false;
	run(process.execPath, [
		"--import",
		"./test/register-server-only.mjs",
		"--import",
		"tsx",
		...(process.platform === "win32"
			? ["--import", "./test/windows-defer-force-exit.mjs"]
			: []),
		"--test",
		...(forceExit ? ["--test-force-exit"] : []),
		...files,
	]);
}

function refreshAuthSchemaReleaseLock() {
	run(process.execPath, [
		join(root, "scripts", "verify-auth-schema-release.mjs"),
		"--write",
	]);
}

/** pnpm pack name for `@scope/name` + version → `scope-name-version.tgz`. */
function expectedPackTarballName(pkg) {
	const bare = String(pkg.name ?? "")
		.replace(/^@/, "")
		.replace(/\//g, "-");
	if (!bare || typeof pkg.version !== "string" || pkg.version.length === 0) {
		throw new Error(
			"package.json name/version required to resolve packed tarball",
		);
	}
	return `${bare}-${pkg.version}.tgz`;
}

function clearPackedTarballs() {
	if (!existsSync(packDir)) {
		mkdirSync(packDir, { recursive: true });
		return;
	}
	for (const name of readdirSync(packDir)) {
		if (name.endsWith(".tgz")) {
			rmSync(join(packDir, name), { force: true });
		}
	}
}

/**
 * Fail-closed: install the tarball that matches package.json version.
 * Do not use lexicographic "last .tgz" — unversioned `xylex-group-athena.tgz`
 * sorts after `…-5.4.0.tgz` and can leave fixtures on a stale pack.
 */
function latestTarball() {
	if (!existsSync(packDir)) {
		throw new Error("missing .tmp/packages after pnpm pack");
	}
	const pkg = readJson(join(root, "package.json"));
	const expected = expectedPackTarballName(pkg);
	const path = join(packDir, expected);
	if (!existsSync(path)) {
		const found = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
		throw new Error(
			`missing packed tarball ${expected} in .tmp/packages (found: ${found.join(", ") || "none"})`,
		);
	}
	return path;
}

/** Committed fixture manifests restored after packed installs (avoid leftover churn). */
const fixtureSnapshots = new Map();

function snapshotFixtureTree(fixtureDir) {
	const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
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

function rewriteFileDep(manifestPath, tarballPath, extraDeps = {}) {
	const manifest = readJson(manifestPath);
	manifest.dependencies = {
		...manifest.dependencies,
		"@xylex-group/athena": `file:${tarballPath.replace(/\\/g, "/")}`,
		...extraDeps,
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Isolated fixture workspace. pnpm 11 reads allowBuilds from
 * pnpm-workspace.yaml (not package.json / .npmrc). --ignore-workspace
 * skips this file and fails with ERR_PNPM_IGNORED_BUILDS on esbuild
 * (tsx → esbuild postinstall; strictDepBuilds defaults true).
 */
const FIXTURE_PNPM_WORKSPACE = `packages:
  - "."
allowBuilds:
  esbuild: true
shamefullyHoist: true
ignoreWorkspaceRootCheck: true
`;

function installPackedConsumer(fixtureDir, tarballPath, extraDeps = {}) {
	snapshotFixtureTree(fixtureDir);
	rewriteFileDep(join(fixtureDir, "package.json"), tarballPath, extraDeps);
	writeFileSync(
		join(fixtureDir, "pnpm-workspace.yaml"),
		FIXTURE_PNPM_WORKSPACE,
	);
	rmSync(join(fixtureDir, "node_modules"), { force: true, recursive: true });
	rmSync(join(fixtureDir, "pnpm-lock.yaml"), { force: true });
	run("pnpm", ["install"], {
		cwd: fixtureDir,
		env: { CI: "true" },
	});
}

function generateCreateAthenaAppFixture() {
	const nextEmbedded = join(root, "test", "fixtures", "next-embedded");
	const nextMinimalGolden = join(
		root,
		"test",
		"fixtures",
		"next-minimal-golden",
	);
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
	const goldenRequired = [
		...required,
		"athena.config.ts",
		"athena/migrations/0001_next_minimal_auth_directory.sql",
		"server.mjs",
	];
	for (const rel of goldenRequired) {
		if (!existsSync(join(nextMinimalGolden, rel))) {
			failClosed(`next-minimal golden-path fixture missing ${rel}`);
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
	const url = (result.stdout || "")
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.at(-1);
	if (!(url && /^postgres(ql)?:\/\//i.test(url))) {
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

function runAuthUi(args) {
	const authUi = join(root, "..", "athena-auth-ui");
	run("bun", args, { cwd: authUi });
}

function runAuthUiExportTests() {
	// Auth UI pins packageManager bun@1.2.15. pnpm exec in that cwd fails
	// Corepack with "Unsupported package manager specification (bun@…)".
	runAuthUi([
		"x",
		"vitest",
		"run",
		"--config",
		"vitest.release.config.ts",
		"tests/public-export-graph.test.ts",
		"tests/export-boundary.test.ts",
	]);
}

try {
	refreshAuthSchemaReleaseLock();
	assertFinalityMatrixProofs(root);
	mkdirSync(tmpDir, { recursive: true });
	mkdirSync(packDir, { recursive: true });

	// 1. typecheck
	run("pnpm", ["typecheck"]);
	checks.unit = false;

	// 2. unit / regression
	run("pnpm", ["test"], {
		env: {
			ATHENA_AUTH_FINALITY_DATABASE_URL: "",
			ATHENA_BILLING_FINALITY_DATABASE_URL: "",
			ATHENA_LOCAL_RUNTIME_PG_URI: "",
			ATHENA_PG_DIRECT_URI: "",
			ATHENA_TEST_DATABASE_URL: "",
			DATABASE_URL: "",
		},
	});
	checks.unit = true;
	run("pnpm", ["test:stabilization-finality"]);
	checks.stabilization = true;

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
	nodeTest(["test/finality/cli-boundary.test.ts"]);
	run("pnpm", ["test:browser-bundle"]);
	run(process.execPath, ["scripts/audit-runtime-boundaries.mjs"]);
	run(process.execPath, ["scripts/test-package-node-import.mjs"]);
	run("pnpm", ["audit:rn"]);
	runAuthUiExportTests();
	checks.browserIsolation = true;

	// 7. create-athena-app fixture
	generateCreateAthenaAppFixture();

	// 8. packed-tarball consumer
	clearPackedTarballs();
	run(process.execPath, [
		join(root, "scripts", "pack-self-link-manifest.mjs"),
		"strip",
	]);
	try {
		run("pnpm", ["pack", "--pack-destination", packDir], {
			env: {
				NPM_CONFIG_IGNORE_SCRIPTS: "false",
				npm_config_ignore_scripts: "false",
			},
		});
	} finally {
		run(process.execPath, [
			join(root, "scripts", "pack-self-link-manifest.mjs"),
			"restore",
		]);
	}
	const tarball = latestTarball();
	const authUiRoot = join(root, "..", "athena-auth-ui");
	runAuthUi(["run", "build"]);
	runAuthUi(["pm", "pack", "--destination", packDir]);
	const authUiPkg = readJson(join(authUiRoot, "package.json"));
	const authUiTarball = join(packDir, expectedPackTarballName(authUiPkg));
	if (!existsSync(authUiTarball)) {
		failClosed(`missing packed Auth UI tarball ${authUiTarball}`);
	}
	const authUiFileDep = {
		"@xylex-group/athena-auth-ui": `file:${authUiTarball.replace(/\\/g, "/")}`,
	};
	installPackedConsumer(
		join(root, "test", "fixtures", "package-consumer"),
		tarball,
	);
	installPackedConsumer(
		join(root, "test", "fixtures", "next-embedded"),
		tarball,
	);
	installPackedConsumer(
		join(root, "test", "fixtures", "next-minimal-golden"),
		tarball,
		authUiFileDep,
	);
	const expoRn53 = join(root, "test", "fixtures", "expo-rn53");
	installPackedConsumer(expoRn53, tarball);
	run("pnpm", ["check"], { cwd: expoRn53 });
	nodeTest(["test/finality/package-install.test.ts"]);
	nodeTest(["test/finality/package-finality.test.ts"]);
	nodeTest(["test/finality/next-webpack-package.test.ts"]);
	run("pnpm", ["test:tarball"]);
	checks.tarballConsumer = true;

	// 9. ephemeral PostgreSQL (ATHENA_TEST_DATABASE_URL | DATABASE_URL | docker/podman)
	const databaseUrl = launchPostgres();
	process.env.ATHENA_TEST_DATABASE_URL = databaseUrl;
	process.env.ATHENA_AUTH_FINALITY_DATABASE_URL = databaseUrl;
	process.env.ATHENA_BILLING_FINALITY_DATABASE_URL = databaseUrl;
	process.env.DATABASE_URL = databaseUrl;
	checks.postgres = true;
	run("pnpm", ["test:billing-release"]);
	run("pnpm", ["test:auth-schema-release"]);

	// 10. Next.js embedded-runtime E2E against the public packed package
	nodeTest(["test/finality/embedded-next.test.ts"]);
	checks.embeddedAuth = true;
	checks.nextE2E = true;

	// 11. packed next-minimal golden-path (empty Postgres, Auth-first migrate)
	nodeTest(["test/finality/next-minimal-golden-path.test.ts"], {
		forceExit: process.platform !== "win32",
	});
	nodeTest(["test/finality/next-minimal-golden-social.test.ts"], {
		forceExit: process.platform !== "win32",
	});
	nodeTest(["test/finality/next-minimal-golden-passkey.test.ts"], {
		forceExit: process.platform !== "win32",
	});
	nodeTest(["test/finality/next-minimal-golden-auth-ui-pack.test.ts"], {
		forceExit: process.platform !== "win32",
	});
	nodeTest(["test/finality/packed-transport-topology.test.ts"], {
		forceExit: process.platform !== "win32",
	});
	nodeTest(["test/finality/token-key-store-postgres.test.ts"], {
		forceExit: process.platform !== "win32",
	});
	checks.nextMinimalGolden = true;

	run("pnpm", ["docs:check"]);

	// 12. cleanup + leak / process checks
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
