/**
 * Track A P5 TARGET — local GET /passkey/generate-register-options.
 * DESIRED: requireSession → listByUser exclusions → persist SHA-256 challenge
 * hash (not raw) → AthenaPasskeyOptionsResponse from frozen RP snapshot.
 * Wrap a mature WebAuthn server library in src/auth/local only.
 * RED on CURRENT for route/handler absent (404 / still in KNOWN_MISSING).
 * GREEN after local GET handler. Stay-true fail-closed / isolation remain.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/03-embedded-registration.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-runtime-finality.register-options.target.test.ts
 *
 * Baseline characterization deleted after the GET handler landed (inverted
 * B-REG-MISSING-ROUTE / B-REG-NO-HANDLER). Record:
 * test/sdd/superseded/passkey-runtime-finality.register-options.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import type { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createPasskeyRepository } from "../../src/auth/local/passkey/repository.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createPasskeyModule } from "../../src/auth/passkey/client-module.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import { createAthenaPasskeyServerEngine } from "../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../src/auth/passkey/server/errors.ts";
import type { AthenaStoredPasskeyCreate } from "../../src/auth/passkey/server/types.ts";
import type { AthenaAuthResult } from "../../src/auth/types.ts";
import { base64Url } from "../../src/auth/utils/base64.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const localRoot = join(pkgRoot, "src", "auth", "local");
const serverDir = join(pkgRoot, "src", "auth", "passkey", "server");
const browserDir = join(pkgRoot, "src", "auth", "passkey", "browser");
const SAMPLE_PG =
	"postgresql://postgres@127.0.0.1:5432/athena_passkey_register_options_target";

const REGISTER_OPTIONS_ROUTE = "GET /passkey/generate-register-options";
const REGISTER_OPTIONS_PATH = "/passkey/generate-register-options";

const SIX_STAY_MISSING_PASSKEY_ROUTES = [
	"GET /passkey/list-user-passkeys",
	"POST /passkey/delete-passkey",
	"POST /passkey/generate-authenticate-options",
	"POST /passkey/update-passkey",
	"POST /passkey/verify-authentication",
] as const;

const WEBAUTHN_LIB_NEEDLES = [
	"@simplewebauthn/server",
	"@simplewebauthn/browser",
	"@simplewebauthn/types",
] as const;

const SNAPSHOT_RP_ID = "app.example.com";
const SNAPSHOT_RP_NAME = "Example App";

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function inventoryKnownMissing(): string {
	const src = readPkg("test/auth-route-inventory.test.ts");
	const match = src.match(
		/const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/,
	);
	assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
	return match[1] ?? "";
}

function missingInLocalGenerated(): string[] {
	const inventory = JSON.parse(
		readPkg("contracts/auth/routes.generated.json"),
	) as {
		missingInLocal: string[];
	};
	return inventory.missingInLocal;
}

function walkTs(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walkTs(full, acc);
		} else if (entry.name.endsWith(".ts")) {
			acc.push(full);
		}
	}
	return acc;
}

function hasRegisterOptionsGetHandler(): boolean {
	for (const file of walkTs(localRoot)) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(/if\s*\(([\s\S]*?)\)\s*\{/g)) {
			const cond = match[1] ?? "";
			if (
				cond.includes(`path === "${REGISTER_OPTIONS_PATH}"`) &&
				cond.includes('method === "GET"')
			) {
				return true;
			}
		}
	}
	return false;
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

function createRuntime() {
	return createAthenaAuthRuntime({
		autoMigrate: false,
		config: normalizeAthenaAuthConfig({
			mode: "local",
			passkey: {
				origins: ["http://app.local"],
				rpId: SNAPSHOT_RP_ID,
				rpName: SNAPSHOT_RP_NAME,
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
	name = "Ada",
): Promise<{ cookie: string; userId: string }> {
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email,
				name,
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(
		signup.status,
		200,
		"sign-up/email must succeed for session setup",
	);
	const cookie = signup.headers.get("set-cookie");
	assert.ok(cookie, "sign-up must Set-Cookie a session");
	const session = await runtime.handle(
		new Request("http://app.local/api/auth/get-session", {
			headers: { cookie },
		}),
	);
	assert.equal(session.status, 200);
	const body = await json(session);
	const user = body.user as { id?: string; email?: string };
	assert.equal(typeof user.id, "string");
	return { cookie, userId: user.id as string };
}

function registerOptionsRequest(
	cookie?: string,
	extraHeaders?: Record<string, string>,
): Request {
	const headers = new Headers(extraHeaders);
	if (cookie) {
		headers.set("cookie", cookie);
	}
	return new Request(`http://app.local/api/auth${REGISTER_OPTIONS_PATH}`, {
		headers,
		method: "GET",
	});
}

function userIdMatchesWire(userId: string, wire: string): boolean {
	if (wire === userId) {
		return true;
	}
	try {
		return new TextDecoder().decode(decodeBase64Url(wire)) === userId;
	} catch {
		return false;
	}
}

function decodeBase64Url(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", toArrayBufferBytes(bytes)),
	);
}

function sampleCreate(
	overrides: Partial<AthenaStoredPasskeyCreate> & {
		credentialId?: Uint8Array;
		userId: string;
	},
): AthenaStoredPasskeyCreate {
	return {
		aaguid: null,
		backedUp: false,
		counter: 0n,
		deviceType: "singleDevice",
		name: "primary",
		publicKey: new Uint8Array([9, 8, 7, 6]),
		residentKey: null,
		transports: ["internal"],
		...overrides,
	};
}

function unwiredPorts() {
	return {
		audit: {} as never,
		challenges: {} as never,
		clock: {} as never,
		credentials: {} as never,
		sessions: {} as never,
	};
}

function collectDirSrc(dir: string): string {
	return walkTs(dir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
}

test("T-REG-SESSION: unauthenticated GET is 401; invalid session is 401", async () => {
	const runtime = createRuntime();
	const missing = await runtime.handle(registerOptionsRequest());
	assert.equal(
		missing.status,
		401,
		"found case: missing handler 404s instead of requireSession 401",
	);
	const missingBody = await json(missing);
	assert.equal(missingBody.message, "Authentication required");

	const bogus = await runtime.handle(
		registerOptionsRequest("athena-auth.session-token=session_deadbeef"),
	);
	assert.equal(bogus.status, 401);
	const bogusBody = await json(bogus);
	assert.equal(bogusBody.message, "Session not found or expired");
});

test("T-REG-OPTIONS: authenticated GET 200 is AthenaPasskeyOptionsResponse from snapshot RP", async () => {
	const runtime = createRuntime();
	const { cookie, userId } = await signUp(
		runtime,
		"ada-reg-options@example.com",
		"Ada Lovelace",
	);
	const response = await runtime.handle(registerOptionsRequest(cookie));
	assert.equal(
		response.status,
		200,
		"found case: GET /passkey/generate-register-options 404s (not served)",
	);
	const body = await json(response);
	assert.equal(typeof body.challenge, "string");
	assert.ok(
		(body.challenge as string).length > 0,
		"challenge must be a non-empty string",
	);
	const rp = body.rp as { id?: string; name?: string };
	assert.equal(rp.id, SNAPSHOT_RP_ID);
	assert.equal(rp.name, SNAPSHOT_RP_NAME);
	assert.equal(
		Object.hasOwn(body, "rpId"),
		false,
		"wire DTO must not grow a top-level rpId this cycle",
	);
	const user = body.user as {
		id?: string;
		name?: string;
		displayName?: string;
	};
	assert.equal(typeof user.id, "string");
	assert.ok(user.id && user.id.length > 0);
	assert.ok(
		userIdMatchesWire(userId, user.id),
		"user.id must be the authenticated user (raw id or base64url UTF-8)",
	);
	assert.equal(user.name, "ada-reg-options@example.com");
	assert.equal(user.displayName, "Ada Lovelace");
	const params = body.pubKeyCredParams as { type?: string; alg?: number }[];
	assert.equal(Array.isArray(params), true);
	assert.ok(params.length > 0, "pubKeyCredParams must be a non-empty array");
	for (const param of params) {
		assert.equal(param.type, "public-key");
		assert.equal(typeof param.alg, "number");
	}
	assert.equal(Array.isArray(body.excludeCredentials), true);
	assert.deepEqual(
		body.excludeCredentials,
		[],
		"excludeCredentials must be an empty array when listByUser is empty",
	);
});

test("T-REG-EXCLUDE: listByUser credentials become excludeCredentials; other users omitted", async () => {
	const runtime = createRuntime();
	const { cookie, userId } = await signUp(
		runtime,
		"ada-reg-exclude@example.com",
	);
	const other = await signUp(runtime, "other-reg-exclude@example.com", "Other");
	const stores = (await runtime.getStores()) as MemoryAuthStores;
	const repo = createPasskeyRepository(stores);
	const ownWithTransports = new Uint8Array([1, 2, 3, 4, 5]);
	const ownEmptyTransports = new Uint8Array([9, 9, 9]);
	const foreign = new Uint8Array([7, 7, 7, 7]);
	await repo.create(
		sampleCreate({
			credentialId: ownWithTransports,
			transports: ["internal", "hybrid"],
			userId,
		}),
	);
	await repo.create(
		sampleCreate({
			credentialId: ownEmptyTransports,
			name: "empty-transports",
			transports: [],
			userId,
		}),
	);
	await repo.create(
		sampleCreate({
			credentialId: foreign,
			userId: other.userId,
		}),
	);

	const response = await runtime.handle(registerOptionsRequest(cookie));
	assert.equal(
		response.status,
		200,
		"found case: exclusions cannot be served because the GET handler 404s",
	);
	const body = await json(response);
	const excluded = body.excludeCredentials as {
		id?: string;
		type?: string;
		transports?: string[];
	}[];
	assert.equal(Array.isArray(excluded), true);
	const ids = excluded.map((item) => item.id);
	const ownA = base64Url.encode(ownWithTransports, { padding: false });
	const ownB = base64Url.encode(ownEmptyTransports, { padding: false });
	const foreignId = base64Url.encode(foreign, { padding: false });
	assert.ok(ids.includes(ownA));
	assert.ok(ids.includes(ownB));
	assert.equal(
		ids.includes(foreignId),
		false,
		"excludeCredentials must not include other users' credentials",
	);
	for (const item of excluded) {
		assert.equal(item.type, "public-key");
	}
	const withTransports = excluded.find((item) => item.id === ownA);
	assert.deepEqual(withTransports?.transports, ["internal", "hybrid"]);
	const empty = excluded.find((item) => item.id === ownB);
	assert.equal(
		empty && Object.hasOwn(empty, "transports"),
		false,
		"omit transports when the stored list is empty",
	);
});

test("T-REG-CHALLENGE-HASH: durable value is SHA-256 of the wire challenge, not the raw nonce", async () => {
	const runtime = createRuntime();
	const { cookie, userId } = await signUp(
		runtime,
		"ada-reg-challenge@example.com",
	);
	const response = await runtime.handle(registerOptionsRequest(cookie));
	assert.equal(
		response.status,
		200,
		"found case: challenge is not persisted because the GET handler 404s",
	);
	const body = await json(response);
	const challenge = body.challenge as string;
	assert.equal(typeof challenge, "string");
	const raw = decodeBase64Url(challenge);
	const digest = await sha256(raw);
	const expectedValue = base64Url.encode(digest, { padding: false });

	const stores = (await runtime.getStores()) as MemoryAuthStores;
	const rpHash = base64Url.encode(
		await sha256(new TextEncoder().encode(SNAPSHOT_RP_ID)),
		{ padding: false },
	);
	const expectedIdentifier = `passkey:registration:${rpHash}:${userId}`;
	const rows = [...stores.verifications.values()].filter((row) =>
		row.identifier.startsWith("passkey:"),
	);
	assert.ok(rows.length >= 1, "registration challenge row must be persisted");
	for (const row of rows) {
		assert.notEqual(
			row.value,
			challenge,
			"durable store must not hold the raw wire challenge string (Rust state_json clone)",
		);
		assert.equal(
			row.identifier.startsWith("passkey:authentication:"),
			false,
			"purpose must be registration, not authentication",
		);
	}
	const match = rows.find((row) => row.value === expectedValue);
	assert.ok(
		match,
		"verifications.value must equal base64url(SHA-256(raw challenge bytes))",
	);
	assert.equal(match.identifier, expectedIdentifier);
	assert.ok(
		match.identifier.startsWith("passkey:registration:"),
		"PasskeyChallengeStore.create purpose must be registration",
	);
	assert.ok(
		match.identifier.endsWith(`:${userId}`),
		"registration identifier must bind the authenticated userId",
	);
});

test("T-REG-ROUTE: GET /passkey/generate-register-options is served and removed from missing inventory", () => {
	assert.equal(
		hasRegisterOptionsGetHandler(),
		true,
		'found case: no if (path === "/passkey/generate-register-options" && method === "GET") under src/auth/local',
	);
	const listed = inventoryKnownMissing();
	assert.equal(
		listed.includes(`"${REGISTER_OPTIONS_ROUTE}"`),
		false,
		"found case: GET /passkey/generate-register-options still in KNOWN_MISSING_IN_LOCAL",
	);
	assert.equal(
		missingInLocalGenerated().includes(REGISTER_OPTIONS_ROUTE),
		false,
		"found case: routes.generated.json missingInLocal still lists the GET",
	);
	const generated = missingInLocalGenerated();
	for (const route of SIX_STAY_MISSING_PASSKEY_ROUTES) {
		assert.equal(
			listed.includes(`"${route}"`),
			false,
			`inventory integrity: ${route} is now served`,
		);
		assert.equal(
			generated.includes(route),
			false,
			`inventory integrity: missingInLocal must not list ${route}`,
		);
	}

	const localBlob = collectDirSrc(localRoot);
	assert.equal(
		localBlob.includes("@simplewebauthn/server") ||
			localBlob.includes("generateRegistrationOptions"),
		true,
		"found case: src/auth/local does not wrap a mature WebAuthn server library",
	);
	assert.equal(
		/from\s+["']cbor["']|from\s+["']@cbor|cose-js|hand-?rolled CBOR/i.test(
			localBlob,
		),
		false,
		"must wrap a library; do not hand-roll CBOR/COSE",
	);
	const engineSrc = readPkg("src/auth/passkey/server/engine.ts");
	assert.equal(
		engineSrc.includes("/passkey/generate-register-options"),
		false,
		"handler must live under src/auth/local, not engine.ts",
	);
});

test("T-REG-NO-HOST: rp.id stays the frozen snapshot under spoofed Host / x-forwarded-host / Origin", async () => {
	const runtime = createRuntime();
	assert.equal(runtime.passkeyRelyingParty?.id, SNAPSHOT_RP_ID);
	const { cookie } = await signUp(runtime, "ada-reg-nohost@example.com");
	const response = await runtime.handle(
		registerOptionsRequest(cookie, {
			host: "evil.example",
			origin: "https://evil.example",
			"x-forwarded-host": "evil.example",
		}),
	);
	assert.equal(
		response.status,
		200,
		"found case: spoofed Host cannot be ignored because the GET still 404s",
	);
	const body = await json(response);
	const rp = body.rp as { id?: string };
	assert.equal(rp.id, SNAPSHOT_RP_ID);
	assert.notEqual(rp.id, "evil.example");
});

test("T-REG-FAIL-CLOSED: construct throw; denyPasskeys on disabled snapshot; engine NotWired", async () => {
	assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);

	assert.throws(
		() =>
			createClient({
				auth: { passkeys: true } as never,
				databaseUrl: SAMPLE_PG,
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED",
	);
	assert.throws(
		() =>
			createClient({
				auth: { webauthn: true } as never,
				databaseUrl: SAMPLE_PG,
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED",
	);

	const listed = inventoryKnownMissing();
	const generated = missingInLocalGenerated();
	for (const route of SIX_STAY_MISSING_PASSKEY_ROUTES) {
		assert.equal(
			listed.includes(`"${route}"`),
			false,
			`KNOWN_MISSING_IN_LOCAL must not list served ${route}`,
		);
		assert.equal(generated.includes(route), false);
	}

	const factorySrc = readPkg("src/auth/passkey/client-module.ts");
	assert.match(factorySrc, /function denyPasskeys\b/);
	const denied = await createPasskeyModule({
		capabilities: {
			passkeys: false,
			source: "bootstrap",
			status: "known",
		},
		request: async <T>(): Promise<AthenaAuthResult<T>> => ({
			data: null,
			error: null,
			ok: true,
			raw: {},
			status: 200,
		}),
		sessionController: { accept: () => undefined },
	}).generateRegisterOptions();
	assert.equal(denied.ok, false);
	assert.equal(denied.status, 501);
	assert.equal(denied.errorDetails?.code, "ATHENA_AUTH_CAPABILITY_DISABLED");

	assert.throws(
		() =>
			createAthenaPasskeyServerEngine(unwiredPorts()).startRegistration(
				{} as never,
			),
		(error: unknown) => error instanceof AthenaPasskeyServerNotWiredError,
	);

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
});

test("T-REG-ISOLATION: passkey/server and browser stay free of WebAuthn server libraries", () => {
	const serverSrc = collectDirSrc(serverDir);
	const browserSrc = collectDirSrc(browserDir);
	const browserEntry = readPkg("src/browser.ts");
	for (const needle of WEBAUTHN_LIB_NEEDLES) {
		assert.equal(
			serverSrc.includes(needle),
			false,
			`passkey/server must not import ${needle}`,
		);
		assert.equal(
			browserSrc.includes(needle),
			false,
			`passkey/browser must not import ${needle}`,
		);
		assert.equal(
			browserEntry.includes(needle),
			false,
			`src/browser.ts must not import ${needle}`,
		);
	}
	assert.equal(/navigator\.credentials/.test(serverSrc), false);
	const engineSrc = readPkg("src/auth/passkey/server/engine.ts");
	assert.equal(/@simplewebauthn/.test(engineSrc), false);
});
