/**
 * P1 — internal passkey service boundary (GREEN on this slice).
 * Engine ceremony stays NotWired; HTTP authenticate/list/update/delete are served.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/11-embedded-webauthn-finality-freeze.md
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	generateAuthenticationOptions,
	verifyAuthentication,
} from "../../src/auth/passkey/server/authentication.ts";
import {
	type AthenaPasskeyServer,
	createAthenaPasskeyServerEngine,
} from "../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../src/auth/passkey/server/errors.ts";
import {
	generateRegistrationOptions,
	verifyRegistration,
} from "../../src/auth/passkey/server/registration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

test("T-EWA-BOUNDARY: AthenaPasskeyServer aliases the engine", () => {
	const engine: AthenaPasskeyServer = createAthenaPasskeyServerEngine({
		audit: {} as never,
		challenges: {} as never,
		clock: {} as never,
		credentials: {} as never,
		sessions: {} as never,
	});
	assert.equal(typeof engine.startAuthentication, "function");
	assert.equal(typeof engine.finishAuthentication, "function");
	assert.equal(typeof engine.startRegistration, "function");
	assert.equal(typeof engine.finishRegistration, "function");
});

test("T-EWA-BOUNDARY: registration/authentication modules delegate and stay NotWired", async () => {
	const server = createAthenaPasskeyServerEngine({
		audit: {} as never,
		challenges: {} as never,
		clock: {} as never,
		credentials: {} as never,
		sessions: {} as never,
	});
	await assert.rejects(
		() => generateRegistrationOptions(server, {} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);
	await assert.rejects(
		() => verifyRegistration(server, {} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);
	await assert.rejects(
		() => generateAuthenticationOptions(server, {} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);
	await assert.rejects(
		() => verifyAuthentication(server, {} as never),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);
});

test("T-EWA-BOUNDARY: authenticate/list HTTP handlers are wired", () => {
	const localIndex = readPkg("src/auth/local/passkey/index.ts");
	assert.equal(localIndex.includes("generate-authenticate-options"), true);
	assert.equal(localIndex.includes("verify-authentication"), true);
	const runtime = readPkg("src/auth/local/router.ts");
	assert.equal(runtime.includes("handleGenerateAuthenticateOptionsRoute"), true);
	assert.equal(runtime.includes("handleVerifyAuthenticationRoute"), true);
	assert.equal(runtime.includes("handleListUserPasskeysRoute"), true);
});
