/**
 * Slice 03 baseline — Social OAuth domain-hook contract (O6–O18 Phase 1).
 * Characterizes CURRENT HEAD: account.link / account.unlink reserved, no
 * user.sign-in.social, no AthenaAuthHookAccount, no oauth.callback event,
 * companion scan does not list local/social/{routes,runtime}.ts.
 *
 * GREEN on CURRENT. Do not implement social hooks in this freeze.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/03-http-hooks-auth-ui.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-hooks.baseline.test.ts
 *   test/sdd/social-oauth-hooks.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	ATHENA_AUTH_DOMAIN_EVENTS,
	ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS,
	ATHENA_AUTH_RESERVED_DOMAIN_EVENTS,
} from "../../src/auth/hooks/events.ts";
import { ATHENA_AUTH_EVENT_DEFINITIONS } from "../../src/auth/domain/catalog.ts";
import type { AthenaAuthHooks } from "../../src/auth/hooks/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const localSocialDir = join(pkgRoot, "src", "auth", "local", "social");

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

test("B-SOH-LINK-RESERVED: P?: account.link is reserved and not a hookable AthenaAuthHooks key", () => {
	assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.link"].status, "reserved");
	assert.equal(
		ATHENA_AUTH_RESERVED_DOMAIN_EVENTS.includes("account.link"),
		true,
	);
	assert.equal(
		ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.link" as never),
		false,
	);
	type ReservedHookKey = Extract<
		keyof NonNullable<AthenaAuthHooks["after"]>,
		"account.link"
	>;
	type ReservedUnhookable = ReservedHookKey extends never ? true : never;
	const reservedUnhookable: ReservedUnhookable = true;
	assert.equal(reservedUnhookable, true);
	const typesSrc = readPkg("src/auth/hooks/types.ts");
	assert.equal(/"account\.link":/.test(typesSrc), false);
});

test("B-SOH-UNLINK-RESERVED: P?: account.unlink is reserved and not a hookable AthenaAuthHooks key", () => {
	assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.unlink"].status, "reserved");
	assert.equal(
		ATHENA_AUTH_RESERVED_DOMAIN_EVENTS.includes("account.unlink"),
		true,
	);
	assert.equal(
		ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.unlink" as never),
		false,
	);
	const typesSrc = readPkg("src/auth/hooks/types.ts");
	assert.equal(/"account\.unlink":/.test(typesSrc), false);
});

test("B-SOH-NO-SIGN-IN-SOCIAL: P?: user.sign-in.social is absent from ATHENA_AUTH_DOMAIN_EVENTS", () => {
	assert.equal("user.sign-in.social" in ATHENA_AUTH_DOMAIN_EVENTS, false);
	assert.equal("user.sign-in.social" in ATHENA_AUTH_EVENT_DEFINITIONS, false);
	const eventsSrc = readPkg("src/auth/hooks/events.ts");
	assert.equal(/user\.sign-in\.social/.test(eventsSrc), false);
});

test("B-SOH-NO-HOOK-ACCOUNT: P?: AthenaAuthHookAccount does not exist", () => {
	const sanitizeSrc = readPkg("src/auth/hooks/sanitize.ts");
	assert.equal(/\bAthenaAuthHookAccount\b/.test(sanitizeSrc), false);
	assert.equal(/\bsanitizeHookAccount\b/.test(sanitizeSrc), false);
	const typesSrc = readPkg("src/auth/hooks/types.ts");
	assert.equal(/\bAthenaAuthHookAccount\b/.test(typesSrc), false);
});

test("B-SOH-NO-OAUTH-CALLBACK: P?: oauth.callback is not a domain event", () => {
	assert.equal("oauth.callback" in ATHENA_AUTH_DOMAIN_EVENTS, false);
	assert.equal("oauth.callback" in ATHENA_AUTH_EVENT_DEFINITIONS, false);
	const eventsSrc = readPkg("src/auth/hooks/events.ts");
	const typesSrc = readPkg("src/auth/hooks/types.ts");
	assert.equal(/\boauth\.callback\b/.test(eventsSrc), false);
	assert.equal(/\boauth\.callback\b/.test(typesSrc), false);
});

test("B-SOH-COMPANION-NO-SOCIAL: P?: auth-domain-hooks companion scan does not include local/social/routes.ts or runtime.ts", () => {
	const companions = readPkg("test/auth-domain-hooks.test.ts");
	assert.match(companions, /local\/runtime\.ts/);
	assert.equal(companions.includes("local/social/routes.ts"), false);
	assert.equal(companions.includes("local/social/runtime.ts"), false);
	assert.equal(existsSync(join(localSocialDir, "routes.ts")), false);
	assert.equal(existsSync(join(localSocialDir, "runtime.ts")), false);
});
