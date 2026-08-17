/**
 * T-ADMIN-RUST-01 / T-ADMIN-EMBEDDED-01 shared Admin Auth contract.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_CREDENTIAL_PROVIDER_ID } from "../src/auth/contract/index.ts";
import { withPasswordHash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import {
	ATHENA_AUTH_ADMIN_SUITE_OPS,
	runAdminAuthParitySuite,
} from "../src/auth/parity/admin-suite.ts";

function createTestHasher() {
	return {
		async hash(password: string) {
			return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
		},
		needsRehash() {
			return false;
		},
		async verify(password: string, hash: string) {
			return hash.endsWith(Buffer.from(password).toString("base64url"));
		},
	};
}

test("T-ADMIN-EMBEDDED-01: shared admin suite covers catalog ops", () => {
	for (const op of [
		"admin-list-users",
		"admin-create-user",
		"admin-ban-user",
		"admin-impersonate-user",
		"admin-forbidden-for-user",
	]) {
		assert.equal(
			(ATHENA_AUTH_ADMIN_SUITE_OPS as readonly string[]).includes(op),
			true,
			`missing admin suite op ${op}`,
		);
	}
});

test("T-ADMIN-EMBEDDED-01: memory runtime passes the admin contract", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	const hash = await hasher.hash("AdminPass123!");
	await stores.createUser({
		email: "admin@example.com",
		emailVerified: true,
		id: "admin-1",
		metadata: withPasswordHash({}, hash),
		name: "Admin",
	});
	await stores.updateUser("admin-1", { role: "admin" });
	await stores.createAccount({
		accountId: "admin-1",
		id: "acct-admin",
		password: hash,
		providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
		userId: "admin-1",
	});
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const report = await runAdminAuthParitySuite({
		admin: { email: "admin@example.com", password: "AdminPass123!" },
		handle: (request) => runtime.handle(request),
		name: "embedded",
	});
	assert.equal(report.skipped, undefined);
	assert.equal(report.failed.length, 0, report.failed.join("; "));
	const covered = new Set([
		...report.passed,
		...report.deferred.map((row) => row.split(":")[0] ?? ""),
	]);
	for (const op of ATHENA_AUTH_ADMIN_SUITE_OPS) {
		assert.equal(
			covered.has(op),
			true,
			`catalog op neither passed nor deferred: ${op}`,
		);
	}
});

test("T-ADMIN-RUST-01: rust admin target is skip-with-reason without URL/admin", async () => {
	const report = await runAdminAuthParitySuite({
		admin:
			process.env.ATHENA_AUTH_ADMIN_EMAIL &&
			process.env.ATHENA_AUTH_ADMIN_PASSWORD
				? {
						email: process.env.ATHENA_AUTH_ADMIN_EMAIL,
						password: process.env.ATHENA_AUTH_ADMIN_PASSWORD,
					}
				: undefined,
		name: "rust",
		url: process.env.ATHENA_AUTH_URL,
	});
	if (process.env.ATHENA_AUTH_URL && process.env.ATHENA_AUTH_ADMIN_EMAIL) {
		assert.equal(report.skipped, undefined);
		assert.equal(report.failed.length, 0, report.failed.join("; "));
		return;
	}
	assert.equal(report.skipped, true);
	assert.match(report.reason ?? "", /ATHENA_AUTH_URL|ADMIN|skip/i);
});
