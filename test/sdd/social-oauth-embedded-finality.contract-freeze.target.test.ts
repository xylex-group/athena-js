/**
 * Slice 01 TARGET — Track C social OAuth docs contract freeze + P1 combined SSOT.
 *
 * DESIRED: Track C pack + combined `athena-auth-runtime-finality` pack are
 * committable in-tree SSOT at CURRENT HEAD d1ac057be86c58170423a7e2461589604e7a55db;
 * remainder **11** (7 passkey + 4 social); Track C opened; four social routes
 * last route-level embedded gap; GET /list-accounts not a Track C gap;
 * one client / session / account; fail-closed; durable security state.
 *
 * RED on CURRENT while packs are gitignored (root /docs/sdd and
 * docs/sdd glob PHASE-0-FREEZE.md) even if working-tree files exist. GREEN after
 * gitignore exceptions + pack write. No product src. Never `pnpm test:sdd`.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/01-contract-freeze.md
 *       docs/sdd/xylex/athena-auth-runtime-finality/specs/01-p1-program-freeze.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-embedded-finality.contract-freeze.baseline.test.ts
 *   test/sdd/social-oauth-embedded-finality.contract-freeze.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const packDir = join(
	repoRoot,
	"docs",
	"sdd",
	"xylex",
	"athena-social-oauth-embedded-finality",
);
const combinedDir = join(
	repoRoot,
	"docs",
	"sdd",
	"xylex",
	"athena-auth-runtime-finality",
);
const remainderPath = join(
	repoRoot,
	"docs",
	"sdd",
	"xylex",
	"athena-embedded-auth-remainder.md",
);
const gitignorePath = join(repoRoot, ".gitignore");
const passkeyReadmePath = join(
	repoRoot,
	"docs",
	"sdd",
	"xylex",
	"athena-passkey-runtime-finality",
	"README.md",
);
const passkeyReportPath = join(
	repoRoot,
	"docs",
	"sdd",
	"xylex",
	"athena-passkey-runtime-finality",
	"REPORT.md",
);

const CURRENT_HEAD = "d1ac057be86c58170423a7e2461589604e7a55db";
const STALE_REMAINDER_PIN = "f2e2ed678ae19e815d5b40ce5f15427cdb12209b";

const PACK_FILES = [
	"README.md",
	"SPEC.md",
	"PHASE-0-FREEZE.md",
	"specs/01-contract-freeze.md",
] as const;

const COMBINED_FILES = [
	"README.md",
	"SPEC.md",
	"PHASE-0-FREEZE.md",
	"specs/01-p1-program-freeze.md",
] as const;

const MATRIX_STUBS = [
	"matrices/provider.md",
	"matrices/route.md",
	"matrices/security.md",
	"matrices/collision.md",
	"matrices/session.md",
] as const;

const GITIGNORE_UNIGNORE = [
	"!docs/sdd/xylex/athena-social-oauth-embedded-finality/PHASE-0-FREEZE.md",
	"!docs/sdd/xylex/athena-auth-runtime-finality/PHASE-0-FREEZE.md",
] as const;

const FOUR_SOCIAL_ROUTES = [
	"GET /callback/{provider}",
	"POST /sign-in/social",
	"POST /link-social",
	"POST /unlink-account",
] as const;

const FORBIDDEN_CLIENTS = [
	"createSocialClient",
	"createOAuthClient",
] as const;

function readPack(rel: string): string {
	const path = join(packDir, rel);
	assert.equal(existsSync(path), true, `missing pack file ${rel}`);
	return readFileSync(path, "utf8");
}

function readCombined(rel: string): string {
	const path = join(combinedDir, rel);
	assert.equal(existsSync(path), true, `missing combined file ${rel}`);
	return readFileSync(path, "utf8");
}

function isGitIgnored(repoRelative: string): boolean {
	const result = spawnSync("git", ["check-ignore", "-q", repoRelative], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	return result.status === 0;
}

test("T-SOC-PACK: program pack README / SPEC / PHASE-0-FREEZE / slice 01 exist at CURRENT HEAD", () => {
	assert.equal(
		existsSync(packDir),
		true,
		`missing Track C pack dir ${packDir}`,
	);
	for (const rel of PACK_FILES) {
		assert.equal(
			existsSync(join(packDir, rel)),
			true,
			`missing pack file ${rel}`,
		);
	}
	const spec = readPack("SPEC.md");
	const slice = readPack("specs/01-contract-freeze.md");
	const readme = readPack("README.md");
	const freeze = readPack("PHASE-0-FREEZE.md");
	for (const [name, text] of [
		["SPEC.md", spec],
		["specs/01-contract-freeze.md", slice],
		["README.md", readme],
		["PHASE-0-FREEZE.md", freeze],
	] as const) {
		assert.match(
			text,
			/athena-social-oauth-embedded-finality/,
			`${name} must name the Track C slug`,
		);
		assert.match(
			text,
			new RegExp(CURRENT_HEAD),
			`${name} must pin CURRENT HEAD ${CURRENT_HEAD}`,
		);
	}
	assert.match(spec, /adr_needed=false|None this freeze/i);
	assert.equal(
		/pnpm test:sdd/.test(`${spec}\n${slice}`) &&
			/never `pnpm test:sdd`|Never `pnpm test:sdd`/i.test(
				`${spec}\n${slice}\n${readme}`,
			),
		true,
		"pack must host dual-suite files only and forbid pnpm test:sdd",
	);
});

test("T-SOC-LAST-GAP: four social routes named as last route-level embedded gap", () => {
	const spec = `${readPack("SPEC.md")}\n${readPack("specs/01-contract-freeze.md")}`;
	assert.match(spec, /last route-level embedded gap/i);
	for (const route of FOUR_SOCIAL_ROUTES) {
		assert.equal(
			spec.includes(route),
			true,
			`pack must name ${route} as a Track C gap`,
		);
	}
	assert.match(spec, /GET \/list-accounts/);
	assert.match(spec, /not a Track C gap/i);
	assert.match(
		spec,
		/11/,
		"pack must record live inventory of 11 KNOWN_MISSING_IN_LOCAL routes",
	);
});

test("T-SOC-REMAINDER: remainder re-frozen at CURRENT HEAD with 11 gaps and Track C opened", () => {
	assert.equal(existsSync(remainderPath), true, "remainder pointer must exist");
	const remainder = readFileSync(remainderPath, "utf8");
	assert.match(
		remainder,
		new RegExp(CURRENT_HEAD),
		"remainder must pin live HEAD d1ac057be86c58170423a7e2461589604e7a55db",
	);
	assert.match(remainder, /\*\*11\*\*/);
	assert.match(remainder, /7 passkey \+ 4 social/);
	assert.match(remainder, /athena-social-oauth-embedded-finality/);
	assert.equal(
		remainder.includes(STALE_REMAINDER_PIN) && /stale/i.test(remainder),
		true,
		"remainder must mark f2e2ed678 / 15 gaps as stale",
	);
	assert.equal(
		remainder.includes("*not opened*"),
		false,
		"Track C must no longer be marked not opened",
	);
	for (const route of FOUR_SOCIAL_ROUTES) {
		assert.equal(
			remainder.includes(route),
			true,
			`remainder must list live Track C gap ${route}`,
		);
	}
	assert.match(remainder, /GET \/list-accounts/);
	assert.match(remainder, /not.*Track C gap/i);
});

test("T-SOC-CONSUMER: public consumer remains athena.auth.social.* and athena.auth.account.*", () => {
	const spec = `${readPack("SPEC.md")}\n${readPack("specs/01-contract-freeze.md")}`;
	assert.match(spec, /athena\.auth\.social\.\*/);
	assert.match(spec, /athena\.auth\.account\.\*/);
	assert.match(spec, /athena\.auth\.callback\.provider/);
});

test("T-SOC-ORACLE: Rust services/athena-auth is the behavioral oracle", () => {
	const spec = `${readPack("SPEC.md")}\n${readPack("specs/01-contract-freeze.md")}`;
	assert.match(spec, /behavioral oracle/i);
	assert.match(spec, /services\/athena-auth/);
});

test("T-SOC-NO-NS: pack forbids createSocialClient / second OAuth public surface", () => {
	const spec = `${readPack("SPEC.md")}\n${readPack("specs/01-contract-freeze.md")}`;
	for (const name of FORBIDDEN_CLIENTS) {
		assert.match(
			spec,
			new RegExp(name),
			`pack must name and forbid ${name}`,
		);
	}
	assert.match(spec, /second OAuth public surface/i);
	const indexSrc = readFileSync(join(pkgRoot, "src", "index.ts"), "utf8");
	const v3Src = readFileSync(join(pkgRoot, "src", "v3-client.ts"), "utf8");
	for (const name of FORBIDDEN_CLIENTS) {
		assert.equal(
			indexSrc.includes(name),
			false,
			`${name} must not be exported from package root`,
		);
		assert.equal(
			v3Src.includes(name),
			false,
			`${name} must not appear on createClient`,
		);
	}
	assert.equal(
		/\bathena\.oauth\b/.test(indexSrc),
		false,
		"package root must not grow an athena.oauth second public surface",
	);
});

test("T-SOC-UI: Auth UI already consumes link/unlink/callback so backend parity unlocks existing UI", () => {
	const spec = `${readPack("SPEC.md")}\n${readPack("specs/01-contract-freeze.md")}`;
	assert.match(spec, /Auth UI already consumes/i);
	assert.match(spec, /\/link-social/);
	assert.match(spec, /\/unlink-account/);
	assert.match(spec, /callback\.provider/);
	const uiClient = readFileSync(
		join(
			repoRoot,
			"packages",
			"athena-auth-ui",
			"src",
			"lib",
			"athena",
			"better-auth-adapter.ts",
		),
		"utf8",
	);
	assert.match(uiClient, /endpoint: "\/link-social"/);
	assert.match(uiClient, /endpoint: "\/unlink-account"/);
	const catalog = readFileSync(
		join(
			repoRoot,
			"packages",
			"athena-auth-ui",
			"src",
			"components",
			"auth",
			"workspace",
			"sdk-method-catalog.ts",
		),
		"utf8",
	);
	assert.match(catalog, /callback\.provider/);
	const linked = readFileSync(
		join(
			repoRoot,
			"packages",
			"athena-auth-ui",
			"src",
			"components",
			"auth",
			"settings",
			"security",
			"linked-account.tsx",
		),
		"utf8",
	);
	assert.match(linked, /useAthenaSocialAuth/);
});

test("T-SOC-MATRICES: provider / route / security / collision / session stubs exist", () => {
	for (const rel of MATRIX_STUBS) {
		const path = join(packDir, rel);
		assert.equal(existsSync(path), true, `missing matrix stub ${rel}`);
		const text = readFileSync(path, "utf8");
		assert.match(text, /athena-social-oauth-embedded-finality/);
		assert.match(text, new RegExp(CURRENT_HEAD));
	}
});

test("T-SOC-COMBINED: parent program pack sequences P2-P15 then O1-O20 / PR 1-15", () => {
	assert.equal(existsSync(combinedDir), true, "missing combined pack dir");
	for (const rel of COMBINED_FILES) {
		const text = readCombined(rel);
		assert.match(text, /athena-auth-runtime-finality/);
		assert.match(text, new RegExp(CURRENT_HEAD));
	}
	const spec = readCombined("SPEC.md");
	const readme = readCombined("README.md");
	assert.match(spec, /P2/);
	assert.match(spec, /P15/);
	assert.match(spec, /O1/);
	assert.match(spec, /O20/);
	assert.match(spec, /PR 1/);
	assert.match(spec, /\*\*15\*\*/);
	assert.match(readme, /one client/i);
	assert.match(readme, /one session owner/i);
	assert.match(readme, /one account model/i);
	assert.match(readme, /fail-closed/i);
	assert.match(readme, /durable security state/i);
	assert.match(spec, /createPasskeyClient/);
	assert.match(spec, /createOAuthClient/);
	assert.match(spec, /createSocialClient/);
	assert.match(spec, /athena\.oauth/);
	assert.match(spec, /adr_needed=false|None this freeze/i);
	assert.match(spec, /Never `pnpm test:sdd`/i);
	assert.match(spec, /OAuthTransactionStore/);
	assert.match(spec, /Do not implement/i);
	assert.match(spec, /src\/auth\/local\/passkey/);
});

test("T-SOC-PASSKEY-PINS: passkey README/REPORT capture live HEAD and persistence implemented", () => {
	const readme = readFileSync(passkeyReadmePath, "utf8");
	const report = readFileSync(passkeyReportPath, "utf8");
	assert.match(readme, new RegExp(CURRENT_HEAD));
	assert.match(report, new RegExp(CURRENT_HEAD));
	assert.match(readme, /persistence/i);
	assert.match(readme, /implemented/i);
	assert.match(report, /Slice 03 persistence implemented/);
	assert.match(readme, /Do \*\*not\*\* redo|do not redo/i);
	assert.equal(
		/re-implement server contract/i.test(readme),
		false,
		"passkey pack must not schedule a redo of landed server contract",
	);
});

test("T-SOC-INTREE: Track C + combined freeze packs are committable SSOT (not gitignored)", () => {
	const gitignore = readFileSync(gitignorePath, "utf8");
	assert.equal(
		/^\/docs\/sdd\s*$/m.test(gitignore),
		false,
		"root .gitignore must not ignore the entire /docs/sdd tree (new packs would be uncommittable)",
	);
	for (const line of GITIGNORE_UNIGNORE) {
		assert.equal(
			gitignore.includes(line),
			true,
			`.gitignore must un-ignore freeze artifact ${line}`,
		);
	}
	const trackedRels = [
		...PACK_FILES.map(
			(rel) => `docs/sdd/xylex/athena-social-oauth-embedded-finality/${rel}`,
		),
		...COMBINED_FILES.map(
			(rel) => `docs/sdd/xylex/athena-auth-runtime-finality/${rel}`,
		),
		...MATRIX_STUBS.map(
			(rel) => `docs/sdd/xylex/athena-social-oauth-embedded-finality/${rel}`,
		),
	];
	for (const rel of trackedRels) {
		assert.equal(
			isGitIgnored(rel),
			false,
			`${rel} must be in-tree SSOT, not gitignored`,
		);
	}
});
