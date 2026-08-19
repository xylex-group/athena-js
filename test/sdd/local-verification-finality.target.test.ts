/**
 * Target suite — local verification is the release SSOT (issue #672).
 * Encodes desired `pnpm test:finality` / `release:verify` / report / publish gate.
 * Must FAIL on current HEAD (no product implementation yet).
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");

const REQUIRED_FINALITY_TESTS = [
	"ownership.test.ts",
	"exports.test.ts",
	"browser-boundary.test.ts",
	"package-install.test.ts",
	"embedded-next.test.ts",
] as const;

const REQUIRED_FINALITY_FIXTURES = [
	"next-embedded",
	"package-consumer",
	"postgres-runtime",
] as const;

const REPORT_CHECK_KEYS = [
	"unit",
	"ownership",
	"exports",
	"browserIsolation",
	"tarballConsumer",
	"postgres",
	"embeddedAuth",
	"nextE2E",
] as const;

const FINALITY_STEPS = [
	{ name: "typecheck", re: /\btypecheck\b/ },
	{ name: "unit/regression", re: /\bunit\b|\bregression\b/ },
	{ name: "ownership", re: /\bownership\b/ },
	{ name: "package build", re: /\bbuild\b/ },
	{ name: "package export tests", re: /\bexports?\b/ },
	{
		name: "browser bundle contamination",
		re: /browser[- ]?(bundle|boundary|isolation|contamination)/i,
	},
	{ name: "create-athena-app fixture", re: /create-athena-app/ },
	{
		name: "packed-tarball consumer",
		re: /tarball|package-consumer|package-install/i,
	},
	{ name: "ephemeral PostgreSQL", re: /postgres|postgresql/i },
	{
		name: "Next.js embedded-runtime E2E",
		re: /embedded-next|next-embedded|nextE2E/i,
	},
	{ name: "cleanup + leak/process", re: /cleanup|leak/i },
] as const;

const NEGATIVE_INVARIANTS = [
	{
		id: "N1",
		re: /RequestClient|request client/i,
		must: /handler root|not.*root/i,
	},
	{
		id: "N2",
		re: /browser/i,
		must: /\bpg\b|server-only/i,
	},
	{
		id: "N3",
		re: /["']\/server["']|exports\[["']\.\/server["']\]/,
		must: /browser/i,
	},
	{
		id: "N4",
		re: /same DATABASE_URL|reuses runtime|reuse.*runtime/i,
		must: /runtime/i,
	},
	{
		id: "N5",
		re: /different DATABASE_URL|new runtime|distinct runtime/i,
		must: /runtime/i,
	},
	{
		id: "N6",
		re: /request context/i,
		must: /mutat|root state/i,
	},
	{
		id: "N7",
		re: /clos(e|ing).*request client/i,
		must: /postgres|pool|runtime/i,
	},
	{
		id: "N8",
		re: /failed auth|poison/i,
		must: /subsequent|later request/i,
	},
] as const;

const HAPPY_PATH = [
	{ name: "createClient root", re: /createClient/ },
	{ name: "Postgres runtime created", re: /postgres|runtime/i },
	{ name: "migrations execute", re: /migrat/i },
	{ name: "embedded Auth boots", re: /embedded.*[Aa]uth|[Aa]uth.*boot/ },
	{ name: "/api/athena mounted", re: /\/api\/athena/ },
	{ name: "/api/auth mounted", re: /\/api\/auth/ },
	{ name: "insert row", re: /\binsert\b/i },
	{ name: "browser-facing client reads row", re: /browser/i },
	{ name: "sign up", re: /sign[- ]?up/i },
	{ name: "sign in", re: /sign[- ]?in/i },
	{ name: "session cookie returned", re: /session cookie|set-cookie/i },
	{ name: "server request resolves session", re: /session/i },
	{ name: "organization created/selected", re: /organiz/i },
	{ name: "organization-scoped query", re: /organiz.*scop|scoped query/i },
] as const;

function readUtf8(path: string): string {
	return readFileSync(path, "utf8");
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readUtf8(path)) as Record<string, unknown>;
}

function walkFiles(dir: string, acc: string[] = []): string[] {
	if (!existsSync(dir)) {
		return acc;
	}
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist") {
			continue;
		}
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			walkFiles(full, acc);
			continue;
		}
		acc.push(full);
	}
	return acc;
}

function collectText(paths: string[]): string {
	return paths
		.filter((p) => existsSync(p) && statSync(p).isFile())
		.map((p) => readUtf8(p))
		.join("\n");
}

const pkg = readJson(join(pkgRoot, "package.json"));
const scripts = (pkg.scripts ?? {}) as Record<string, string>;

function resolveCommandFiles(command: string): string[] {
	const files: string[] = [];
	const re = /(?:\.\/)?(?:scripts|test)\/[A-Za-z0-9._/-]+\.(?:mjs|js|cjs|ts)/g;
	let match: RegExpExecArray | null = re.exec(command);
	while (match) {
		files.push(join(pkgRoot, match[0].replace(/^\.\//, "")));
		match = re.exec(command);
	}
	return files;
}

function requireFinalityCommand(): string {
	const cmd = scripts["test:finality"];
	assert.equal(
		typeof cmd,
		"string",
		"package.json scripts.test:finality must exist",
	);
	assert.ok((cmd ?? "").trim().length > 0, "test:finality must be non-empty");
	return cmd;
}

function finalityImplementationSource(): string {
	const cmd = requireFinalityCommand();
	const files = resolveCommandFiles(cmd);
	const parts = [cmd];
	for (const file of files) {
		assert.equal(
			existsSync(file),
			true,
			`test:finality orchestrator file missing: ${file}`,
		);
		parts.push(readUtf8(file));
	}
	return parts.join("\n");
}

function finalitySuiteSource(): string {
	const finalityDir = join(pkgRoot, "test", "finality");
	const fixtureRoots = REQUIRED_FINALITY_FIXTURES.map((name) =>
		join(pkgRoot, "test", "fixtures", name),
	);
	const files = [
		...walkFiles(finalityDir),
		...fixtureRoots.flatMap((dir) => walkFiles(dir)),
	].filter((p) => /\.(ts|tsx|js|mjs|md|json)$/.test(p));
	return collectText(files);
}

function writerAndOrchestratorSource(): string {
	const scriptHits = walkFiles(join(pkgRoot, "scripts")).filter((p) => {
		if (!/\.(mjs|js|cjs|ts)$/.test(p)) {
			return false;
		}
		const text = readUtf8(p);
		return (
			text.includes("athena-finality.json") ||
			text.includes("browserIsolation") ||
			text.includes("tarballConsumer") ||
			text.includes("test:finality")
		);
	});
	return [finalityImplementationSource(), collectText(scriptHits)].join("\n");
}

test("target: test:finality exists, is deterministic, and does not skip required steps", () => {
	const cmd = requireFinalityCommand();
	assert.doesNotMatch(cmd, /\bskip\b/i);
	assert.doesNotMatch(cmd, /--test-name-pattern/);
	const source = finalityImplementationSource();
	assert.doesNotMatch(source, /t\.skip\(/);
	assert.doesNotMatch(source, /describe\.skip|test\.skip/);
	assert.doesNotMatch(source, /SKIP_FINALITY|FINALITY_SKIP|ATHENA_SKIP_FINALITY/);
	assert.doesNotMatch(
		source,
		/if\s*\(\s*!.*(?:ATHENA_TEST_DATABASE_URL|DATABASE_URL).*(?:skip|return)\s*\)/is,
	);
	assert.doesNotMatch(source, /Math\.random\s*\(/);
	for (const step of FINALITY_STEPS) {
		assert.match(
			source,
			step.re,
			`test:finality must run required step: ${step.name}`,
		);
	}
});

test("target: orchestrator runs the eleven named steps in order and stops on first failure", () => {
	const source = finalityImplementationSource();
	let previous = -1;
	for (const step of FINALITY_STEPS) {
		const match = step.re.exec(source);
		assert.ok(match, `missing ordered step: ${step.name}`);
		const index = match.index ?? -1;
		assert.ok(
			index > previous,
			`step ${step.name} must run after the previous named step`,
		);
		previous = index;
	}
	assert.match(
		source,
		/fail-closed|stop on first failure|process\.exit\(1\)/,
		"orchestrator must fail-closed and stop on first failure",
	);
	assert.doesNotMatch(
		source,
		/continueOnError|continue-on-error|ignoreFailures|best-effort/i,
	);
	assert.doesNotMatch(
		source,
		/run\(resolveBin\(/,
		"run() already resolves bins; double resolve becomes pnpm.cmd.cmd on Windows",
	);
});

test("target: without ATHENA_TEST_DATABASE_URL/DATABASE_URL the suite auto-launches Docker/Podman Postgres or fails (never skip)", () => {
	const source = [
		finalityImplementationSource(),
		finalitySuiteSource(),
		collectText(walkFiles(join(pkgRoot, "test", "fixtures", "postgres-runtime"))),
	].join("\n");
	assert.match(source, /ATHENA_TEST_DATABASE_URL/);
	assert.match(source, /DATABASE_URL/);
	assert.match(source, /\bdocker\b/i);
	assert.match(source, /\bpodman\b/i);
	assert.doesNotMatch(source, /t\.skip\(["'].*(DATABASE_URL|ATHENA_TEST)/);
	assert.match(
		source,
		/ephemeral|auto-launch|launch.*postgres/i,
		"must auto-launch ephemeral Postgres when no URL is set",
	);
	assert.match(
		source,
		/process\.exit\(1\)|throw new Error|fail-closed/,
		"missing Docker/Podman must fail, not skip",
	);
	assert.doesNotMatch(source, /neon\.tech|supabase\.co|hosted postgres/i);
});

test("target: E2E installs packed @xylex-group/athena from .tmp/packages/*.tgz into test/fixtures/next-embedded", () => {
	const source = [finalityImplementationSource(), finalitySuiteSource()].join(
		"\n",
	);
	assert.match(source, /pnpm pack/);
	assert.match(source, /\.tmp\/packages/);
	assert.match(source, /\.tgz/);
	assert.match(source, /@xylex-group\/athena/);
	assert.match(source, /test\/fixtures\/next-embedded/);
	const nextEmbedded = join(pkgRoot, "test", "fixtures", "next-embedded");
	assert.equal(
		existsSync(nextEmbedded),
		true,
		"test/fixtures/next-embedded must exist",
	);
	const consumer = join(pkgRoot, "test", "fixtures", "package-consumer");
	assert.equal(
		existsSync(consumer),
		true,
		"test/fixtures/package-consumer must exist",
	);
	assert.doesNotMatch(
		collectText(walkFiles(nextEmbedded)).replace(
			/node_modules[\s\S]*/g,
			"",
		),
		/from ["']\.\.\/\.\.\/src\//,
	);
});

test("target: test/finality fixtures and tests exist at the specified paths", () => {
	const finalityDir = join(pkgRoot, "test", "finality");
	assert.equal(existsSync(finalityDir), true, "test/finality/ must exist");
	for (const name of REQUIRED_FINALITY_TESTS) {
		assert.equal(
			existsSync(join(finalityDir, name)),
			true,
			`missing test/finality/${name}`,
		);
	}
	for (const name of REQUIRED_FINALITY_FIXTURES) {
		assert.equal(
			existsSync(join(pkgRoot, "test", "fixtures", name)),
			true,
			`missing test/fixtures/${name}`,
		);
	}
});

test("target: embedded-next asserts root → PG → migrations → Auth → routes → insert → browser read → sign up/in → session → org query", () => {
	const embeddedPath = join(
		pkgRoot,
		"test",
		"finality",
		"embedded-next.test.ts",
	);
	assert.equal(existsSync(embeddedPath), true);
	const source = [readUtf8(embeddedPath), finalitySuiteSource()].join("\n");
	for (const step of HAPPY_PATH) {
		assert.match(source, step.re, `embedded-next happy path missing: ${step.name}`);
	}
});

test("target: same suite asserts N1–N8 negative invariants", () => {
	const source = finalitySuiteSource();
	assert.ok(source.length > 0, "test/finality suite sources must exist");
	for (const inv of NEGATIVE_INVARIANTS) {
		assert.match(source, inv.re, `missing invariant ${inv.id}`);
		assert.match(source, inv.must, `incomplete invariant ${inv.id}`);
	}
});

test("target: orchestrator writes .tmp/athena-finality.json with package, version, commit, passed, and required checks", () => {
	const source = writerAndOrchestratorSource();
	assert.match(source, /\.tmp\/athena-finality\.json/);
	for (const key of ["package", "version", "commit", "passed", "checks"]) {
		assert.match(
			source,
			new RegExp(`["']${key}["']`),
			`report writer must emit ${key}`,
		);
	}
	for (const key of REPORT_CHECK_KEYS) {
		assert.match(
			source,
			new RegExp(`["']${key}["']`),
			`report checks must include ${key}`,
		);
	}
});

test("target: release:verify is test:finality && test:tarball && test:examples; red cannot release", () => {
	assert.equal(typeof scripts["test:tarball"], "string");
	assert.equal(typeof scripts["test:examples"], "string");
	const verify = scripts["release:verify"] ?? "";
	assert.match(verify, /test:finality/);
	assert.match(verify, /test:tarball/);
	assert.match(verify, /test:examples/);
	assert.match(
		verify,
		/test:finality\s*&&\s*(?:pnpm\s+)?test:tarball\s*&&\s*(?:pnpm\s+)?test:examples/,
	);
	assert.doesNotMatch(verify, /\|\||continue-on-error/);
});

test("target: prepublishOnly is not weaker than release:verify (P14 superseded)", () => {
	const pre = scripts.prepublishOnly ?? "";
	assert.notEqual(pre, "pnpm check:release");
	assert.match(pre, /release:verify/);
});

test("target: publish.js refuses unless athena-finality.json matches current Git SHA, package version, and passed is true", () => {
	const publish = readUtf8(join(pkgRoot, "scripts", "publish.js"));
	assert.match(publish, /athena-finality\.json/);
	assert.match(publish, /rev-parse/);
	assert.match(publish, /passed/);
	assert.match(publish, /version/);
	assert.match(publish, /commit/);
	assert.match(publish, /process\.exit\(1\)/);
});

test("target: CI mirrors test:finality / release:verify rather than a skip-friendly hosted-PG split", () => {
	const ci = readUtf8(join(repoRoot, ".github", "workflows", "athena-js.yml"));
	assert.match(ci, /test:finality|release:verify/);
	assert.doesNotMatch(
		ci,
		/t\.skip|skip:\s*!LIVE_URI|DATABASE_URL \/ ATHENA_PG_DIRECT_URI required/,
	);

	const publishCi = readUtf8(
		join(repoRoot, ".github", "workflows", "athena-js-publish.yml"),
	);
	assert.match(publishCi, /release:verify|test:finality/);
	assert.match(publishCi, /athena-finality\.json/);
	assert.doesNotMatch(
		publishCi,
		/run:\s*pnpm check:release\s*$/m,
		"publish workflow must not use the weaker check:release gate alone",
	);
});
