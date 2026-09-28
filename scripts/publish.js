import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Only publish credentials — never load DATABASE_URL or other app secrets. */
const PUBLISH_ENV_KEYS = new Set(["NPM_TOKEN", "NODE_AUTH_TOKEN"]);

function stripQuotes(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function loadPublishTokenFromEnvFile(filePath) {
	if (!existsSync(filePath)) {
		return;
	}

	const content = readFileSync(filePath, "utf8");
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
		if (!match) {
			continue;
		}

		const [, key, rawValue] = match;
		if (!PUBLISH_ENV_KEYS.has(key)) {
			continue;
		}
		process.env[key] = stripQuotes(rawValue);
	}
}

for (const fileName of [".env", ".env.local"]) {
	loadPublishTokenFromEnvFile(resolve(process.cwd(), fileName));
}

function takeOtpFromArgv(argv) {
	const extraArgs = [];
	let otp;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--otp") {
			otp = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg.startsWith("--otp=")) {
			otp = arg.slice("--otp=".length);
			continue;
		}
		extraArgs.push(arg);
	}
	return { extraArgs, otp: otp?.trim() ?? "" };
}

function looksLikeNpmAccessToken(value) {
	return /^(npm_|npr_)/i.test(value);
}

function looksLikeAuthenticatorOtp(value) {
	return /^\d{6,8}$/.test(value);
}

function resolvePublishCredentials(argv) {
	const { extraArgs, otp: otpOrTokenFromArgv } = takeOtpFromArgv(argv);
	const otpOrToken = (otpOrTokenFromArgv || process.env.NPM_OTP || "").trim();
	let token = (
		process.env.NODE_AUTH_TOKEN ??
		process.env.NPM_TOKEN ??
		""
	).trim();
	if (!token && looksLikeNpmAccessToken(otpOrToken)) {
		token = otpOrToken;
	}
	let otp = "";
	if (looksLikeAuthenticatorOtp(otpOrToken)) {
		otp = otpOrToken;
	} else if (
		otpOrToken &&
		!looksLikeNpmAccessToken(otpOrToken) &&
		otpOrTokenFromArgv
	) {
		console.error("npm 2FA OTP must be 6–8 digits from the authenticator app.");
		process.exit(1);
	}
	return { extraArgs, otp, token };
}

const FINALITY_PUBLISH_IRRELEVANT_PATHS = new Set([
	"packages/athena-js/scripts/publish.js",
	"packages/athena-js/test/publish-env-allowlist.test.ts",
	"packages/athena-js/test/sdd/local-verification-finality.target.test.ts",
]);

function resolveNpmCliJs() {
	const candidates = [
		join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
		join(
			dirname(process.execPath),
			"..",
			"lib",
			"node_modules",
			"npm",
			"bin",
			"npm-cli.js",
		),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	console.error(
		`Could not find npm-cli.js next to Node at ${process.execPath}.`,
	);
	process.exit(1);
}

function git(args) {
	return spawnSync("git", args, {
		cwd: process.cwd(),
		encoding: "utf8",
		shell: false,
	});
}

function gitStdout(args) {
	const result = git(args);
	if (result.status !== 0) {
		return;
	}
	return (result.stdout ?? "").trim();
}

function posixGitPath(file) {
	return file.replaceAll("\\", "/");
}

function routesGeneratedAtOnly(stamped, head, file) {
	const before = gitStdout(["show", `${stamped}:${file}`]);
	const after = gitStdout(["show", `${head}:${file}`]);
	if (before == null || after == null) {
		return false;
	}
	try {
		const left = JSON.parse(before);
		const right = JSON.parse(after);
		delete left.generatedAt;
		delete right.generatedAt;
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
}

function finalityCommitCoversHead(stamped, head) {
	if (stamped === head) {
		return true;
	}
	const ancestor = git(["merge-base", "--is-ancestor", stamped, head]);
	if (ancestor.status !== 0) {
		return false;
	}
	const changed = gitStdout(["diff", "--name-only", `${stamped}..${head}`]);
	if (changed == null) {
		return false;
	}
	const files = changed === "" ? [] : changed.split(/\r?\n/);
	for (const file of files) {
		const rel = posixGitPath(file);
		if (FINALITY_PUBLISH_IRRELEVANT_PATHS.has(rel)) {
			continue;
		}
		if (
			rel === "packages/athena-js/contracts/auth/routes.generated.json" &&
			routesGeneratedAtOnly(stamped, head, rel)
		) {
			continue;
		}
		return false;
	}
	return true;
}

function finalityReportNeedsRefresh() {
	const reportPath = resolve(process.cwd(), ".tmp/athena-finality.json");
	if (!existsSync(reportPath)) {
		return true;
	}

	try {
		const report = JSON.parse(readFileSync(reportPath, "utf8"));
		const pkg = JSON.parse(
			readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
		);
		const commit = gitStdout(["rev-parse", "HEAD"]);
		return (
			report.version !== pkg.version ||
			commit == null ||
			!finalityCommitCoversHead(report.commit, commit)
		);
	} catch {
		return true;
	}
}

function refreshFinalityReportIfStale() {
	if (!finalityReportNeedsRefresh()) {
		return;
	}

	console.log(
		"Finality report is stale; running `pnpm test:finality` before publishing.",
	);
	const result = spawnSync(
		process.execPath,
		[resolve(process.cwd(), "scripts/run-finality.mjs")],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			shell: false,
			stdio: "inherit",
		},
	);
	if (result.error) {
		console.error(`Could not refresh finality report: ${result.error.message}`);
		process.exit(1);
	}
	if (result.status !== 0) {
		console.error(
			`Finality refresh failed with exit code ${result.status ?? 1}.`,
		);
		process.exit(typeof result.status === "number" ? result.status : 1);
	}
}

function requireFinalityReport() {
	const reportPath = resolve(process.cwd(), ".tmp/athena-finality.json");
	if (!existsSync(reportPath)) {
		console.error(
			"Missing .tmp/athena-finality.json. Run `pnpm test:finality` before publishing.",
		);
		process.exit(1);
	}

	const report = JSON.parse(readFileSync(reportPath, "utf8"));
	const pkg = JSON.parse(
		readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
	);
	const rev = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: process.cwd(),
		encoding: "utf8",
		shell: false,
	});
	if (rev.status !== 0) {
		console.error("git rev-parse HEAD failed; cannot verify finality report.");
		process.exit(1);
	}
	const commit = (rev.stdout || "").trim();
	const requiredChecks = [
		"unit",
		"ownership",
		"exports",
		"browserIsolation",
		"tarballConsumer",
		"postgres",
		"embeddedAuth",
		"nextE2E",
		"nextMinimalGolden",
	];

	if (report.passed !== true) {
		console.error(
			"athena-finality.json passed is not true; refuse to publish.",
		);
		process.exit(1);
	}
	if (report.package !== "@xylex-group/athena") {
		console.error(
			"athena-finality.json package does not match @xylex-group/athena.",
		);
		process.exit(1);
	}
	if (report.version !== pkg.version) {
		console.error(
			`athena-finality.json version ${report.version} does not match package.json ${pkg.version}.`,
		);
		process.exit(1);
	}
	if (!finalityCommitCoversHead(report.commit, commit)) {
		console.error(
			`athena-finality.json commit ${report.commit} does not cover git HEAD ${commit}.`,
		);
		console.error("Run `pnpm test:finality` on this HEAD before publishing.");
		process.exit(1);
	}
	const checks = report.checks ?? {};
	for (const key of requiredChecks) {
		if (checks[key] !== true) {
			console.error(`athena-finality.json checks.${key} is not true.`);
			process.exit(1);
		}
	}
}

refreshFinalityReportIfStale();
requireFinalityReport();

const { extraArgs, otp, token } = resolvePublishCredentials(
	process.argv.slice(2),
);

if (!token) {
	console.error(
		"Missing NPM token. Set NPM_TOKEN or NODE_AUTH_TOKEN (npm_… access token) in .env.local.",
	);
	process.exit(1);
}

const npmCli = resolveNpmCliJs();
const configDir = mkdtempSync(join(tmpdir(), "athena-npm-publish-"));
const userconfig = join(configDir, ".npmrc");
writeFileSync(
	userconfig,
	`registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\n`,
	{ encoding: "utf8", mode: 0o600 },
);

const npmEnv = {
	...process.env,
	NODE_AUTH_TOKEN: token,
	NPM_TOKEN: token,
	npm_config_userconfig: userconfig,
};
delete npmEnv.CI;
delete npmEnv.GITHUB_ACTIONS;
if (!otp) {
	delete npmEnv.NPM_OTP;
}

function runNpm(args, stdio) {
	return spawnSync(process.execPath, [npmCli, ...args], {
		env: npmEnv,
		shell: false,
		stdio,
		encoding: stdio === "inherit" ? undefined : "utf8",
	});
}

try {
	const whoami = runNpm(
		[
			"whoami",
			"--userconfig",
			userconfig,
			"--registry",
			"https://registry.npmjs.org/",
		],
		"pipe",
	);
	const identity = (whoami.stdout ?? "").trim();
	if (whoami.error) {
		console.error(whoami.error.message);
		process.exit(1);
	}
	if (whoami.status !== 0 || !identity) {
		console.error(
			(whoami.stderr ?? "").trim() ||
				"npm whoami failed. NPM_TOKEN is not accepted by registry.npmjs.org.",
		);
		process.exit(typeof whoami.status === "number" ? whoami.status : 1);
	}
	console.log(`Publishing @xylex-group/athena as ${identity}`);

	const publishArgs = [
		"publish",
		"--access",
		"public",
		"--userconfig",
		userconfig,
		"--registry",
		"https://registry.npmjs.org/",
		...(otp ? ["--otp", otp] : []),
		...extraArgs,
	];
	const result = runNpm(publishArgs, "inherit");
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) {
		console.error(
			`Registry refused the publish while authenticated as ${identity}. npm returns 404 when the token cannot write (classic tokens need --otp, or a granular token with Read and Write + bypass 2FA on @xylex-group/athena).`,
		);
	}
	process.exit(typeof result.status === "number" ? result.status : 1);
} finally {
	rmSync(configDir, { force: true, recursive: true });
}
