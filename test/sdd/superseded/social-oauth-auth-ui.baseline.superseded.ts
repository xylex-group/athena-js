/**
 * Slice 03 baseline — Auth UI social mutations (O6–O18 Phase 9).
 * Characterizes CURRENT HEAD: ProviderButton owns Better Auth
 * useSignInSocial; LinkedAccount owns useLinkSocial / useUnlinkAccount;
 * useAthenaSocialAuth does not exist; Auth UI does not import social server.
 *
 * GREEN on CURRENT. Do not implement Auth UI social ownership in this freeze.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/03-http-hooks-auth-ui.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-auth-ui.baseline.test.ts
 *   test/sdd/social-oauth-auth-ui.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const authUiSrc = join(repoRoot, "packages", "athena-auth-ui", "src");

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectTsFiles(full));
			continue;
		}
		if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
			out.push(full);
		}
	}
	return out;
}

function readUi(rel: string): string {
	return readFileSync(join(authUiSrc, rel), "utf8");
}

test("B-SOU-PROVIDER-BUTTON-BA: P?: ProviderButton owns Better Auth useSignInSocial", () => {
	const src = readUi("components/auth/provider-button.tsx");
	assert.match(src, /\buseSignInSocial\b/);
	assert.match(src, /@\/internal\/better-auth\/react/);
	assert.equal(/\buseAthenaSocialAuth\b/.test(src), false);
});

test("B-SOU-LINK-BA: P?: LinkedAccount owns useLinkSocial and useUnlinkAccount", () => {
	const src = readUi("components/auth/settings/security/linked-account.tsx");
	assert.match(src, /\buseLinkSocial\b/);
	assert.match(src, /\buseUnlinkAccount\b/);
	assert.equal(/\buseAthenaSocialAuth\b/.test(src), false);
});

test("B-SOU-NO-ATHENA-HOOK: P?: useAthenaSocialAuth does not exist", () => {
	const files = collectTsFiles(authUiSrc);
	assert.ok(files.length > 0);
	const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
	assert.equal(/\buseAthenaSocialAuth\b/.test(blob), false);
	assert.equal(
		existsSync(join(authUiSrc, "lib/auth/social/use-athena-social-auth.ts")),
		false,
	);
});

test("B-SOU-FIREWALL-UI: P?: Auth UI does not import src/auth/social/server or OAuthTransactionStore", () => {
	const files = collectTsFiles(authUiSrc);
	assert.ok(files.length > 0);
	for (const file of files) {
		const rel = relative(repoRoot, file).replace(/\\/g, "/");
		const src = readFileSync(file, "utf8");
		assert.equal(
			/\bOAuthTransactionStore\b/.test(src),
			false,
			`${rel} must not mention OAuthTransactionStore`,
		);
		assert.equal(
			/from ["'][^"']*auth\/social\/server[^"']*["']/.test(src),
			false,
			`${rel} must not import social/server`,
		);
		assert.equal(
			/\bcreateAthenaSocialServerEngine\b/.test(src),
			false,
			`${rel} must not import the social engine`,
		);
	}
});
