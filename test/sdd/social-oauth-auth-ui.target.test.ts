/**
 * Slice 03 TARGET — Auth UI social mutations (Phase 9).
 * DESIRED: useAthenaSocialAuth owns sign-in/link/unlink; ProviderButton and
 * settings must not own Better Auth useSignInSocial / useLinkSocial /
 * useUnlinkAccount; no extra OAuth config; settings lists linked accounts;
 * next-minimal specifies createClient social.providers google+github.
 *
 * RED on CURRENT. Filename stays in RED_CONTRACT_FREEZE until GREEN.
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
const nextMinimal = join(
	repoRoot,
	"packages",
	"athena-auth-ui",
	"examples",
	"next-minimal",
);

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

test("T-SOU-USE-ATHENA-SOCIAL-AUTH: P?: useAthenaSocialAuth owns sign-in, link, and unlink mutations", () => {
	const files = collectTsFiles(authUiSrc);
	const hits = files.filter((file) =>
		/\buseAthenaSocialAuth\b/.test(readFileSync(file, "utf8")),
	);
	assert.ok(
		hits.length > 0,
		"useAthenaSocialAuth must exist under packages/athena-auth-ui/src",
	);
	const blob = hits.map((file) => readFileSync(file, "utf8")).join("\n");
	assert.match(blob, /export function useAthenaSocialAuth/);
	assert.match(blob, /signIn|sign-in|signInSocial/i);
	assert.match(blob, /\blink\b/i);
	assert.match(blob, /\bunlink\b/i);
});

test("T-SOU-PROVIDER-BUTTON: P?: ProviderButton does not own Better Auth useSignInSocial", () => {
	const src = readUi("components/auth/provider-button.tsx");
	assert.match(src, /\buseAthenaSocialAuth\b/);
	assert.equal(
		/\buseSignInSocial\b/.test(src),
		false,
		"ProviderButton must not own useSignInSocial",
	);
});

test("T-SOU-LINK-UNLINK: P?: settings link/unlink do not own useLinkSocial / useUnlinkAccount", () => {
	const src = readUi("components/auth/settings/security/linked-account.tsx");
	assert.match(src, /\buseAthenaSocialAuth\b/);
	assert.equal(/\buseLinkSocial\b/.test(src), false);
	assert.equal(/\buseUnlinkAccount\b/.test(src), false);
});

test("T-SOU-NO-EXTRA-CONFIG: P?: Auth UI has no extra OAuth clientSecret / store / encryption config", () => {
	const files = collectTsFiles(authUiSrc);
	assert.ok(files.length > 0);
	const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
	assert.equal(/\bOAuthTransactionStore\b/.test(blob), false);
	assert.equal(/\bencryptPkceVerifier\b/.test(blob), false);
	assert.equal(/\bpkce_verifier_ciphertext\b/.test(blob), false);
	assert.equal(/\bcreateAthenaSocialServerEngine\b/.test(blob), false);
	for (const file of files) {
		const src = readFileSync(file, "utf8");
		assert.equal(
			/clientSecret[\s\S]{0,80}(google|github|social)/i.test(src) &&
				/createClient\(/.test(src),
			false,
			`${relative(repoRoot, file)} must not add social clientSecret to Auth UI createClient`,
		);
	}
});

test("T-SOU-SETTINGS-LIST: P?: settings lists linked accounts via list-accounts hydrate", () => {
	const src = readUi("components/auth/settings/security/linked-accounts.tsx");
	assert.match(src, /\buseSafeListAccounts\b/);
	assert.match(
		readFileSync(
			join(authUiSrc, "lib/auth/social/use-safe-list-accounts.ts"),
			"utf8",
		),
		/list-accounts|listAccounts/,
	);
});

test("T-SOU-FIREWALL: P?: Auth UI cannot import src/auth/social/server", () => {
	const files = collectTsFiles(authUiSrc);
	assert.ok(files.length > 0);
	for (const file of files) {
		const rel = relative(repoRoot, file).replace(/\\/g, "/");
		const src = readFileSync(file, "utf8");
		assert.equal(
			/from ["'][^"']*auth\/social\/server[^"']*["']/.test(src),
			false,
			`${rel} must not import social/server`,
		);
		assert.equal(
			/from ["'][^"']*auth\/local\/social[^"']*["']/.test(src),
			false,
			`${rel} must not import local/social`,
		);
	}
});

test("T-SOU-NEXT-MINIMAL: P?: next-minimal canary specifies createClient social.providers google+github", () => {
	assert.equal(existsSync(nextMinimal), true);
	const files = [
		join(nextMinimal, "src/lib/athena/root.ts"),
		join(nextMinimal, "src/lib/athena.ts"),
		join(nextMinimal, "src/lib/athena/browser.ts"),
	].filter((file) => existsSync(file));
	assert.ok(files.length > 0, "next-minimal createClient files must exist");
	const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
	assert.match(blob, /createClient\(/);
	assert.match(blob, /social:\s*\{/);
	assert.match(blob, /providers:\s*\{/);
	assert.match(blob, /\bgoogle:/);
	assert.match(blob, /\bgithub:/);
});
