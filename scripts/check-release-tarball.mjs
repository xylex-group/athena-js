#!/usr/bin/env node
/**
 * Pack @xylex-group/athena into a temp dir and validate the published artifact.
 * Does not write tarballs into the package working directory.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";

function resolveBin(name) {
	return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(bin, args, options) {
	return execFileSync(resolveBin(bin), args, {
		...options,
		shell: process.platform === "win32",
	});
}

import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	restorePackManifest,
	stripPackSelfLink,
} from "./pack-self-link-manifest.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const ALLOWED_TOP = new Set(["package", "package.json"]);
const _ALLOWED_PREFIXES = [
	"package/dist/",
	"package/bin/",
	"package/README.md",
	"package/LICENSE",
	"package/package.json",
];
const FORBIDDEN = [
	/^package\/src\//,
	/^package\/test\//,
	/^package\/coverage\//,
	/^package\/\.env/,
	/^package\/docs\/sdd\//,
	/^package\/\.git\//,
];

const SECRET_PATTERNS = [
	{ name: "BEGIN PRIVATE KEY", re: /BEGIN [A-Z ]*PRIVATE KEY/ },
	{
		name: "DATABASE_URL assignment",
		re: /DATABASE_URL=(?:postgres|postgresql):\/\/(?!user:password@example)(?!postgres:postgres@)/,
	},
	{
		name: "ATHENA_API_KEY assignment",
		re: /ATHENA_API_KEY=(?!process\.env)(?!your-)(?!publishable)[A-Za-z0-9_-]{16,}/,
	},
	{
		name: "ATHENA_AUTH_SECRET assignment",
		re: /ATHENA_AUTH_SECRET=(?!process\.env)(?!your-)(?!change-me)[A-Za-z0-9_-]{8,}/,
	},
	{ name: "ghp_", re: /ghp_[A-Za-z0-9]{20,}/ },
	{ name: "github_pat_", re: /github_pat_[A-Za-z0-9_]{20,}/ },
	{ name: "npm_", re: /npm_[A-Za-z0-9]{20,}/ },
];

const PLACEHOLDER_ALLOW = [
	"postgresql://user:password@example",
	"postgres://user:password@example",
	"process.env.DATABASE_URL",
	"process.env.ATHENA_API_KEY",
	"your-api-key",
];

const SERVER_ONLY_POISON =
	/Client Component|server-only|should only be used from a Server Component/i;

function fail(message) {
	console.error(`check-release-tarball: ${message}`);
	process.exit(1);
}

function plainEnv() {
	const env = { ...process.env };
	if (typeof env.NODE_OPTIONS === "string" && env.NODE_OPTIONS.length > 0) {
		env.NODE_OPTIONS = env.NODE_OPTIONS.split(/\s+/)
			.filter(
				(token) => token.length > 0 && !/register-server-only/i.test(token),
			)
			.join(" ");
	}
	return env;
}

function walk(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, out);
		} else {
			out.push(full);
		}
	}
	return out;
}

function posixRel(from, file) {
	return relative(from, file).split(sep).join("/");
}

const work = mkdtempSync(join(tmpdir(), "athena-js-tarball-"));
const packDir = join(work, "pack");
const extractDir = join(work, "extract");
mkdirSync(packDir);
mkdirSync(extractDir);

function packEnv() {
	const env = { ...process.env };
	delete env.npm_config_ignore_scripts;
	delete env.NPM_CONFIG_IGNORE_SCRIPTS;
	return env;
}

let report;
try {
	stripPackSelfLink();
	const packedOut = run("pnpm", ["pack", "--pack-destination", packDir], {
		cwd: root,
		encoding: "utf8",
		env: packEnv(),
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	const tarballName = packedOut
		.split(/\s+/)
		.filter((line) => line.endsWith(".tgz"))
		.at(-1);
	if (!tarballName) {
		fail("pnpm pack did not produce a tarball");
	}
	const tarballPath = existsSync(tarballName)
		? tarballName
		: join(packDir, tarballName);
	if (existsSync(tarballPath)) {
		report = { tarballPath };
	} else {
		const listed = readdirSync(packDir);
		const found = listed.find((name) => name.endsWith(".tgz"));
		if (!found) {
			fail(`tarball missing after pack (${packedOut})`);
		}
		report = { tarballPath: join(packDir, found) };
	}

	execFileSync("tar", ["-xzf", report.tarballPath, "-C", extractDir], {
		stdio: ["ignore", "pipe", "pipe"],
	});

	const files = walk(extractDir);
	const relativeFiles = files.map((file) => posixRel(extractDir, file));

	for (const file of relativeFiles) {
		for (const forbidden of FORBIDDEN) {
			if (forbidden.test(file)) {
				fail(`forbidden path in tarball: ${file}`);
			}
		}
		const allowed =
			file === "package/package.json" ||
			file === "package/README.md" ||
			file === "package/LICENSE" ||
			file.startsWith("package/dist/") ||
			file.startsWith("package/bin/");
		if (!(allowed || ALLOWED_TOP.has(file.split("/")[0] ?? ""))) {
			fail(`unexpected path in tarball: ${file}`);
		}
		if (
			!allowed &&
			file.startsWith("package/") &&
			!file.startsWith("package/dist/") &&
			!file.startsWith("package/bin/")
		) {
			fail(`unexpected package content: ${file}`);
		}
	}

	for (const required of [
		"package/package.json",
		"package/README.md",
		"package/LICENSE",
		"package/dist/index.js",
		"package/dist/index.cjs",
		"package/dist/server.js",
		"package/dist/server.cjs",
		"package/dist/server.d.ts",
		"package/dist/next/client.js",
		"package/dist/next/server.js",
		"package/dist/next/session.js",
		"package/bin/athena-js.js",
		"package/bin/bootstrap-logging.js",
	]) {
		if (!relativeFiles.includes(required)) {
			fail(`missing required file: ${required}`);
		}
	}

	const packedRootTypes = readFileSync(
		join(extractDir, "package", "dist", "index.d.ts"),
		"utf8",
	);
	for (const dto of ["AthenaApiKeyRecord", "AthenaPasskeyRecord"]) {
		if (!packedRootTypes.includes(dto)) {
			fail(`packed root declarations missing Auth DTO: ${dto}`);
		}
	}

	const packedPkg = JSON.parse(
		readFileSync(join(extractDir, "package", "package.json"), "utf8"),
	);
	if (packedPkg.name !== pkg.name || packedPkg.version !== pkg.version) {
		fail("packed package.json name/version mismatch");
	}
	if (!packedPkg.exports || typeof packedPkg.exports !== "object") {
		fail("packed package.json missing exports");
	}
	if (
		packedPkg.dependencies != null &&
		Object.hasOwn(packedPkg.dependencies, "@xylex-group/athena")
	) {
		fail(
			"packed package.json must not declare a self-dependency on @xylex-group/athena",
		);
	}
	const serverExport = packedPkg.exports["./server"];
	if (serverExport?.import?.default !== "./dist/server.js") {
		fail('packed package.json missing "./server" export to ./dist/server.js');
	}
	if (serverExport?.require?.types !== "./dist/server.d.cts") {
		fail('packed package.json missing CommonJS types for "./server"');
	}
	if (serverExport.browser) {
		fail('"./server" must not declare a browser condition');
	}

	const optionalPeerModule =
		/\b(?:from|import|require)\s*(?:\(\s*)?["']mollie-api-typescript["']/;
	for (const name of ["index.js", "index.cjs", "browser.js", "browser.cjs"]) {
		const packedEntry = join(extractDir, "package", "dist", name);
		if (!existsSync(packedEntry)) {
			continue;
		}
		const source = readFileSync(packedEntry, "utf8");
		if (optionalPeerModule.test(source)) {
			fail(
				`packed dist/${name} must not import optional peer mollie-api-typescript; inject billing.providers.mollie.sdk or adapter`,
			);
		}
	}

	const secretHits = [];
	for (const file of files) {
		if (statSync(file).size > 2_000_000) {
			continue;
		}
		const text = readFileSync(file, "utf8");
		if (
			PLACEHOLDER_ALLOW.some((token) => text.includes(token)) &&
			!/ghp_|github_pat_|npm_[A-Za-z0-9]{20,}/.test(text)
		) {
			// still scan non-placeholder secrets
		}
		for (const pattern of SECRET_PATTERNS) {
			if (pattern.re.test(text)) {
				const rel = posixRel(extractDir, file);
				const benign = PLACEHOLDER_ALLOW.some((token) => text.includes(token));
				if (pattern.name.startsWith("DATABASE_URL") && benign) {
					continue;
				}
				if (
					pattern.name === "ATHENA_API_KEY=" &&
					text.includes("process.env.ATHENA_API_KEY")
				) {
					continue;
				}
				secretHits.push(`${rel}: ${pattern.name}`);
			}
		}
	}
	if (secretHits.length > 0) {
		fail(`secret-like strings in tarball:\n${secretHits.join("\n")}`);
	}

	const bytes = statSync(report.tarballPath).size;
	const sha256 = createHash("sha256")
		.update(readFileSync(report.tarballPath))
		.digest("hex");
	const sizes = files
		.map((file) => ({
			bytes: statSync(file).size,
			file: posixRel(extractDir, file),
		}))
		.sort((a, b) => b.bytes - a.bytes);

	const metadata = {
		checks: {
			exports: "pass",
			files: "pass",
			secrets: "pass",
		},
		commit: process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
		exports: Object.keys(packedPkg.exports),
		fileCount: files.length,
		largestFiles: sizes.slice(0, 15),
		name: packedPkg.name,
		tarballBytes: bytes,
		tarballSha256: sha256,
		unpackedBytes: sizes.reduce((sum, row) => sum + row.bytes, 0),
		version: packedPkg.version,
	};

	const evidenceDir = join(root, ".release-evidence");
	mkdirSync(evidenceDir, { recursive: true });
	writeFileSync(
		join(evidenceDir, "tarball-report.json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);

	// Isolated ESM + CJS import of the packed artifact.
	const consumer = join(work, "consumer");
	mkdirSync(consumer);
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify(
			{
				dependencies: {
					[pkg.name]: `file:${report.tarballPath}`,
				},
				name: "athena-packed-consumer",
				private: true,
				type: "module",
			},
			null,
			2,
		),
	);
	run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
		cwd: consumer,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const esmProbe = join(consumer, "esm-probe.mjs");
	writeFileSync(
		esmProbe,
		`import { createClient } from "${pkg.name}";
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("ESM createClient missing from()");
console.log("packed-esm:ok");
`,
	);
	// Root Node createClient must run without the server-only stub.
	execFileSync(process.execPath, [esmProbe], {
		cwd: consumer,
		env: plainEnv(),
		stdio: "inherit",
	});

	const cjsDir = join(work, "cjs-consumer");
	mkdirSync(cjsDir);
	writeFileSync(
		join(cjsDir, "package.json"),
		JSON.stringify(
			{
				dependencies: { [pkg.name]: `file:${report.tarballPath}` },
				name: "athena-packed-cjs",
				private: true,
				type: "commonjs",
			},
			null,
			2,
		),
	);
	run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
		cwd: cjsDir,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const cjsProbe = join(cjsDir, "cjs-probe.cjs");
	writeFileSync(
		cjsProbe,
		`const { createClient } = require("${pkg.name}");
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("CJS createClient missing from()");
console.log("packed-cjs:ok");
`,
	);
	execFileSync(process.execPath, [cjsProbe], {
		cwd: cjsDir,
		env: plainEnv(),
		stdio: "inherit",
	});

	const rnProbe = join(consumer, "rn-probe.mjs");
	writeFileSync(
		rnProbe,
		`import * as rn from "${pkg.name}/react-native";
if (!rn || typeof rn !== "object") throw new Error("react-native export empty");
console.log("packed-rn:ok");
`,
	);
	execFileSync(process.execPath, [rnProbe], {
		cwd: consumer,
		env: plainEnv(),
		stdio: "inherit",
	});

	const serverProbe = join(consumer, "server-probe.mjs");
	writeFileSync(
		serverProbe,
		`import { createClient } from "${pkg.name}/server";
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("server createClient missing from()");
if (typeof client.close !== "function") throw new Error("server createClient missing close()");
console.log("packed-server:ok");
`,
	);
	// ./server still imports "server-only"; that probe keeps the stub.
	const serverOnlyRegister = pathToFileURL(
		join(root, "test", "register-server-only-stub.mjs"),
	).href;
	execFileSync(
		process.execPath,
		["--import", serverOnlyRegister, serverProbe],
		{
			cwd: consumer,
			stdio: "inherit",
		},
	);

	const typeSurfaceDir = join(consumer, "create-client-type-surface");
	mkdirSync(typeSurfaceDir);
	const fixtureRoot = join(
		root,
		"test",
		"fixtures",
		"create-client-type-surface",
	);
	writeFileSync(
		join(typeSurfaceDir, "constructor.ts"),
		readFileSync(join(fixtureRoot, "constructor.ts"), "utf8"),
	);
	writeFileSync(
		join(typeSurfaceDir, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					module: "nodenext",
					moduleResolution: "nodenext",
					noEmit: true,
					skipLibCheck: true,
					strict: true,
					target: "ES2022",
				},
				include: ["constructor.ts"],
			},
			null,
			2,
		),
	);
	const tscJs = join(root, "node_modules", "typescript", "lib", "tsc.js");
	if (!existsSync(tscJs)) {
		fail("typescript/lib/tsc.js missing; install package devDependencies");
	}
	execFileSync(process.execPath, [tscJs, "--noEmit", "-p", typeSurfaceDir], {
		cwd: consumer,
		stdio: "inherit",
	});
	const packedServerDts = join(extractDir, "package", "dist", "server.d.ts");
	if (!existsSync(packedServerDts)) {
		fail("packed dist/server.d.ts missing");
	}
	const packedDtsText = walk(join(extractDir, "package", "dist"))
		.filter((file) => file.endsWith(".d.ts"))
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	for (const needle of [
		"createClient",
		"AthenaAuthConfig",
		"autoMigrate",
		"passkey",
		"social",
	]) {
		if (!packedDtsText.includes(needle)) {
			fail(`packed dist/*.d.ts missing constructor surface token: ${needle}`);
		}
	}
	const packedCliBin = join(extractDir, "package", "bin", "athena-js.js");
	if (!existsSync(packedCliBin)) {
		fail("packed bin/athena-js.js missing");
	}
	const cliBin = join(
		consumer,
		"node_modules",
		pkg.name,
		"bin",
		"athena-js.js",
	);
	if (!existsSync(cliBin)) {
		fail(
			"packed consumer missing node_modules/@xylex-group/athena/bin/athena-js.js",
		);
	}
	const cliGates = [
		[],
		["--help"],
		["-v"],
		["migrate", "--help"],
		["migrate", "auth", "sync", "--help"],
	];
	const cliGateEnv = {
		...plainEnv(),
		ATHENA_CLI_LOG: "off",
		ATHENA_HOME: join(work, "packed-cli-gates-home"),
	};
	for (const args of cliGates) {
		execFileSync(process.execPath, [cliBin, ...args], {
			cwd: consumer,
			env: cliGateEnv,
			stdio: "inherit",
		});
	}
	console.log("packed-cli:ok");

	const isolatedCliHome = join(work, "packed-cli-home");
	const oldPackedLog = join(
		isolatedCliHome,
		"logs",
		"athena-js",
		"2000-01-01",
		"20000101T000000.000Z-old-packed-log.jsonl",
	);
	mkdirSync(dirname(oldPackedLog), { recursive: true });
	writeFileSync(
		oldPackedLog,
		`${JSON.stringify({
			exitCode: 0,
			invocationId: "old-packed-log",
			kind: "invocation.finish",
			level: "info",
			outcome: "success",
			schemaVersion: 1,
			sequence: 1,
			timestamp: "2000-01-01T00:00:00.000Z",
			traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		})}\n`,
	);
	const argvSecret = "short-tarball-secret";
	const loggingProbe = spawnSync(
		process.execPath,
		[cliBin, "api-key", "list", "--admin-key", argvSecret, "--help"],
		{
			cwd: consumer,
			encoding: "utf8",
			env: {
				...plainEnv(),
				ATHENA_CLI_LOG: "all",
				ATHENA_CLI_LOG_RETENTION_DAYS: "1",
				ATHENA_HOME: isolatedCliHome,
			},
			timeout: 60_000,
		},
	);
	if (loggingProbe.error || loggingProbe.status !== 0) {
		fail(
			`packed CLI logging probe failed (exit ${loggingProbe.status}):\n${loggingProbe.stderr ?? ""}`,
		);
	}
	const packedLogFiles = walk(join(isolatedCliHome, "logs")).filter((file) =>
		file.endsWith(".jsonl"),
	);
	if (packedLogFiles.length !== 1) {
		fail(
			`packed CLI logging probe expected one JSONL log, found ${packedLogFiles.length}`,
		);
	}
	const packedLogText = packedLogFiles
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	if (packedLogText.includes(argvSecret)) {
		fail("packed CLI logging probe leaked a semantic argv secret");
	}
	const packedLogEvents = packedLogText
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	if (
		packedLogEvents.length === 0 ||
		packedLogEvents.some((event) => event.writer !== "canonical")
	) {
		fail("packed CLI logging probe did not use canonical writer events");
	}
	if (existsSync(oldPackedLog)) {
		fail("packed CLI logging probe did not run automatic retention");
	}
	metadata.checks.packedCliLogging = "pass";
	console.log("packed-cli-logging:ok");

	writeFileSync(
		join(consumer, "athena.config.ts"),
		`import { defineAthenaConfig, generatorEnv } from "${pkg.name}";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL", {
      default: "postgres://127.0.0.1:1/athena_boundary_probe",
    }),
  },
});
`,
	);

	const packedCliConfigCommands = [
		["validate"],
		["auth", "status"],
		["auth", "doctor"],
		["migrate", "status"],
		["generate", "--dry-run"],
		["schema", "snapshot", "--check"],
		["policy", "validate"],
		["doctor"],
	];
	for (const args of packedCliConfigCommands) {
		const label = `packed-cli ${args.join(" ")}`;
		const result = spawnSync(process.execPath, [cliBin, ...args], {
			cwd: consumer,
			encoding: "utf8",
			env: {
				...plainEnv(),
				ATHENA_CLI_LOG: "off",
				ATHENA_HOME: join(work, "packed-cli-config-home"),
			},
			timeout: 60_000,
		});
		const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		if (SERVER_ONLY_POISON.test(text)) {
			fail(`${label} leaked server-only:\n${text}`);
		}
		console.log(`${label}: exit=${result.status}`);
	}
	console.log("packed-cli-config:ok");

	const packedCliJs = walk(join(extractDir, "package", "dist"))
		.filter((file) => /[/\\]cli[/\\]index\.(js|mjs|cjs)$/.test(file))
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	if (
		!packedCliJs.includes(
			"CREATE TABLE IF NOT EXISTS athena_chat_schema_migrations",
		)
	) {
		fail(
			"packed dist/cli is missing Embedded Chat SQL (must be bundled as text, not read from dist/cli/sql)",
		);
	}
	if (
		packedCliJs.includes("dist/cli/sql/0001_chat_runtime_v4.sql") ||
		packedCliJs.includes("join(sqlDir")
	) {
		fail(
			"packed CLI still resolves Embedded Chat SQL via runtime filesystem location",
		);
	}
	metadata.checks.packedChatSqlEmbedded = "pass";
	console.log("packed-chat-sql-embedded:ok");

	const liveUrl = (process.env.DATABASE_URL ?? "").trim();
	const refuseNeon =
		liveUrl.includes("neon.tech") &&
		process.env.ATHENA_BILLING_ISOLATION_PG !== "1";
	if (liveUrl.length > 0 && !refuseNeon) {
		writeFileSync(
			join(consumer, "athena.config.ts"),
			`import { defineAthenaConfig, generatorEnv } from "${pkg.name}";

export default defineAthenaConfig({
  modules: { chat: true },
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
  },
});
`,
		);
		const migrateEnv = { ...plainEnv(), DATABASE_URL: liveUrl };
		const runPackedMigrate = (label) => {
			const result = spawnSync(process.execPath, [cliBin, "migrate"], {
				cwd: consumer,
				encoding: "utf8",
				env: migrateEnv,
				timeout: 120_000,
			});
			const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
			if (result.status !== 0) {
				fail(`${label} failed (exit ${result.status}):\n${text}`);
			}
			return text;
		};
		const first = runPackedMigrate("packed-cli migrate (chat)");
		if (!first.includes("Embedded Auth schema applied")) {
			fail(`packed chat migrate missing Embedded Auth success:\n${first}`);
		}
		if (!first.includes("→ Embedded Chat schema applying")) {
			fail(`packed chat migrate missing Embedded Chat applying:\n${first}`);
		}
		if (!first.includes("Embedded Chat schema applied")) {
			fail(`packed chat migrate missing Embedded Chat success:\n${first}`);
		}
		const second = runPackedMigrate("packed-cli migrate (chat idempotent)");
		if (!second.includes("Embedded Chat schema applied")) {
			fail(`packed chat remigrate missing Embedded Chat success:\n${second}`);
		}
		metadata.checks.packedChatMigrate = "pass";
		console.log("packed-chat-migrate:ok");
	} else {
		metadata.checks.packedChatMigrate = "skipped";
		console.log("packed-chat-migrate:skipped");
	}

	console.log("packed-server-types:ok");

	metadata.checks.packedEsm = "pass";
	metadata.checks.packedCjs = "pass";
	metadata.checks.packedServer = "pass";
	metadata.checks.packedServerTypes = "pass";
	metadata.checks.packedReactNative = "pass";
	metadata.checks.packedCli = "pass";
	metadata.checks.packedCliConfig = "pass";
	writeFileSync(
		join(evidenceDir, "tarball-report.json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);

	console.log(
		`check-release-tarball: ok files=${metadata.fileCount} bytes=${metadata.tarballBytes} sha256=${sha256}`,
	);
} finally {
	restorePackManifest();
	rmSync(work, { force: true, recursive: true });
}
