/**
 * Retired characterization baseline for Canonical HTTP Principal Authority.
 * Layout cells FAIL after src/runtime/authority/. Keep-green cells still pass.
 * SSOT: test/sdd/athena-js-http-principal-authority.target.test.ts
 * See docs/sdd/xylex/athena-js-http-principal-authority/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../../src/auth/contract/index.ts";
import {
	normalizeAthenaRuntimeAuth,
	resolveAthenaRuntimePrincipal,
} from "../../../src/runtime/data/resolve-principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

test("B-AUTH-NO-DIR: P?: src/runtime/authority/ does not exist", () => {
	assert.equal(existsSync(join(srcRoot, "runtime", "authority")), false);
});

test("B-AUTH-RESOLVE-IN-DATA: P?: resolveAthenaRuntimePrincipal is defined in runtime/data", () => {
	const src = readSrc("runtime/data/resolve-principal.ts");
	assert.match(src, /export async function resolveAthenaRuntimePrincipal/);
});

test("B-AUTH-EXECUTOR-DATA: P?: Data executor imports resolve-principal from Data", () => {
	const src = readSrc("runtime/data/executor.ts");
	assert.match(src, /from ["']\.\/resolve-principal\.ts["']/);
	assert.equal(src.includes("runtime/authority"), false);
});

test("B-AUTH-GATEWAY-DATA: P?: Gateway adapter imports Data resolve-principal", () => {
	const src = readSrc("gateway/server/adapter.ts");
	assert.match(src, /runtime\/data\/resolve-principal\.ts/);
	assert.equal(src.includes("runtime/authority"), false);
});

test("B-AUTH-HEADERS-NOT-IDENTITY: P?: request identity headers are not trusted identity authority", async () => {
	const material = normalizeAthenaRuntimeAuth(
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
					user: { id: "user-a", role: "member" },
				};
			},
			mode: "athena-session",
		},
		"authenticated",
	);
	const outcome = await resolveAthenaRuntimePrincipal(material, "authenticated", {
		headers: {
			cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_a`,
			"x-grants": "admin",
			"x-rights": "invoice.read",
			"x-role": "admin",
			"x-service": "billing-worker",
			"x-user-id": "user-b",
			"x-athena-user-id": "user-c",
		},
	});
	assert.equal(outcome.ok, true);
	if (!outcome.ok) {
		return;
	}
	assert.equal(outcome.resolved.authority, "athena-session");
	assert.equal(outcome.resolved.principal.userId, "user-a");
	assert.equal(outcome.resolved.principal.role, "member");
	assert.equal(outcome.resolved.principal.organizationId, "org_1");
	assert.equal(outcome.resolved.principal.service, undefined);
	assert.deepEqual([...outcome.resolved.principal.grants], []);
});

test("B-AUTH-NO-SECOND-MODEL: P?: no AthenaHttpPrincipal or createPrincipalClient", () => {
	const blob = [
		readSrc("runtime/data/principal.ts"),
		readSrc("runtime/data/resolve-principal.ts"),
		readSrc("runtime/data/executor.ts"),
	].join("\n");
	assert.equal(blob.includes("AthenaHttpPrincipal"), false);
	assert.equal(blob.includes("createPrincipalClient"), false);
	assert.equal(blob.includes("createAuthorityClient"), false);
});

test("B-AUTH-TYPES-SSOT: P?: AthenaPrincipal remains in runtime/data/principal.ts", () => {
	const src = readSrc("runtime/data/principal.ts");
	assert.match(src, /export interface AthenaPrincipal/);
	assert.match(src, /export interface AthenaResolvedPrincipal/);
	assert.match(src, /export type AthenaPrincipalAuthority/);
});

test("B-AUTH-NO-PUBLIC-EXPORT: P?: package.json exports have no ./authority", () => {
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	assert.equal(pkg.exports?.["./authority"], undefined);
});
