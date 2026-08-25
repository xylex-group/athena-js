/**
 * Slice 01 target — canonical passkey server contract (ports + domain types).
 * DESIRED: `src/auth/passkey/server/` exists with engine + ports + domain types.
 * Public eight methods + fail-closed stay unchanged (must pass on CURRENT).
 *
 * Amendment (challenge domain): start results expose raw `challenge: Uint8Array`
 * (not `challengeHash`); persist stays hash-only; consume binds
 * `userId: string | null`. IDs: T-SRV-START-CHALLENGE, T-SRV-START-NO-HASH,
 * T-SRV-PERSIST-HASH-ONLY, T-SRV-CONSUME-USER, T-SRV-REG-USER,
 * T-SRV-AUTHN-USER-NULL. Not T-CHAL-* (slice 02 SQL).
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/01-server-contract-freeze.md
 *       docs/sdd/xylex/athena-passkey-runtime-finality/specs/01-challenge-domain-contract.md
 *
 * Host (never `pnpm test:sdd`). Challenge-domain baseline superseded:
 * test/sdd/superseded/passkey-runtime-finality.challenge-domain.baseline.superseded.ts
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-runtime-finality.server-contract.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { createAuthModule } from "../../src/auth/client.ts";
import { createPasskeyModule } from "../../src/auth/passkey/client-module.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");
const serverDir = join(srcRoot, "auth", "passkey", "server");

const FORBIDDEN_CLIENTS = [
	"createPasskeyClient",
	"createWebAuthnClient",
	"athena.webauthn",
] as const;

/** Track A P6 inventory amend: POST verify-registration is no longer a stay-true gap. */
const SIX_REMAINING_PASSKEY_ROUTES = [
	"GET /passkey/list-user-passkeys",
	"POST /passkey/delete-passkey",
	"POST /passkey/generate-authenticate-options",
	"POST /passkey/update-passkey",
	"POST /passkey/verify-authentication",
] as const;

const GATED_PASSKEY_METHODS = [
	"generateRegisterOptions",
	"generateAuthenticateOptions",
	"verifyRegistration",
	"verifyAuthentication",
	"listUserPasskeys",
	"deletePasskey",
	"updatePasskey",
] as const;

const SERVER_FILES = [
	"engine.ts",
	"types.ts",
	"errors.ts",
	"challenge-store.ts",
	"repository.ts",
	"session.ts",
	"relying-party.ts",
	"audit.ts",
	"clock.ts",
	"index.ts",
] as const;

const ENGINE_METHODS = [
	"startRegistration",
	"finishRegistration",
	"startAuthentication",
	"finishAuthentication",
] as const;

const PORTS = [
	"PasskeyChallengeStore",
	"PasskeyRepository",
	"PasskeySessionController",
	"PasskeyAuditSink",
	"PasskeyClock",
] as const;

const DOMAIN_TYPES = [
	"AthenaStoredPasskey",
	"AthenaPasskeyChallenge",
	"AthenaPasskeyRelyingParty",
] as const;

const ENGINE_IO_TYPES = [
	"AthenaPasskeyRegistrationStartInput",
	"AthenaPasskeyRegistrationStartResult",
	"AthenaPasskeyRegistrationFinishInput",
	"AthenaPasskeyAuthenticationStartInput",
	"AthenaPasskeyAuthenticationStartResult",
	"AthenaPasskeyAuthenticationFinishInput",
	"AthenaPasskeyAuthenticationFinishResult",
] as const;

const MAPPER_METHODS = [
	"toStoredPasskey",
	"toPasskeyRecord",
	"toWireRelyingParty",
	"fromWireRelyingParty",
	"serializeTransports",
	"parseTransports",
] as const;

const FORBIDDEN_ENGINE_IMPORT_NEEDLES = [
	"pg",
	"@types/pg",
	"d1",
	"node:http",
	"node:https",
	"node:net",
	"next",
	"react",
	"react-dom",
	"@simplewebauthn/server",
	"@simplewebauthn/browser",
	"@simplewebauthn/types",
] as const;

const SAMPLE_PG =
	"postgresql://postgres@127.0.0.1:5432/athena_passkey_server_contract_target";

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function extractBalanced(src: string, start: number, openAt: number): string {
	let depth = 0;
	for (let i = openAt; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return src.slice(start, i + 1);
			}
		}
	}
	throw new Error(`unbalanced block starting at ${start}`);
}

function extractInterface(src: string, name: string): string {
	const needle = `export interface ${name} {`;
	const start = src.indexOf(needle);
	assert.ok(start >= 0, `${name} must be an exported interface (not a wire alias)`);
	const openAt = src.indexOf("{", start);
	return extractBalanced(src, start, openAt);
}

/** Raw ceremony nonce field — `\bchallenge:` does not match `challengeHash:`. */
function hasRawChallengeField(iface: string): boolean {
	return /\bchallenge:\s*Uint8Array;/.test(iface);
}

function hasChallengeHashField(iface: string): boolean {
	return /\bchallengeHash:/.test(iface);
}

function isTypeAliasOf(src: string, name: string, ofName: string): boolean {
	return new RegExp(
		`export\\s+type\\s+${name}\\s*=\\s*${ofName}\\b`,
	).test(src);
}

function collectImportSpecifiers(src: string): string[] {
	const specs: string[] = [];
	const re =
		/(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
	for (const match of src.matchAll(re)) {
		specs.push(match[1] ?? match[2] ?? "");
	}
	return specs.filter(Boolean);
}

function assertNotPublicExport(haystack: string, symbol: string, where: string) {
	assert.equal(
		new RegExp(
			`export\\s+(?:\\*|\\{[^}]*\\b${symbol}\\b|async\\s+function\\s+${symbol}\\b|function\\s+${symbol}\\b|const\\s+${symbol}\\b)`,
		).test(haystack),
		false,
		`${symbol} must not be a public export from ${where}`,
	);
}

function requireServerTree(): void {
	assert.equal(
		existsSync(serverDir),
		true,
		"src/auth/passkey/server/ must exist after slice 01",
	);
}

function readServerFile(file: string): string {
	const abs = join(serverDir, file);
	assert.equal(existsSync(abs), true, `src/auth/passkey/server/${file} must exist`);
	return readFileSync(abs, "utf8");
}

function collectServerSrc(): string {
	requireServerTree();
	return SERVER_FILES.map((file) => readServerFile(file)).join("\n");
}

function exportMentions(src: string, name: string): boolean {
	return (
		new RegExp(`export\\s+interface\\s+${name}\\b`).test(src) ||
		new RegExp(`export\\s+type\\s+\\{[^}]*\\b${name}\\b`).test(src) ||
		new RegExp(`export\\s+type\\s+\\*\\s+from\\s+['"]`).test(src) ||
		new RegExp(`export\\s+\\*\\s+from\\s+['"]`).test(src)
	);
}

function indexReexports(indexSrc: string, name: string): boolean {
	if (new RegExp(`export\\s+interface\\s+${name}\\b`).test(indexSrc)) {
		return true;
	}
	if (new RegExp(`export\\s+type\\s+\\{[^}]*\\b${name}\\b`).test(indexSrc)) {
		return true;
	}
	if (/export\s+type\s+\*\s+from\s+['"]/.test(indexSrc)) {
		return true;
	}
	if (/export\s+\*\s+from\s+['"]/.test(indexSrc)) {
		return true;
	}
	return false;
}

test("Slice 01 target T-SRV-TREE: server/ tree exists with engine, types, errors, ports, index", () => {
	requireServerTree();
	for (const file of SERVER_FILES) {
		assert.equal(
			existsSync(join(serverDir, file)),
			true,
			`src/auth/passkey/server/${file} must exist`,
		);
	}
	const names = new Set(readdirSync(serverDir));
	for (const file of SERVER_FILES) {
		assert.ok(names.has(file), `${file} must be listed in server/`);
	}
});

test("Slice 01 target T-SRV-EXPORT: index.ts exports engine, five ports, three domain types", async () => {
	const indexSrc = readServerFile("index.ts");
	const treeSrc = collectServerSrc();
	const required = [
		"AthenaPasskeyServerEngine",
		...PORTS,
		...DOMAIN_TYPES,
		"AthenaPasskeyWireDomainMappers",
	];
	for (const name of required) {
		assert.ok(
			indexReexports(indexSrc, name) || exportMentions(treeSrc, name),
			`passkey/server must export ${name}`,
		);
		assert.ok(
			indexReexports(indexSrc, name),
			`passkey/server/index.ts must re-export ${name}`,
		);
	}

	const store = extractInterface(treeSrc, "PasskeyChallengeStore");
	assert.match(store, /\bcreate\s*\(/);
	assert.match(store, /\bconsume\s*\(/);
	assert.match(store, /\bexpire\s*\(/);

	const repo = extractInterface(treeSrc, "PasskeyRepository");
	assert.match(repo, /\bcreate\s*\(/);
	assert.match(repo, /\bfindByCredentialId\s*\(/);
	assert.match(repo, /\blistByUser\s*\(/);
	assert.match(repo, /\bupdateCounter\s*\(/);
	assert.match(repo, /\bupdateName\s*\(/);
	assert.match(repo, /\bdelete\s*\(/);

	const session = extractInterface(treeSrc, "PasskeySessionController");
	assert.match(session, /\baccept\s*\(/);

	const audit = extractInterface(treeSrc, "PasskeyAuditSink");
	assert.match(audit, /\brecord\s*\(/);

	const clock = extractInterface(treeSrc, "PasskeyClock");
	assert.match(clock, /\bnow\s*\(/);

	const pkgJson = JSON.parse(readPkg("package.json")) as {
		exports?: Record<string, unknown>;
	};
	assert.equal(
		pkgJson.exports?.["./auth/passkey/server"],
		undefined,
		"passkey/server must not be a package-root export",
	);
	assertNotPublicExport(
		readPkg("src/index.ts"),
		"AthenaPasskeyServerEngine",
		"src/index.ts",
	);
	assertNotPublicExport(
		readPkg("src/auth/index.ts"),
		"AthenaPasskeyServerEngine",
		"src/auth/index.ts",
	);
	assertNotPublicExport(
		readPkg("src/index.ts"),
		"createPasskeyModule",
		"src/index.ts",
	);

	await import(pathToFileURL(join(serverDir, "index.ts")).href);
});

test("Slice 01 target T-SRV-ENGINE: AthenaPasskeyServerEngine has start/finish registration and authentication", () => {
	const treeSrc = collectServerSrc();
	assert.equal(
		isTypeAliasOf(treeSrc, "AthenaPasskeyServerEngine", "AthenaPasskeyBindings"),
		false,
		"engine must not alias the public HTTP bindings",
	);
	const engine = extractInterface(treeSrc, "AthenaPasskeyServerEngine");
	for (const method of ENGINE_METHODS) {
		assert.match(
			engine,
			new RegExp(`\\b${method}\\s*\\(`),
			`AthenaPasskeyServerEngine must declare ${method}`,
		);
	}

	const typesSrc = readServerFile("types.ts");
	for (const name of ENGINE_IO_TYPES) {
		assert.ok(
			typesSrc.includes(`export interface ${name}`) ||
				typesSrc.includes(`export type ${name}`),
			`server/types.ts must declare domain ${name} (not a wire DTO alias)`,
		);
		assert.equal(
			isTypeAliasOf(typesSrc, name, "AthenaPasskeyOptionsResponse"),
			false,
			`${name} must not alias wire AthenaPasskeyOptionsResponse`,
		);
		assert.equal(
			isTypeAliasOf(typesSrc, name, "AthenaPasskeyRecord"),
			false,
			`${name} must not alias wire AthenaPasskeyRecord`,
		);
		assert.equal(
			isTypeAliasOf(typesSrc, name, "AthenaPasskeyCredential"),
			false,
			`${name} must not alias wire AthenaPasskeyCredential`,
		);
	}
});

test("Slice 01 target T-SRV-ISOLATION: engine.ts has no pg/D1/SQL/HTTP/Next/React/browser WebAuthn imports", () => {
	const engineSrc = readServerFile("engine.ts");
	const specs = collectImportSpecifiers(engineSrc);
	for (const spec of specs) {
		const normalized = spec.replace(/\\/g, "/").toLowerCase();
		for (const needle of FORBIDDEN_ENGINE_IMPORT_NEEDLES) {
			assert.equal(
				normalized === needle ||
					normalized.startsWith(`${needle}/`) ||
					normalized.endsWith(`/${needle}`),
				false,
				`engine.ts must not import ${spec}`,
			);
		}
		assert.equal(
			/auth\/types(?:\.ts)?$/.test(normalized),
			false,
			"engine.ts must not import wire DTOs from src/auth/types.ts",
		);
		assert.equal(
			normalized.includes("@simplewebauthn"),
			false,
			"engine.ts must not import @simplewebauthn/*",
		);
	}

	assert.equal(
		/navigator\s*\.\s*credentials/.test(engineSrc),
		false,
		"engine.ts must not call navigator.credentials",
	);
	assert.equal(
		/\bsql\s*`/.test(engineSrc),
		false,
		"engine.ts must not contain SQL tagged templates",
	);
	assert.equal(
		/\b(?:from\s+['"]pg['"]|require\(\s*['"]pg['"]\s*\))/.test(engineSrc),
		false,
		"engine.ts must not import pg",
	);

	const treeFiles = readdirSync(serverDir).filter((name) => name.endsWith(".ts"));
	for (const file of treeFiles) {
		const src = readFileSync(join(serverDir, file), "utf8");
		const fileSpecs = collectImportSpecifiers(src);
		for (const spec of fileSpecs) {
			assert.equal(
				spec.includes("@simplewebauthn"),
				false,
				`${file} must not import @simplewebauthn (ports-only slice)`,
			);
			assert.equal(
				spec === "pg" || spec.startsWith("pg/"),
				false,
				`${file} must not import pg this slice`,
			);
			assert.equal(
				spec === "next" || spec.startsWith("next/"),
				false,
				`${file} must not import Next this slice`,
			);
			assert.equal(
				spec === "react" || spec.startsWith("react/"),
				false,
				`${file} must not import React this slice`,
			);
		}
	}

	const factorySrc = readPkg("src/auth/passkey/client-module.ts");
	assert.equal(
		/passkey\/server|AthenaPasskeyServerEngine/.test(factorySrc),
		false,
		"createPasskeyModule must not import the local server engine this slice",
	);
});

test("Slice 01 target T-SRV-DOMAIN: AthenaStoredPasskey / challenge are domain types, not AthenaPasskeyRecord", () => {
	const treeSrc = collectServerSrc();
	const typesSrc = readServerFile("types.ts");
	assert.equal(
		isTypeAliasOf(typesSrc, "AthenaStoredPasskey", "AthenaPasskeyRecord"),
		false,
		"AthenaStoredPasskey must not alias wire AthenaPasskeyRecord",
	);
	assert.equal(
		isTypeAliasOf(typesSrc, "AthenaPasskeyChallenge", "AthenaPasskeyRecord"),
		false,
		"AthenaPasskeyChallenge must not alias wire AthenaPasskeyRecord",
	);

	const stored = extractInterface(treeSrc, "AthenaStoredPasskey");
	assert.match(stored, /\bcredentialId:\s*Uint8Array;/);
	assert.match(stored, /\bpublicKey:\s*Uint8Array;/);
	assert.match(stored, /\bcounter:\s*bigint;/);
	assert.match(stored, /\bdeviceType:\s*AthenaPasskeyDeviceKind;/);
	assert.match(stored, /\bbackedUp:\s*boolean;/);
	assert.match(stored, /\baaguid:\s*string\s*\|\s*null;/);
	assert.match(stored, /\bresidentKey:\s*boolean\s*\|\s*null;/);
	assert.match(stored, /\btransports:\s*AuthenticatorTransport\[];/);
	assert.match(stored, /\bname:\s*string\s*\|\s*null;/);
	assert.match(stored, /\bcreatedAt:\s*Date;/);
	assert.match(stored, /\bupdatedAt:\s*Date\s*\|\s*null;/);
	assert.equal(
		/\bcredentialID\?:/.test(stored),
		false,
		"domain stored passkey must not use wire credentialID?: string",
	);
	assert.equal(
		/\btransports\?:\s*string;/.test(stored),
		false,
		"domain transports must be AuthenticatorTransport[], not wire JSON string",
	);
	assert.equal(
		/\bcounter\?:\s*number;/.test(stored),
		false,
		"domain counter must be bigint, not wire number",
	);

	const challenge = extractInterface(treeSrc, "AthenaPasskeyChallenge");
	assert.match(challenge, /\bchallengeHash:\s*Uint8Array;/);
	assert.match(challenge, /\bpurpose:\s*AthenaPasskeyChallengePurpose;/);
	assert.match(challenge, /\buserId:\s*string\s*\|\s*null;/);
	assert.match(challenge, /\brpId:\s*string;/);
	assert.match(challenge, /\bcreatedAt:\s*Date;/);
	assert.match(challenge, /\bexpiresAt:\s*Date;/);
	assert.match(challenge, /\bconsumedAt:\s*Date\s*\|\s*null;/);

	assert.match(
		treeSrc,
		/type AthenaPasskeyDeviceKind\s*=\s*"singleDevice"\s*\|\s*"multiDevice"/,
	);
	assert.match(
		treeSrc,
		/type AthenaPasskeyChallengePurpose\s*=\s*"registration"\s*\|\s*"authentication"/,
	);

	const mappers = extractInterface(treeSrc, "AthenaPasskeyWireDomainMappers");
	for (const method of MAPPER_METHODS) {
		assert.match(
			mappers,
			new RegExp(`\\b${method}\\s*\\(`),
			`AthenaPasskeyWireDomainMappers must declare ${method} (no duck-typing)`,
		);
	}

	const wireTypes = readPkg("src/auth/types.ts");
	assert.equal(
		wireTypes.includes("AthenaPasskeyServerEngine"),
		false,
		"wire types must not host the server engine",
	);
	assert.equal(
		wireTypes.includes("AthenaStoredPasskey"),
		false,
		"AthenaStoredPasskey must live under passkey/server, not src/auth/types.ts",
	);
	assert.equal(
		wireTypes.includes("PasskeyChallengeStore"),
		false,
		"ports must not live on wire types",
	);
	const wireRecord = extractInterface(wireTypes, "AthenaPasskeyRecord");
	assert.match(wireRecord, /\bauthenticator:\s*AthenaPasskeyAuthenticator;/);
	assert.equal(/\bcredentialID\?:/.test(wireRecord), false);
	assert.equal(/\bpublicKey\?:/.test(wireRecord), false);
	const wireCredential = extractInterface(wireTypes, "AthenaPasskeyCredential");
	assert.match(wireCredential, /\btransports\?:\s*string;/);
	assert.match(wireCredential, /\bcredentialID\?:\s*string;/);
});

test("Slice 01 target T-SRV-RP: domain AthenaPasskeyRelyingParty requires id, name, origins, relatedOrigins", () => {
	const treeSrc = collectServerSrc();
	const typesSrc = readServerFile("types.ts");
	assert.equal(
		isTypeAliasOf(typesSrc, "AthenaPasskeyRelyingParty", "AthenaPasskeyRecord"),
		false,
	);
	assert.equal(
		/from\s+['"][^'"]*auth\/types(?:\.ts)?['"]/.test(typesSrc),
		false,
		"server/types.ts must not import wire AthenaPasskeyRelyingParty from src/auth/types.ts",
	);

	const domainRp = extractInterface(treeSrc, "AthenaPasskeyRelyingParty");
	assert.match(domainRp, /\bid:\s*string;/);
	assert.match(domainRp, /\bname:\s*string;/);
	assert.match(domainRp, /\borigins:\s*readonly\s+string\[\];/);
	assert.match(domainRp, /\brelatedOrigins:\s*readonly\s+string\[\];/);
	assert.equal(
		/\bid\?:\s*string;/.test(domainRp),
		false,
		"domain RP id is required (not wire id?)",
	);
	assert.equal(
		/\bname\?:\s*string;/.test(domainRp),
		false,
		"domain RP name is required (not wire name?)",
	);

	const wireRp = extractInterface(
		readPkg("src/auth/types.ts"),
		"AthenaPasskeyRelyingParty",
	);
	assert.match(wireRp, /\bid\?:\s*string;/);
	assert.match(wireRp, /\bname\?:\s*string;/);
	assert.equal(
		/\borigins\b/.test(wireRp),
		false,
		"wire RP must remain { id?: string; name?: string } this slice",
	);
	assert.equal(
		/\brelatedOrigins\b/.test(wireRp),
		false,
		"wire RP must not grow relatedOrigins this slice",
	);
});

test("Slice 01 target T-SRV-SURFACE: Object.keys(auth.passkey) remains the eight canonical methods", () => {
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
	const keys = Object.keys(createAuthModule().auth.passkey).sort();
	assert.deepEqual(keys, [...CANONICAL_PASSKEY_METHODS, "register", "signIn"].sort());

	const haystack = `${readPkg("src/auth/client.ts")}\n${readPkg("src/v3-client.ts")}\n${readPkg("src/index.ts")}`;
	for (const symbol of FORBIDDEN_CLIENTS) {
		assert.equal(
			haystack.includes(symbol),
			false,
			`must not introduce ${symbol}`,
		);
	}
	assert.equal(
		existsSync(join(srcRoot, "auth", "webauthn")),
		false,
		"src/auth/webauthn namespace directory must not exist",
	);
	assertNotPublicExport(
		readPkg("src/index.ts"),
		"createPasskeyClient",
		"src/index.ts",
	);
	assertNotPublicExport(
		readPkg("src/auth/index.ts"),
		"createPasskeyModule",
		"src/auth/index.ts",
	);
});

test("Slice 01 target T-SRV-FAIL-CLOSED: snapshot false; six remaining /passkey/* missing; construct throws; @simplewebauthn/server is server-only", async () => {
	assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
	assert.equal(
		readPkg("src/auth/capabilities.ts").includes("passkeyEnabled"),
		true,
		"advertised passkeys is catalog support AND auth.passkey.enabled",
	);

	const inventoryTest = readPkg("test/auth-route-inventory.test.ts");
	assert.match(inventoryTest, /const KNOWN_MISSING_IN_LOCAL = new Set\(/);
	for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
		assert.equal(
			inventoryTest.includes(`"${route}"`),
			false,
			`KNOWN_MISSING_IN_LOCAL must not list served ${route}`,
		);
	}
	const inventory = JSON.parse(
		readPkg("contracts/auth/routes.generated.json"),
	) as { missingInLocal: string[] };
	for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
		assert.equal(
			inventory.missingInLocal.includes(route),
			false,
			`routes.generated.json missingInLocal must not list ${route}`,
		);
	}
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

	const authParity = readFileSync(
		join(repoRoot, "docs/sdd/xylex/athena-finality/AUTH-PARITY.md"),
		"utf8",
	);
	assert.match(
		authParity,
		/WebAuthn\s*\/\s*passkeys\s*\|\s*\*\*FAIL-CLOSED\*\*/,
	);

	const pkgJson = JSON.parse(readPkg("package.json")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	assert.equal(
		typeof pkgJson.dependencies?.["@simplewebauthn/server"],
		"string",
		"@simplewebauthn/server is a server-only runtime dep for local register-options",
	);
	assert.equal(
		pkgJson.devDependencies?.["@simplewebauthn/server"],
		undefined,
		"@simplewebauthn/server must not be a package-root devDependency",
	);
	assert.equal(
		readPkg("src/browser.ts").includes("@simplewebauthn/server"),
		false,
		"browser entry must not import @simplewebauthn/server",
	);
	assert.equal(
		readPkg("src/auth/passkey/server/engine.ts").includes(
			"@simplewebauthn/server",
		),
		false,
		"engine.ts must not import @simplewebauthn/server",
	);

	const factorySrc = readPkg("src/auth/passkey/client-module.ts");
	assert.match(factorySrc, /function denyPasskeys\b/);
	assert.match(factorySrc, /sessionController\.accept/);
	assert.match(factorySrc, /\brequest\s*</);
	assert.equal(
		/passkey\/server|AthenaPasskeyServerEngine/.test(factorySrc),
		false,
		"createPasskeyModule must remain HTTP + denyPasskeys (not wired to local engine)",
	);

	let requestCalls = 0;
	const composed = createPasskeyModule({
		capabilities: {
			passkeys: false,
			source: "bootstrap",
			status: "known",
		},
		request: async () => {
			requestCalls += 1;
			return { data: {}, error: null, ok: true, raw: {}, status: 200 };
		},
		sessionController: { accept: () => undefined },
	});
	assert.deepEqual(
		Object.keys(composed).sort(),
		[...CANONICAL_PASSKEY_METHODS, "register", "signIn"].sort(),
	);
	for (const method of GATED_PASSKEY_METHODS) {
		const result = await composed[method]();
		assert.equal(result.ok, false, `${method} must deny when passkeys=false`);
		assert.equal(result.status, 501);
		assert.equal(result.errorDetails?.code, "ATHENA_AUTH_CAPABILITY_DISABLED");
	}
	assert.equal(requestCalls, 0);
	await composed.getRelatedOrigins();
	assert.equal(requestCalls, 1);
});

test("Slice 01 target T-SRV-START-CHALLENGE: start results declare challenge: Uint8Array", () => {
	const typesSrc = readServerFile("types.ts");
	const registration = extractInterface(
		typesSrc,
		"AthenaPasskeyRegistrationStartResult",
	);
	const authentication = extractInterface(
		typesSrc,
		"AthenaPasskeyAuthenticationStartResult",
	);
	assert.equal(
		hasRawChallengeField(registration),
		true,
		"AthenaPasskeyRegistrationStartResult.challenge must be Uint8Array (browser nonce, not persist hash)",
	);
	assert.equal(
		hasRawChallengeField(authentication),
		true,
		"AthenaPasskeyAuthenticationStartResult.challenge must be Uint8Array (browser nonce, not persist hash)",
	);
	assert.match(registration, /\bexcludeCredentialIds:/);
	assert.match(registration, /\brp:\s*AthenaPasskeyRelyingParty;/);
	assert.match(registration, /\btimeoutMs:\s*number\s*\|\s*null;/);
	assert.match(registration, /\buserId:\s*string;/);
	assert.match(authentication, /\ballowCredentialIds:/);
	assert.match(authentication, /\brp:\s*AthenaPasskeyRelyingParty;/);
	assert.match(authentication, /\btimeoutMs:\s*number\s*\|\s*null;/);

	const wireTypes = readPkg("src/auth/types.ts");
	const wireOptions = extractInterface(wireTypes, "AthenaPasskeyOptionsResponse");
	assert.match(
		wireOptions,
		/\bchallenge\?:\s*string;/,
		"wire AthenaPasskeyOptionsResponse.challenge must stay optional string (not domain Uint8Array)",
	);
});

test("Slice 01 target T-SRV-START-NO-HASH: start results must not declare challengeHash", () => {
	const typesSrc = readServerFile("types.ts");
	const registration = extractInterface(
		typesSrc,
		"AthenaPasskeyRegistrationStartResult",
	);
	const authentication = extractInterface(
		typesSrc,
		"AthenaPasskeyAuthenticationStartResult",
	);
	assert.equal(
		hasChallengeHashField(registration),
		false,
		"AthenaPasskeyRegistrationStartResult must not declare challengeHash (hash-at-rest is persist-only)",
	);
	assert.equal(
		hasChallengeHashField(authentication),
		false,
		"AthenaPasskeyAuthenticationStartResult must not declare challengeHash (hash-at-rest is persist-only)",
	);
});

test("Slice 01 target T-SRV-PERSIST-HASH-ONLY: Challenge/Create keep challengeHash and must not grow raw challenge", () => {
	const typesSrc = readServerFile("types.ts");
	const challenge = extractInterface(typesSrc, "AthenaPasskeyChallenge");
	const create = extractInterface(typesSrc, "AthenaPasskeyChallengeCreate");
	assert.match(challenge, /\bchallengeHash:\s*Uint8Array;/);
	assert.match(create, /\bchallengeHash:\s*Uint8Array;/);
	assert.equal(
		hasRawChallengeField(challenge),
		false,
		"AthenaPasskeyChallenge must not persist raw challenge (durable identity is the hash)",
	);
	assert.equal(
		hasRawChallengeField(create),
		false,
		"AthenaPasskeyChallengeCreate must not persist raw challenge",
	);
	assert.match(challenge, /\buserId:\s*string\s*\|\s*null;/);
	assert.match(create, /\buserId:\s*string\s*\|\s*null;/);
	assert.match(challenge, /\bpurpose:\s*AthenaPasskeyChallengePurpose;/);
	assert.match(challenge, /\brpId:\s*string;/);
	assert.match(create, /\bpurpose:\s*AthenaPasskeyChallengePurpose;/);
	assert.match(create, /\brpId:\s*string;/);
});

test("Slice 01 target T-SRV-CONSUME-USER: consume is {challengeHash, purpose, rpId, userId: string | null}", () => {
	const typesSrc = readServerFile("types.ts");
	const consume = extractInterface(typesSrc, "AthenaPasskeyChallengeConsume");
	assert.match(consume, /\bchallengeHash:\s*Uint8Array;/);
	assert.match(consume, /\bpurpose:\s*AthenaPasskeyChallengePurpose;/);
	assert.match(consume, /\brpId:\s*string;/);
	assert.match(
		consume,
		/\buserId:\s*string\s*\|\s*null;/,
		"AthenaPasskeyChallengeConsume.userId must be string | null (required field; null = discoverable auth, not omit-the-bind)",
	);
	assert.equal(
		/\buserId\?:/.test(consume),
		false,
		"consume userId is required on the object (null is the discoverable case, not optional omit)",
	);
	assert.equal(
		hasRawChallengeField(consume),
		false,
		"consume must bind challengeHash, not raw challenge",
	);

	const store = extractInterface(
		readServerFile("challenge-store.ts"),
		"PasskeyChallengeStore",
	);
	assert.match(
		store,
		/\bconsume\s*\(\s*input:\s*AthenaPasskeyChallengeConsume\s*\)/,
		"PasskeyChallengeStore.consume must still take AthenaPasskeyChallengeConsume (now including userId)",
	);
});

test("Slice 01 target T-SRV-REG-USER: registration start input/result require userId: string; consume binds that user (never null)", () => {
	const typesSrc = readServerFile("types.ts");
	const startInput = extractInterface(
		typesSrc,
		"AthenaPasskeyRegistrationStartInput",
	);
	const startResult = extractInterface(
		typesSrc,
		"AthenaPasskeyRegistrationStartResult",
	);
	const consume = extractInterface(typesSrc, "AthenaPasskeyChallengeConsume");
	assert.match(
		startInput,
		/\buserId:\s*string;/,
		"AthenaPasskeyRegistrationStartInput.userId must remain required string (authenticated)",
	);
	assert.equal(
		/\buserId:\s*string\s*\|\s*null;/.test(startInput),
		false,
		"registration start input must not allow null userId",
	);
	assert.match(
		startResult,
		/\buserId:\s*string;/,
		"AthenaPasskeyRegistrationStartResult.userId must remain required string (authenticated)",
	);
	assert.equal(
		/\buserId:\s*string\s*\|\s*null;/.test(startResult),
		false,
		"registration start result must not allow null userId",
	);
	assert.match(
		consume,
		/\buserId:\s*string\s*\|\s*null;/,
		"consume carries userId: string | null; registration callers must pass the authenticated string (never null)",
	);
});

test("Slice 01 target T-SRV-AUTHN-USER-NULL: authentication start input stays userId: string | null; discoverable consume may pass null", () => {
	const typesSrc = readServerFile("types.ts");
	const startInput = extractInterface(
		typesSrc,
		"AthenaPasskeyAuthenticationStartInput",
	);
	const consume = extractInterface(typesSrc, "AthenaPasskeyChallengeConsume");
	assert.match(
		startInput,
		/\buserId:\s*string\s*\|\s*null;/,
		"AthenaPasskeyAuthenticationStartInput.userId must remain string | null (discoverable auth)",
	);
	assert.match(
		consume,
		/\buserId:\s*string\s*\|\s*null;/,
		"discoverable authentication consume may pass userId: null (NULL-to-NULL bind; not skip-the-bind)",
	);
});
