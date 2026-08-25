/**
 * Target: Canonical HTTP Principal Authority DESIRED foundation.
 * RED on CURRENT until src/runtime/authority/ lands; GREEN after extract.
 * See docs/sdd/xylex/athena-js-http-principal-authority/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import {
	ATHENA_MALFORMED_RIGHTS_KIND,
	subscribeAthenaMalformedRightsDiagnostics,
} from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authorityDir = join(srcRoot, "runtime", "authority");

const AUTHORITY_FILES = ["headers.ts", "resolve.ts", "index.ts"] as const;

const FORBIDDEN_PRINCIPAL_NAMES = [
	"AthenaHttpPrincipal",
	"createPrincipalClient",
	"createAuthorityClient",
] as const;

const IDENTITY_HEADERS = {
	"x-athena-user-id": "user-c",
	"x-grants": "admin",
	"x-rights": "invoice.read",
	"x-role": "admin",
	"x-service": "billing-worker",
	"x-user-id": "user-b",
} as const;

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
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
		if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

function joinedSources(dir: string): string {
	return collectTsFiles(dir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
}

async function loadAuthority(): Promise<typeof import("../../src/runtime/authority/index.ts")> {
	assert.equal(existsSync(join(authorityDir, "index.ts")), true);
	return import(pathToFileURL(join(authorityDir, "index.ts")).href);
}

test("T-AUTH-DIR: P?: src/runtime/authority/ exists", () => {
	assert.equal(existsSync(authorityDir), true);
	for (const name of AUTHORITY_FILES) {
		assert.equal(existsSync(join(authorityDir, name)), true, name);
	}
});

test("T-AUTH-RESOLVE-EXPORT: P?: resolveAthenaRuntimePrincipal is defined in authority", () => {
	const src = readSrc("runtime/authority/resolve.ts");
	assert.match(src, /export async function resolveAthenaRuntimePrincipal/);
});

test("T-AUTH-DATA-REEXPORT: P?: Data resolve-principal re-exports authority", () => {
	const src = readSrc("runtime/data/resolve-principal.ts");
	assert.match(src, /from ["']\.\.\/authority\//);
	assert.equal(/export async function resolveAthenaRuntimePrincipal/.test(src), false);
});

test("T-AUTH-EXECUTOR-IMPORT: P?: Data executor imports runtime/authority", () => {
	const src = readSrc("runtime/data/executor.ts");
	assert.match(src, /runtime\/authority|from ["']\.\.\/authority\//);
});

test("T-AUTH-GATEWAY-IMPORT: P?: Gateway adapter imports runtime/authority", () => {
	const src = readSrc("gateway/server/adapter.ts");
	assert.match(src, /runtime\/authority\//);
});

test("T-AUTH-CHAT-IMPORT: P?: Chat principal resolver imports runtime/authority", () => {
	const src = readSrc("chat/local/principal.ts");
	assert.match(src, /runtime\/authority\//);
});

test("T-AUTH-SERVER-ONLY: P?: authority resolve is server-only", () => {
	const src = readSrc("runtime/authority/resolve.ts");
	assert.match(src, /import ["']server-only["']/);
});

test("T-AUTH-NO-SECOND-MODEL: P?: no second principal model", () => {
	const blob = joinedSources(srcRoot);
	for (const name of FORBIDDEN_PRINCIPAL_NAMES) {
		assert.equal(blob.includes(name), false, name);
	}
});

test("T-AUTH-NO-PUBLIC-EXPORT: P?: no public ./authority export", () => {
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	assert.equal(pkg.exports?.["./authority"], undefined);
	const tsup = readFileSync(join(pkgRoot, "tsup.config.ts"), "utf8");
	assert.equal(/authority:\s*["']src\/runtime\/authority/.test(tsup), false);
});

test("T-AUTH-TYPES-REUSE: P?: AthenaPrincipal types remain Data SSOT", () => {
	const src = readSrc("runtime/data/principal.ts");
	assert.match(src, /export interface AthenaPrincipal \{/);
	assert.match(src, /export interface AthenaResolvedPrincipal \{/);
	assert.match(src, /export type AthenaPrincipalAuthority/);
	assert.match(src, /rights:\s*readonly AthenaRightKey\[\]/);
	assert.match(src, /grants:\s*readonly string\[\]/);
	assert.match(src, /tryParseAthenaRightKey/);
});

test("T-AUTH-HEADERS-NOT-IDENTITY: P?: request identity headers are authentication material not trusted identity", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async (token) => {
				if (token !== "sess_a") {
					return null;
				}
				return {
					session: {
						activeOrganizationId: "org_1",
						id: "session-a",
						userId: "user-a",
					},
					user: {
						grants: ["legacy-grant"],
						id: "user-a",
						rights: ["users.read", "admin:read"],
						role: "member",
					},
				};
			},
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{
			headers: {
				cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_a`,
				...IDENTITY_HEADERS,
			},
		},
	);
	assert.equal(outcome.ok, true);
	if (!outcome.ok) {
		return;
	}
	assert.equal(outcome.resolved.authority, "athena-session");
	assert.equal(outcome.resolved.principal.userId, "user-a");
	assert.equal(outcome.resolved.principal.role, "member");
	assert.equal(outcome.resolved.principal.organizationId, "org_1");
	assert.equal(outcome.resolved.principal.service, undefined);
	assert.deepEqual([...outcome.resolved.principal.grants], ["legacy-grant"]);
	assert.deepEqual(
		outcome.resolved.principal.rights.map((key) => String(key)),
		["users.read"],
	);
});

test("T-AUTH-BEARER: P?: Bearer token is session lookup material", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async (token) =>
				token === "sess_bearer"
					? {
							session: { id: "session-bearer", userId: "user-a" },
							user: { id: "user-a" },
						}
					: null,
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{
			headers: {
				authorization: "Bearer sess_bearer",
				...IDENTITY_HEADERS,
			},
		},
	);
	assert.equal(outcome.ok, true);
	if (!outcome.ok) {
		return;
	}
	assert.equal(outcome.resolved.principal.userId, "user-a");
});

test("T-AUTH-COOKIE: P?: session cookie is session lookup material", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async (token) =>
				token === "sess_cookie"
					? {
							session: { id: "session-cookie", userId: "user-a" },
							user: { id: "user-a" },
						}
					: null,
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{
			headers: {
				cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_cookie`,
				...IDENTITY_HEADERS,
			},
		},
	);
	assert.equal(outcome.ok, true);
	if (!outcome.ok) {
		return;
	}
	assert.equal(outcome.resolved.principal.userId, "user-a");
});

test("T-AUTH-EXPIRED: P?: expired session remains ATHENA_AUTH_SESSION_EXPIRED", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async () => ({
				session: {
					expiresAt: "2000-01-01T00:00:00.000Z",
					id: "session-expired",
					userId: "user-a",
				},
				user: { id: "user-a" },
			}),
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{ headers: { authorization: "Bearer sess_expired" } },
	);
	assert.equal(outcome.ok, false);
	if (outcome.ok) {
		return;
	}
	assert.equal(outcome.failure.code, "ATHENA_AUTH_SESSION_EXPIRED");
});

test("T-AUTH-REVOKED: P?: revoked session remains ATHENA_AUTH_INVALID_SESSION", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async () => ({
				session: { id: "session-revoked", revoked: true, userId: "user-a" },
				user: { id: "user-a" },
			}),
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{ headers: { authorization: "Bearer sess_revoked" } },
	);
	assert.equal(outcome.ok, false);
	if (outcome.ok) {
		return;
	}
	assert.equal(outcome.failure.code, "ATHENA_AUTH_INVALID_SESSION");
});

test("T-AUTH-BANNED: P?: banned user remains ATHENA_AUTH_INVALID_SESSION", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async () => ({
				session: { id: "session-banned", userId: "user-banned" },
				user: { banned: true, id: "user-banned" },
			}),
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{ headers: { authorization: "Bearer sess_banned" } },
	);
	assert.equal(outcome.ok, false);
	if (outcome.ok) {
		return;
	}
	assert.equal(outcome.failure.code, "ATHENA_AUTH_INVALID_SESSION");
});

test("T-AUTH-ORG-HINT: P?: organization header is a membership hint", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			lookupSession: async () => ({
				session: {
					activeOrganizationId: "org_1",
					id: "session-a",
					userId: "user-a",
				},
				user: { id: "user-a" },
			}),
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{
			headers: {
				authorization: "Bearer sess_a",
				"x-athena-organization": "org_evil",
			},
		},
	);
	assert.equal(outcome.ok, false);
	if (outcome.ok) {
		return;
	}
	assert.equal(outcome.failure.code, "ATHENA_AUTH_ORG_NOT_ALLOWED");
});

test("T-AUTH-RIGHTS: P?: rights normalize to AthenaRightKey[] and grants stay provenance", async () => {
	const authority = await loadAuthority();
	const seen: Array<{
		kind: string;
		malformedKeyCount: number;
		source: string;
	}> = [];
	const unsubscribe = subscribeAthenaMalformedRightsDiagnostics((diagnostic) => {
		seen.push(diagnostic);
	});
	const originalWarn = console.warn;
	console.warn = () => undefined;
	try {
		const material = authority.normalizeAthenaRuntimeAuth(
			{
				lookupSession: async () => ({
					session: { id: "session-a", userId: "user-a" },
					user: {
						grants: ["users.read"],
						id: "user-a",
						rights: ["users.read", "admin:read", "not a right"],
					},
				}),
				mode: "athena-session",
			},
			"authenticated",
		);
		const outcome = await authority.resolveAthenaRuntimePrincipal(
			material,
			"authenticated",
			{ headers: { authorization: "Bearer sess_a" } },
		);
		assert.equal(outcome.ok, true);
		if (!outcome.ok) {
			return;
		}
		assert.deepEqual(
			outcome.resolved.principal.rights.map((key) => String(key)),
			["users.read"],
		);
		assert.deepEqual([...outcome.resolved.principal.grants], ["users.read"]);
		assert.equal(seen.length, 1);
		assert.equal(seen[0]?.kind, ATHENA_MALFORMED_RIGHTS_KIND);
		assert.equal(seen[0]?.source, "athena-session");
		assert.equal(seen[0]?.malformedKeyCount, 2);
	} finally {
		console.warn = originalWarn;
		unsubscribe();
	}
});

test("T-AUTH-SERVICE: P?: service principal ignores identity headers", async () => {
	const authority = await loadAuthority();
	const material = authority.normalizeAthenaRuntimeAuth(
		{
			mode: "service",
			principal: {
				authenticated: true,
				service: "worker",
				userId: "svc-1",
			},
		},
		"authenticated",
	);
	const outcome = await authority.resolveAthenaRuntimePrincipal(
		material,
		"authenticated",
		{ headers: { ...IDENTITY_HEADERS } },
	);
	assert.equal(outcome.ok, true);
	if (!outcome.ok) {
		return;
	}
	assert.equal(outcome.resolved.authority, "service");
	assert.equal(outcome.resolved.principal.service, "worker");
	assert.equal(outcome.resolved.principal.userId, "svc-1");
});

test("T-AUTH-NO-STORAGE-BILLING: P?: Storage and Billing do not import authority resolve this slice", () => {
	const athenaRuntimeAuthorityImport =
		/from ["'][^"']*\/runtime\/authority\//;
	assert.equal(
		athenaRuntimeAuthorityImport.test(joinedSources(join(srcRoot, "storage"))),
		false,
	);
	assert.equal(
		athenaRuntimeAuthorityImport.test(joinedSources(join(srcRoot, "billing"))),
		false,
	);
});

test("T-AUTH-BROWSER-SAFE: P?: browser bundles stay free of server-only Auth/session material", () => {
	const browser = readSrc("browser.ts");
	const nextClient = readSrc("next/client.ts");
	const rn = readSrc("react-native/index.ts");
	for (const [name, src] of [
		["browser.ts", browser],
		["next/client.ts", nextClient],
		["react-native/index.ts", rn],
	] as const) {
		assert.equal(src.includes("runtime/authority"), false, name);
		assert.equal(src.includes("auth/local/runtime"), false, name);
		assert.equal(src.includes("auth/local/database"), false, name);
	}
	const headers = readSrc("runtime/authority/headers.ts");
	assert.match(headers, /NON_AUTHORITATIVE_IDENTITY_HEADERS/);
	assert.match(headers, /x-user-id/);
});
