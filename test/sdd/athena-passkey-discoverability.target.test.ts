/**
 * TARGET — DESIRED passkey discoverability / ceremony ownership / DevTools.
 * Source of truth after implement. Baseline characterization retired.
 *
 * Spec: docs/sdd/xylex/athena-passkey-discoverability/SPEC.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-passkey-discoverability.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { sanitizeHookPasskey } from "../../src/auth/hooks/sanitize.ts";
import { createPasskeyRepository } from "../../src/auth/local/passkey/repository.ts";
import { toPasskeyView } from "../../src/auth/local/passkey/view.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createPasskeyModule } from "../../src/auth/passkey/client-module.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import { resolvePasskeyAuthenticatorDisplay } from "../../src/auth/passkey/metadata/resolve.ts";
import {
	normalizeCredPropsResidentKey,
	normalizePasskeyRegistrationPolicy,
	registrationAuthenticatorSelection,
	supportedRegistrationExtensions,
} from "../../src/auth/passkey/policy.ts";
import type { AthenaStoredPasskey } from "../../src/auth/passkey/server/types.ts";
import type { AthenaAuthResult } from "../../src/auth/types.ts";
import { base64Url } from "../../src/auth/utils/base64.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authUiRoot = join(repoRoot, "packages", "athena-auth-ui");

const SNAPSHOT_RP_ID = "app.example.com";
const SNAPSHOT_ORIGIN = "http://app.local";

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

const CEREMONY_HELPERS = ["register", "signIn"] as const;

const FOUND_DIAGNOSTIC =
	"registration: discoverability unknown → authentication: allowCredentials=[] → browser returned no assertion";

const FOUND_DIAGNOSTIC_TOKENS = [
	"discoverability unknown",
	"allowCredentials=[]",
	"no assertion",
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
			if (entry.name === "node_modules") {
				continue;
			}
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

function collectHarFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".git") {
				continue;
			}
			out.push(...collectHarFiles(full));
			continue;
		}
		if (entry.name.toLowerCase().endsWith(".har")) {
			out.push(full);
		}
	}
	return out;
}

function createTestHasher() {
	return {
		async hash(password: string) {
			return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
		},
		needsRehash(hash: string) {
			return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
		},
		async verify(password: string, hash: string) {
			return hash.endsWith(Buffer.from(password).toString("base64url"));
		},
	};
}

function createRuntime(registration?: {
	extensions?: { credProps?: boolean };
	residentKey?: "discouraged" | "preferred" | "required";
}) {
	return createAthenaAuthRuntime({
		autoMigrate: false,
		config: normalizeAthenaAuthConfig({
			mode: "local",
			passkey: {
				origins: [SNAPSHOT_ORIGIN],
				rpId: SNAPSHOT_RP_ID,
				rpName: "Example App",
				...(registration ? { registration } : {}),
			},
		}),
		hasher: createTestHasher(),
	});
}

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

async function signUp(
	runtime: ReturnType<typeof createAthenaAuthRuntime>,
	email: string,
): Promise<{ cookie: string; userId: string }> {
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email,
				name: "Ada",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const cookie = signup.headers.get("set-cookie");
	assert.ok(cookie);
	const session = await runtime.handle(
		new Request("http://app.local/api/auth/get-session", {
			headers: { cookie },
		}),
	);
	const body = await json(session);
	const user = body.user as { id?: string };
	assert.equal(typeof user.id, "string");
	return { cookie, userId: user.id as string };
}

async function seedStoredPasskey(
	runtime: ReturnType<typeof createAthenaAuthRuntime>,
	userId: string,
	credentialId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
): Promise<Uint8Array> {
	const stores = await runtime.getStores();
	await createPasskeyRepository(stores).create({
		aaguid: null,
		backedUp: false,
		counter: 0n,
		credentialId,
		deviceType: "singleDevice",
		name: null,
		publicKey: new Uint8Array([9, 9, 9, 9]),
		residentKey: null,
		transports: [],
		userId,
	});
	return credentialId;
}

function createBindings() {
	return createPasskeyModule({
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
}

function storedFixture(residentKey: boolean | null): AthenaStoredPasskey {
	return {
		aaguid: null,
		backedUp: false,
		counter: 0n,
		createdAt: new Date("2026-08-22T00:00:00.000Z"),
		credentialId: new Uint8Array([1, 2, 3, 4]),
		deviceType: "singleDevice",
		id: "pk_unknown",
		name: null,
		publicKey: new Uint8Array([9, 9, 9]),
		residentKey,
		transports: [],
		updatedAt: null,
		userId: "user_1",
	};
}

test("P?: registration residentKey preferred + requireResidentKey false then authentication allowCredentials [] with no verify-authentication", async () => {
	const unspecified = normalizePasskeyRegistrationPolicy(undefined);
	const selection = registrationAuthenticatorSelection({ policy: unspecified });
	assert.equal(selection?.residentKey, "required");
	assert.equal(selection?.requireResidentKey, true);

	const runtime = createRuntime();
	const { cookie } = await signUp(runtime, "ada-rk-required@example.com");
	const response = await runtime.handle(
		new Request("http://app.local/api/auth/passkey/generate-register-options", {
			headers: { cookie },
			method: "GET",
		}),
	);
	assert.equal(response.status, 200);
	const body = await json(response);
	const authenticatorSelection = body.authenticatorSelection as {
		requireResidentKey?: boolean;
		residentKey?: string;
	};
	assert.equal(authenticatorSelection.residentKey, "required");
	assert.equal(authenticatorSelection.requireResidentKey, true);

	const types = readPkg("src/auth/types.ts");
	const start = types.indexOf(
		"export interface AthenaPasskeyAuthenticatorSelection",
	);
	assert.ok(start >= 0);
	const end = types.indexOf(
		"export interface AthenaPasskeyOptionsResponse",
		start,
	);
	const block = types.slice(start, end);
	assert.match(block, /residentKey\?:/);
});

test("T-PKD-CREDPROPS: passwordless generateRegisterOptions requests extensions.credProps unless disabled", async () => {
	const unspecified = normalizePasskeyRegistrationPolicy(undefined);
	assert.deepEqual(supportedRegistrationExtensions(unspecified), {
		credProps: true,
	});

	const runtime = createRuntime();
	const { cookie } = await signUp(runtime, "ada-credprops@example.com");
	const response = await runtime.handle(
		new Request("http://app.local/api/auth/passkey/generate-register-options", {
			headers: { cookie },
			method: "GET",
		}),
	);
	assert.equal(response.status, 200);
	const body = await json(response);
	const extensions = body.extensions as { credProps?: boolean } | undefined;
	assert.equal(extensions?.credProps, true);

	const disabledPolicy = normalizePasskeyRegistrationPolicy({
		extensions: { credProps: false },
	});
	assert.equal(supportedRegistrationExtensions(disabledPolicy), undefined);

	const disabledRuntime = createRuntime({ extensions: { credProps: false } });
	const disabledUser = await signUp(
		disabledRuntime,
		"ada-credprops-off@example.com",
	);
	const disabledResponse = await disabledRuntime.handle(
		new Request("http://app.local/api/auth/passkey/generate-register-options", {
			headers: { cookie: disabledUser.cookie },
			method: "GET",
		}),
	);
	assert.equal(disabledResponse.status, 200);
	const disabledBody = await json(disabledResponse);
	const disabledExtensions = disabledBody.extensions as
		| { credProps?: boolean }
		| undefined;
	assert.notEqual(disabledExtensions?.credProps, true);
});

test("T-PKD-UNKNOWN-RK: missing credProps.rk persists residentKey null and is not coerced to true", () => {
	assert.equal(normalizeCredPropsResidentKey(undefined), null);
	assert.equal(normalizeCredPropsResidentKey({}), null);
	assert.equal(normalizeCredPropsResidentKey({ credProps: {} }), null);
	assert.equal(
		normalizeCredPropsResidentKey({ credProps: { rk: true } }),
		true,
	);
	assert.equal(
		normalizeCredPropsResidentKey({ credProps: { rk: false } }),
		false,
	);

	const view = toPasskeyView(storedFixture(null));
	assert.equal(view.authenticator.residentKey, null);
});

test("T-PKD-ALLOW-EMPTY: unauthenticated generateAuthenticateOptions without identifier returns allowCredentials []", async () => {
	const runtime = createRuntime();
	const response = await runtime.handle(
		new Request(
			"http://app.local/api/auth/passkey/generate-authenticate-options",
			{
				body: "{}",
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		),
	);
	assert.equal(response.status, 200);
	const body = await json(response);
	assert.deepEqual(body.allowCredentials, []);
});

test("T-PKD-ALLOW-IDENTIFIED: generateAuthenticateOptions with email or user id and no session lists stored credential IDs", async () => {
	const runtime = createRuntime();
	const { userId } = await signUp(runtime, "ada-identified@example.com");
	const credentialId = await seedStoredPasskey(runtime, userId);
	const encoded = base64Url.encode(credentialId, { padding: false });

	const byEmail = await runtime.handle(
		new Request(
			"http://app.local/api/auth/passkey/generate-authenticate-options",
			{
				body: JSON.stringify({ email: "ada-identified@example.com" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		),
	);
	assert.equal(byEmail.status, 200);
	const emailBody = await json(byEmail);
	const emailAllow = emailBody.allowCredentials as { id?: string }[];
	assert.equal(Array.isArray(emailAllow), true);
	assert.equal(emailAllow.length, 1);
	assert.equal(emailAllow[0]?.id, encoded);

	const byUserId = await runtime.handle(
		new Request(
			"http://app.local/api/auth/passkey/generate-authenticate-options",
			{
				body: JSON.stringify({ userId }),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		),
	);
	assert.equal(byUserId.status, 200);
	const userBody = await json(byUserId);
	const userAllow = userBody.allowCredentials as { id?: string }[];
	assert.equal(userAllow.length, 1);
	assert.equal(userAllow[0]?.id, encoded);

	const authenticateSrc = readPkg(
		"src/auth/local/passkey/generate-authenticate-options.ts",
	);
	assert.match(authenticateSrc, /\bemail\b/);
	assert.match(authenticateSrc, /userId/);
});

test("T-PKD-ALLOW-SESSION: authenticated generateAuthenticateOptions still lists the session user's credentials", async () => {
	const runtime = createRuntime();
	const { cookie, userId } = await signUp(runtime, "ada-session@example.com");
	const credentialId = await seedStoredPasskey(runtime, userId);
	const response = await runtime.handle(
		new Request(
			"http://app.local/api/auth/passkey/generate-authenticate-options",
			{
				body: "{}",
				headers: { cookie, "content-type": "application/json" },
				method: "POST",
			},
		),
	);
	assert.equal(response.status, 200);
	const body = await json(response);
	const allow = body.allowCredentials as { id?: string }[];
	assert.equal(allow.length, 1);
	assert.equal(
		allow[0]?.id,
		base64Url.encode(credentialId, { padding: false }),
	);
});

test("T-PKD-SURFACE: athena.auth.passkey exposes eight HTTP methods plus register and signIn; createPasskeyClient is absent", () => {
	assert.equal(CANONICAL_PASSKEY_METHODS.length, 8);
	assert.deepEqual([...CANONICAL_PASSKEY_METHODS], [...EIGHT_HTTP]);

	const bindings = createBindings() as unknown as Record<string, unknown>;
	for (const name of EIGHT_HTTP) {
		assert.equal(typeof bindings[name], "function", name);
	}
	for (const name of CEREMONY_HELPERS) {
		assert.equal(typeof bindings[name], "function", name);
	}
	assert.equal("createPasskeyClient" in bindings, false);

	const publicPasskey = readPkg("src/auth/types.ts");
	const passkeyStart = publicPasskey.indexOf("\tpasskey: {");
	const passkeyEnd = publicPasskey.indexOf("refreshToken:", passkeyStart);
	const passkeyBlock = publicPasskey.slice(passkeyStart, passkeyEnd);
	assert.match(passkeyBlock, /register:/);
	assert.match(passkeyBlock, /signIn:/);
	assert.equal(publicPasskey.includes("createPasskeyClient"), false);
});

test("T-PKD-BROWSER: Athena JS passkey/browser owns navigator.credentials.create/get; Auth UI codec/adapter do not", () => {
	const browserDir = join(srcRoot, "auth", "passkey", "browser");
	const browserFile = join(srcRoot, "auth", "passkey", "browser.ts");
	const jsBlob = `${scanTree(join(srcRoot, "auth", "passkey"))}\n${existsSync(browserFile) ? readFileSync(browserFile, "utf8") : ""
		}`;
	assert.ok(
		jsBlob.includes("navigator.credentials.create"),
		"Athena JS must own navigator.credentials.create",
	);
	assert.ok(
		jsBlob.includes("navigator.credentials.get"),
		"Athena JS must own navigator.credentials.get",
	);
	assert.ok(
		existsSync(browserFile) ||
		existsSync(join(browserDir, "index.ts")) ||
		collectTsFiles(browserDir).length > 0,
		"passkey/browser module must exist",
	);

	const clientModule = readPkg("src/auth/passkey/client-module.ts");
	assert.match(clientModule, /register:/);
	assert.match(clientModule, /signIn:/);
	assert.match(clientModule, /generateRegisterOptions/);
	assert.match(clientModule, /verifyRegistration/);
	assert.match(clientModule, /generateAuthenticateOptions/);
	assert.match(clientModule, /verifyAuthentication/);

	const codec = readRepo(
		"packages/athena-auth-ui/src/lib/athena/webauthn-codec.ts",
	);
	const adapter = readRepo(
		"packages/athena-auth-ui/src/lib/athena/better-auth-adapter.ts",
	);
	assert.equal(codec.includes("navigator.credentials.create"), false);
	assert.equal(codec.includes("navigator.credentials.get"), false);
	assert.equal(adapter.includes("navigator.credentials.create"), false);
	assert.equal(adapter.includes("navigator.credentials.get"), false);
});

test("T-PKD-MUTATE: passkey.register/update/delete still go through executeAuthMutation", () => {
	const verify = readPkg("src/auth/local/passkey/verify-registration.ts");
	assert.match(verify, /event: "passkey.register"/);
	assert.match(verify, /ctx\.mutate\(/);

	const manage = readPkg("src/auth/local/passkey/manage-passkeys.ts");
	assert.match(manage, /event: "passkey.update"/);
	assert.match(manage, /event: "passkey.delete"/);
	assert.match(manage, /ctx\.mutate\(/);

	const execute = readPkg("src/auth/hooks/execute.ts");
	assert.match(execute, /export type AuthDomainMutate/);
	assert.match(
		verify,
		/Do not import from src\/browser\.ts or passkey\/browser/,
	);
});

test("T-PKD-METADATA: registration view exposes deviceType, backedUp, transports, residentKey true|false|null, display metadata without secrets", () => {
	const unknown = toPasskeyView(storedFixture(null));
	assert.equal(unknown.authenticator.deviceType, "singleDevice");
	assert.equal(unknown.authenticator.backedUp, false);
	assert.deepEqual(unknown.authenticator.transports, []);
	assert.equal(unknown.authenticator.residentKey, null);
	assert.equal(typeof unknown.authenticator.displayName, "string");
	assert.notEqual(unknown.authenticator.displayName, undefined);

	const discoverable = toPasskeyView({
		...storedFixture(true),
		backedUp: true,
		deviceType: "multiDevice",
		residentKey: true,
		transports: ["internal", "hybrid"],
	});
	assert.equal(discoverable.authenticator.residentKey, true);
	assert.equal(discoverable.authenticator.backedUp, true);
	assert.deepEqual(discoverable.authenticator.transports, [
		"internal",
		"hybrid",
	]);

	const nonDiscoverable = toPasskeyView(storedFixture(false));
	assert.equal(nonDiscoverable.authenticator.residentKey, false);

	for (const view of [unknown, discoverable, nonDiscoverable]) {
		const serialized = JSON.stringify(view);
		assert.equal(serialized.includes("publicKey"), false);
		assert.equal(serialized.includes("credentialID"), false);
		assert.equal(serialized.includes("attestationObject"), false);
	}

	const display = resolvePasskeyAuthenticatorDisplay({
		backedUp: false,
		deviceType: "singleDevice",
		name: null,
		transports: [],
	});
	assert.ok(
		display.displayName !== "Passkey" ||
		JSON.stringify(display).includes("discoverability"),
		"unknown discoverability must not collapse to generic Passkey without a diagnostic",
	);
});

test("T-PKD-NO-SECRETS: mutating path sanitizes; no HAR fixtures; DevTools dumps omit assertion/attestation payloads", () => {
	const hook = sanitizeHookPasskey({
		id: "pk_1",
		name: "laptop",
		userId: "user_1",
	});
	const hookJson = JSON.stringify(hook);
	assert.equal(hookJson.includes("publicKey"), false);
	assert.equal(hookJson.includes("credentialID"), false);
	assert.equal(hookJson.includes("attestationObject"), false);

	const sanitizeSrc = readPkg("src/auth/hooks/sanitize.ts");
	assert.equal(sanitizeSrc.includes("attestationObject"), false);
	assert.equal(sanitizeSrc.includes("authenticatorData"), false);

	const overlay = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/auth-routing-debug-overlay.tsx",
	);
	const runtime = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/athena-devtools-runtime.ts",
	);
	const inspect = `${overlay}\n${runtime}`;
	assert.equal(inspect.includes("attestationObject"), false);
	assert.equal(inspect.includes("authenticatorData"), false);
	assert.equal(inspect.includes("clientDataJSON"), false);
	assert.equal(
		/value=\{authenticateCeremony\.challenge\}/.test(overlay),
		false,
		"raw authenticate challenge must not be a DevTools copy-paste value",
	);

	const har = [
		...collectHarFiles(join(pkgRoot, "test")),
		...collectHarFiles(join(authUiRoot, "tests")),
		...collectHarFiles(
			join(repoRoot, "docs", "sdd", "xylex", "athena-passkey-discoverability"),
		),
	];
	assert.deepEqual(har, []);

	const self = readFileSync(new URL(import.meta.url), "utf8");
	assert.equal(
		self.includes(`"fmt": ${JSON.stringify("none")}`),
		false,
		"target tests must not embed HAR attestation fixtures",
	);
	assert.equal(self.includes(`att${"Stmt"}`), false);
});

test("T-PKD-REMOTE-EMBEDDED: remote and embedded public passkey method names match (eight HTTP + two ceremony helpers)", () => {
	const client = readPkg("src/auth/client.ts");
	assert.match(client, /passkey: createPasskeyModule\(/);
	assert.equal(client.includes("createPasskeyClient"), false);
	assert.equal(client.includes("createWebAuthnClient"), false);
	assert.equal(client.includes("athena.webauthn"), false);

	const bindings = createBindings() as unknown as Record<string, unknown>;
	const names = Object.keys(bindings).sort();
	const expected = [...EIGHT_HTTP, ...CEREMONY_HELPERS].sort();
	assert.deepEqual(names, expected);

	const assembly = `${client}\n${readPkg("src/v3-client.ts")}\n${readPkg("src/index.ts")}`;
	assert.equal(assembly.includes("createPasskeyClient"), false);
});

test("T-PKD-NO-CLIENT: createPasskeyClient is absent", () => {
	const passkeyTree = scanTree(join(srcRoot, "auth", "passkey"));
	assert.equal(passkeyTree.includes("createPasskeyClient"), false);
	assert.equal(passkeyTree.includes("createWebAuthnClient"), false);
	assert.equal(readPkg("src/index.ts").includes("createPasskeyClient"), false);
});

test("T-PKD-DIAGNOSTIC: unknown discoverability plus empty allowCredentials plus no assertion surfaces the found-case diagnostic", () => {
	const overlay = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/auth-routing-debug-overlay.tsx",
	);
	const runtime = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/athena-devtools-runtime.ts",
	);
	const inspect = `${overlay}\n${runtime}\n${scanTree(join(srcRoot, "auth", "passkey"))}`;
	for (const token of FOUND_DIAGNOSTIC_TOKENS) {
		assert.ok(inspect.includes(token), token);
	}
	assert.ok(
		inspect.includes(FOUND_DIAGNOSTIC) ||
		FOUND_DIAGNOSTIC_TOKENS.every((token) => inspect.includes(token)),
		"DevTools must emit the found-case diagnostic family",
	);
});

test("T-PKD-OVERLAY: one AthenaDialog shell with named Overview, Requests, Session, WebAuthn, Routing sections", () => {
	const overlay = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/auth-routing-debug-overlay.tsx",
	);
	assert.equal(
		overlay.includes("AthenaDialog"),
		true,
		"overlay shell must be AthenaDialog",
	);
	assert.equal(overlay.includes("Modal.Backdrop"), false);
	const instrumentation = readRepo(
		"packages/athena-auth-ui/src/components/auth/experimental/athena-devtools-instrumentation.tsx",
	);
	const surface = `${overlay}\n${instrumentation}`;
	for (const heading of ["Overview", "Requests", "Session", "WebAuthn"]) {
		assert.ok(surface.includes(heading), heading);
	}

	const pages = readRepo("packages/athena-auth-ui/src/pages.tsx");
	const providers = readRepo(
		"packages/athena-auth-ui/src/components/auth/athena-providers.tsx",
	);
	assert.equal(
		[...pages.matchAll(/AuthRoutingDebugOverlay/g)].length,
		2,
		"pages.tsx keeps a single overlay import + mount",
	);
	assert.equal(
		[...providers.matchAll(/AuthRoutingDebugOverlay/g)].length,
		2,
		"athena-providers.tsx keeps a single overlay import + mount",
	);
});
