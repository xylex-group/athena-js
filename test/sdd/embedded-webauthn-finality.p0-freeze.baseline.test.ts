/**
 * P0 freeze — Embedded WebAuthn Finality.
 * Characterizes CURRENT: eight passkey HTTP ops served (embedded: supported);
 * advertised passkeys:true; engine start/finish remain NotWired.
 * Rust handlers are the HTTP oracle.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/11-embedded-webauthn-finality-freeze.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/embedded-webauthn-finality.p0-freeze.baseline.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";
import { listMissingEmbeddedOperations } from "../../src/auth/contract/operations.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import { createAthenaPasskeyServerEngine } from "../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../src/auth/passkey/server/errors.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");

const FIVE_PASSKEY = [
	"GET /passkey/list-user-passkeys",
	"POST /passkey/delete-passkey",
	"POST /passkey/generate-authenticate-options",
	"POST /passkey/update-passkey",
	"POST /passkey/verify-authentication",
] as const;

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function readRepo(rel: string): string {
	return readFileSync(join(repoRoot, rel), "utf8");
}

function inventoryKnownMissing(): string {
	const src = readPkg("test/auth-route-inventory.test.ts");
	const match = src.match(
		/const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/,
	);
	assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
	return match[1] ?? "";
}

test("B-EWA-INVENTORY: five passkey routes plus related origins are served locally", () => {
	const listed = inventoryKnownMissing();
	for (const route of FIVE_PASSKEY) {
		assert.equal(listed.includes(`"${route}"`), false, route);
	}
	const gaps = listMissingEmbeddedOperations(ATHENA_AUTH_OPERATIONS);
	for (const route of FIVE_PASSKEY) {
		assert.equal(gaps.includes(route), false, `catalog gap ${route}`);
	}
	assert.equal(
		readPkg("src/auth/local/passkey/generate-authenticate-options.ts").includes(
			'path === "/passkey/generate-authenticate-options"',
		),
		true,
	);
	assert.equal(
		readPkg("src/auth/local/passkey/verify-authentication.ts").includes(
			'path === "/passkey/verify-authentication"',
		),
		true,
	);
	const matrix = readRepo(
		"docs/sdd/xylex/athena-passkey-runtime-finality/matrices/m-embedded-webauthn-oracle.md",
	);
	assert.equal(matrix.includes("**unsupported**"), false);
	for (const route of FIVE_PASSKEY) {
		const path = route.slice(route.indexOf(" ") + 1);
		assert.match(
			matrix,
			new RegExp(`${path.replace(/[/.]/g, "\\$&")}.*supported`, "s"),
			path,
		);
	}
});

test("B-EWA-FAIL-CLOSED: passkeys false; authenticate engine NotWired", () => {
	assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
	const engine = createAthenaPasskeyServerEngine({
		audit: {} as never,
		challenges: {} as never,
		clock: {} as never,
		credentials: {} as never,
		sessions: {} as never,
	});
	assert.throws(
		() => engine.startAuthentication({} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);
	assert.throws(
		() => engine.finishAuthentication({} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);
});

test("B-EWA-SDK: eight canonical methods; no second client", () => {
	assert.deepEqual(
		[...CANONICAL_PASSKEY_METHODS],
		[
			"generateRegisterOptions",
			"generateAuthenticateOptions",
			"verifyRegistration",
			"verifyAuthentication",
			"listUserPasskeys",
			"deletePasskey",
			"updatePasskey",
			"getRelatedOrigins",
		],
	);
	const blob = `${readPkg("src/index.ts")}\n${readPkg("src/auth/client.ts")}\n${readPkg("src/v3-client.ts")}`;
	assert.equal(blob.includes("createPasskeyClient"), false);
	assert.equal(blob.includes("athena.webauthn"), false);
});

test("B-EWA-ORACLE-AUTHN-OPTIONS: Rust session-optional + empty allowCredentials", () => {
	const plugin = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/mod.rs",
	);
	assert.match(
		plugin,
		/ctx\.require_session\(req\)\.await\.ok\(\)\.map\(\|\(u, _\)\| u\)/,
	);
	const handlers = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/handlers.rs",
	);
	assert.match(handlers, /generate_authenticate_options_core/);
	assert.match(handlers, /options\.allow_credentials = Some\(Vec::new\(\)\)/);
	assert.match(handlers, /list_passkeys_by_user\(user\.id\(\)\)/);
});

test("B-EWA-ORACLE-VERIFY: Rust issues session cookie; no passkey.authenticate event", () => {
	const plugin = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/mod.rs",
	);
	assert.match(plugin, /handle_verify_authentication/);
	assert.match(plugin, /create_session_cookie\(&token/);
	assert.match(plugin, /Set-Cookie/);
	assert.match(plugin, /auth\.sign_in\.passkey/);
	const handlers = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/handlers.rs",
	);
	assert.match(handlers, /finish_login/);
	assert.match(handlers, /create_session\(&user/);
	assert.equal(handlers.includes("passkey.authenticate"), false);
});

test("B-EWA-ORACLE-LIST-DELETE-UPDATE: session + 404 non-owner + name-only update", () => {
	const plugin = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/mod.rs",
	);
	assert.match(plugin, /handle_list_user_passkeys[\s\S]*require_session/);
	const handlers = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/handlers.rs",
	);
	assert.match(handlers, /Passkey not found/);
	assert.match(handlers, /update_passkey_name/);
	assert.match(handlers, /StatusResponse \{ status: true \}/);
	assert.equal(
		handlers.includes("assertUserRetainsAuthenticationMethod"),
		false,
	);
	const types = readRepo(
		"services/athena-auth/crates/api/src/plugins/passkey/types.rs",
	);
	assert.match(types, /public_key: String/);
	assert.match(types, /credential_id: String/);
	assert.match(types, /struct DeletePasskeyRequest/);
	assert.match(types, /struct UpdatePasskeyRequest/);
});

test("B-EWA-RELATED-ORIGINS: catalog lists GET /.well-known/webauthn as supported", () => {
	const related = ATHENA_AUTH_OPERATIONS.find(
		(operation) =>
			operation.method === "GET" && operation.path === "/.well-known/webauthn",
	);
	assert.ok(related);
	assert.equal(related?.capability, "passkeys");
	assert.equal(related?.rust, "supported");
	assert.equal(related?.embedded, "supported");
	assert.equal(
		listMissingEmbeddedOperations(ATHENA_AUTH_OPERATIONS).includes(
			"GET /.well-known/webauthn",
		),
		false,
	);
});

test("B-EWA-OPTIONAL-SESSION: authenticate options are optional-session", () => {
	const operation = ATHENA_AUTH_OPERATIONS.find(
		(entry) =>
			entry.method === "POST" &&
			entry.path === "/passkey/generate-authenticate-options",
	);
	assert.equal(operation?.auth, "optional-session");
});

test("B-EWA-CONSUME-ALGO: finish input has no userId; consume binds user after credential lookup", () => {
	const types = readPkg("src/auth/passkey/server/types.ts");
	const finish = types.slice(
		types.indexOf("export interface AthenaPasskeyAuthenticationFinishInput"),
		types.indexOf("export interface AthenaPasskeyAuthenticationFinishResult"),
	);
	assert.equal(/\buserId\b/.test(finish), false);
	assert.match(finish, /credentialId/);
	assert.match(finish, /userHandle/);
	const store = readPkg("src/auth/local/passkey/challenge-store.ts");
	assert.match(
		store,
		/passkey:\$\{input\.purpose\}:\$\{rpHash\}:\$\{userToken\(input\.userId\)\}/,
	);
	const spec = readFileSync(
		join(
			pkgRoot,
			"..",
			"..",
			"docs",
			"sdd",
			"xylex",
			"athena-passkey-runtime-finality",
			"specs",
			"11-embedded-webauthn-finality-freeze.md",
		),
		"utf8",
	);
	assert.match(spec, /find credential globally/);
	assert.match(spec, /try consume anonymous/);
});

test("B-EWA-NO-CEREMONY-IN-RUNTIME: runtime.ts does not import simplewebauthn", () => {
	const runtime = readPkg("src/auth/local/runtime.ts");
	assert.equal(runtime.includes("@simplewebauthn/server"), false);
	assert.equal(runtime.includes("verifyAuthenticationResponse"), false);
	assert.equal(runtime.includes("generateAuthenticationOptions"), false);
});
