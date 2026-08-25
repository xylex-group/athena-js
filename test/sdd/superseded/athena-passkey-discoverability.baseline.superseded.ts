/**
 * SUPERSEDED by test/sdd/athena-passkey-discoverability.target.test.ts
 *
 * Former characterization of CURRENT passkey discoverability bugs (PR #696).
 * Inverted after implement: residentKey required, credProps default-on,
 * identified-account allowCredentials, Athena JS ceremony ownership,
 * Auth UI no longer hardcodes authenticatorAttachment / navigator.credentials.
 * Stay-true cells (no createPasskeyClient, passkey.register mutate) live in
 * the target suite. Target is CI SSOT. Not a *.test.ts file so CI does not run it.
 *
 * Spec: docs/sdd/xylex/athena-passkey-discoverability/SPEC.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { generateRegistrationOptions } from "@simplewebauthn/server";

import { createPasskeyModule } from "../../src/auth/passkey/client-module.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import {
	normalizeCredPropsResidentKey,
	normalizePasskeyRegistrationPolicy,
	registrationAuthenticatorSelection,
	supportedRegistrationExtensions,
} from "../../src/auth/passkey/policy.ts";
import { resolvePasskeyAuthenticatorDisplay } from "../../src/auth/passkey/metadata/resolve.ts";
import type { AthenaAuthResult } from "../../src/auth/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authUiRoot = join(repoRoot, "packages", "athena-auth-ui");

const EIGHT_HTTP = [
	"generateRegisterOptions",
	"generateAuthenticateOptions",
	"verifyRegistration",
	"verifyAuthentication",
	"listUserPasskeys",
	"deletePasskey",
	"updatePasskey",
	"getRelatedOrigins",
] as const;

const FOUND_DIAGNOSTIC_TOKENS = [
	"discoverability unknown",
	"allowCredentials=[]",
	"no assertion",
] as const;

const NAMED_DEVTOOLS_HEADINGS = [
	">Overview<",
	">Requests<",
	">Session<",
	">WebAuthn<",
	">Routing<",
] as const;

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function readRepo(rel: string): string {
	return readFileSync(join(repoRoot, rel), "utf8");
}

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

function scanTree(dir: string): string {
	return collectTsFiles(dir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
}

test("P?: registration residentKey preferred + requireResidentKey false then authentication allowCredentials [] with no verify-authentication", async () => {
	const unspecified = normalizePasskeyRegistrationPolicy(undefined);
	assert.equal(unspecified.residentKey, null);
	assert.equal(
		registrationAuthenticatorSelection({ policy: unspecified }),
		undefined,
	);

	const options = await generateRegistrationOptions({
		rpID: "example.com",
		rpName: "Example",
		userDisplayName: "Ada",
		userID: new Uint8Array(16),
		userName: "ada@example.com",
	});
	assert.equal(options.authenticatorSelection?.residentKey, "preferred");
	assert.equal(options.authenticatorSelection?.requireResidentKey, false);
	assert.equal(options.authenticatorSelection?.userVerification, "preferred");

	const authenticateSrc = readPkg(
		"src/auth/local/passkey/generate-authenticate-options.ts",
	);
	assert.match(authenticateSrc, /resolveSession/);
	assert.equal(/\bemail\b/.test(authenticateSrc), false);
	assert.match(
		authenticateSrc,
		/const existing = resolved\s*\n\s*\? await createPasskeyRepository\(ctx\.stores\)\.listByUser\(resolved\.user\.id\)\s*\n\s*: \[\];/,
	);

	const codec = readRepo(
		"packages/athena-auth-ui/src/lib/athena/webauthn-codec.ts",
	);
	const getIndex = codec.indexOf("navigator.credentials.get");
	const verifyIndex = codec.indexOf("verifyAuthentication");
	assert.ok(getIndex >= 0, "Auth UI codec runs navigator.credentials.get");
	assert.equal(
		verifyIndex,
		-1,
		"Auth UI codec never reaches verifyAuthentication after a failed get",
	);
});

test("B-PKD-RK-OMIT: generator omits residentKey unless operator policy is set", () => {
	const unspecified = normalizePasskeyRegistrationPolicy(undefined);
	assert.equal(unspecified.residentKey, null);
	assert.equal(unspecified.authenticatorAttachment, null);
	assert.equal(
		registrationAuthenticatorSelection({ policy: unspecified }),
		undefined,
	);

	const required = registrationAuthenticatorSelection({
		policy: normalizePasskeyRegistrationPolicy({ residentKey: "required" }),
	});
	assert.equal(required?.residentKey, "required");
	assert.equal(required?.requireResidentKey, true);

	const handler = readPkg("src/auth/local/passkey/generate-register-options.ts");
	assert.match(handler, /registrationAuthenticatorSelection/);
	assert.match(handler, /authenticatorSelection,/);
});

test("B-PKD-CREDPROPS-OMIT: credProps is requested only when operator policy sets it", () => {
	const unspecified = normalizePasskeyRegistrationPolicy(undefined);
	assert.equal(supportedRegistrationExtensions(unspecified), undefined);
	assert.deepEqual(
		supportedRegistrationExtensions(
			normalizePasskeyRegistrationPolicy({
				extensions: { credProps: true },
			}),
		),
		{ credProps: true },
	);
	assert.equal(normalizeCredPropsResidentKey(undefined), null);
	assert.equal(normalizeCredPropsResidentKey({}), null);
	assert.equal(normalizeCredPropsResidentKey({ credProps: {} }), null);
});

test("B-PKD-WIRE-NO-RK: public authenticatorSelection type has no residentKey field", () => {
	const types = readPkg("src/auth/types.ts");
	const start = types.indexOf("export interface AthenaPasskeyAuthenticatorSelection");
	assert.ok(start >= 0);
	const end = types.indexOf("export interface AthenaPasskeyOptionsResponse", start);
	const block = types.slice(start, end);
	assert.match(block, /authenticatorAttachment\?:/);
	assert.match(block, /requireResidentKey\?:/);
	assert.match(block, /userVerification\?:/);
	assert.equal(block.includes("residentKey?:"), false);
});

test("B-PKD-HTTP-EIGHT: public passkey surface is eight HTTP methods; no register/signIn", () => {
	assert.equal(CANONICAL_PASSKEY_METHODS.length, 8);
	assert.deepEqual([...CANONICAL_PASSKEY_METHODS], [...EIGHT_HTTP]);

	const bindings = createPasskeyModule({
		capabilities: {
			passkeys: true,
			source: "bootstrap",
			status: "known",
		},
		request: async <T>(): Promise<AthenaAuthResult<T>> =>
			({
				data: null,
				error: null,
				ok: true,
				raw: {},
				status: 200,
			}) as AthenaAuthResult<T>,
		sessionController: { accept: () => undefined },
	});
	assert.deepEqual(Object.keys(bindings).sort(), [...EIGHT_HTTP].sort());
	assert.equal("register" in bindings, false);
	assert.equal("signIn" in bindings, false);

	const publicPasskey = readPkg("src/auth/types.ts");
	const passkeyStart = publicPasskey.indexOf("\tpasskey: {");
	const passkeyEnd = publicPasskey.indexOf("refreshToken:", passkeyStart);
	const passkeyBlock = publicPasskey.slice(passkeyStart, passkeyEnd);
	assert.equal(passkeyBlock.includes("register:"), false);
	assert.equal(passkeyBlock.includes("signIn:"), false);
});

test("B-PKD-CEREMONY-JS: JS browser folder has no navigator.credentials.create/get", () => {
	const browserDir = join(srcRoot, "auth", "passkey", "browser");
	const blob = scanTree(browserDir);
	assert.equal(blob.includes("navigator.credentials.create"), false);
	assert.equal(blob.includes("navigator.credentials.get"), false);
	assert.match(
		readPkg("src/auth/passkey/browser/capabilities.ts"),
		/Not a public constructor \/ high-level register\(\)\/authenticate\(\) helper/,
	);
	assert.equal(existsSync(join(srcRoot, "auth", "passkey", "browser.ts")), false);
	assert.equal(scanTree(join(srcRoot, "auth", "passkey")).includes("hints"), false);
});

test("B-PKD-IDENT-BODY: authenticate options ignore POST email/user id; only session lists credentials", () => {
	const src = readPkg("src/auth/local/passkey/generate-authenticate-options.ts");
	assert.equal(src.includes("request.json"), false);
	assert.equal(/\bemail\b/.test(src), false);
	assert.equal(src.includes("body.userId"), false);
	assert.equal(src.includes("body.email"), false);
	assert.match(src, /resolveSession/);
	assert.match(src, /listByUser\(resolved\.user\.id\)/);
	assert.match(src, /: \[\];/);
});

test("B-PKD-NO-CLIENT: createPasskeyClient is absent", () => {
	const assembly = `${readPkg("src/auth/client.ts")}\n${readPkg("src/v3-client.ts")}\n${readPkg("src/index.ts")}`;
	assert.equal(assembly.includes("createPasskeyClient"), false);
	assert.equal(assembly.includes("createWebAuthnClient"), false);
	assert.equal(scanTree(join(srcRoot, "auth", "passkey")).includes("createPasskeyClient"), false);
});

test("B-PKD-MUTATE: register still goes through domain mutate with passkey.register", () => {
	const verify = readPkg("src/auth/local/passkey/verify-registration.ts");
	assert.match(verify, /event: "passkey.register"/);
	assert.match(verify, /ctx\.mutate\(/);
});

test("B-PKD-DISPLAY-GENERIC: unknown singleDevice row falls through to Passkey", () => {
	const display = resolvePasskeyAuthenticatorDisplay({
		backedUp: false,
		deviceType: "singleDevice",
		name: null,
		transports: [],
	});
	assert.equal(display.displayName, "Passkey");
});

test("B-PKD-ATTACHMENT: AddPasskeyDialog UNCONDITIONALLY sends authenticatorAttachment: 'cross-platform'", () => {
	const dialog = readRepo(
		"packages/athena-auth-ui/src/components/auth/passkey/add-passkey-dialog.tsx",
	);
	assert.match(dialog, /authenticatorAttachment:\s*"cross-platform"/);
	const lock = readRepo("packages/athena-auth-ui/tests/passkeys.test.tsx");
	assert.match(lock, /authenticatorAttachment:\s*"cross-platform"/);
});

test("B-PKD-CEREMONY-UI: Auth UI codec and adapter own navigator.credentials.create/get", () => {
	const codec = readRepo(
		"packages/athena-auth-ui/src/lib/athena/webauthn-codec.ts",
	);
	const adapter = readRepo(
		"packages/athena-auth-ui/src/lib/athena/better-auth-adapter.ts",
	);
	assert.match(codec, /navigator\.credentials\.create/);
	assert.match(codec, /navigator\.credentials\.get/);
	assert.match(adapter, /navigator\.credentials\.create/);
	assert.match(adapter, /navigator\.credentials\.get/);
	assert.match(codec, /authenticatorAttachment === "cross-platform"/);
	assert.match(adapter, /authenticatorAttachment === "cross-platform"/);
});

test("B-PKD-OVERLAY-MODAL: overlay is Modal, not AthenaDialog five named sections", () => {
	const overlay = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/auth-routing-debug-overlay.tsx",
	);
	const runtime = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/athena-devtools-runtime.ts",
	);
	assert.match(overlay, /Modal\.Backdrop/);
	assert.match(overlay, /Modal\.Dialog/);
	assert.match(overlay, /Athena DevTools/);
	assert.equal(overlay.includes("AthenaDialog"), false);
	for (const heading of NAMED_DEVTOOLS_HEADINGS) {
		assert.equal(overlay.includes(heading), false, heading);
	}
	const inspect = `${overlay}\n${runtime}`;
	for (const token of FOUND_DIAGNOSTIC_TOKENS) {
		assert.equal(inspect.includes(token), false, token);
	}
});
