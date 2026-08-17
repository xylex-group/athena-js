/**
 * Athena 5 Finality — T-PAR-01 dual-runtime contract suite.
 * Public seam: black-box Auth HTTP contract, not internals.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
	ATHENA_AUTH_CORE_SUITE_OPS,
	ATHENA_AUTH_CORE_SUITE_SPEC,
	runAthenaAuthParitySuite,
} from "../src/auth/parity/core-suite.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";

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

test("T-PAR-01: core suite lists AUTH-PARITY password-session operations", () => {
	const required = [
		"sign-up",
		"sign-in",
		"username-sign-in",
		"sign-out",
		"get-session",
		"refresh-session",
		"password-reset",
		"password-change",
		"session-list-revoke",
		"accounts",
		"email-verification",
		"change-email",
		"delete-user",
		"api-keys",
		"totp",
		"organizations",
		"members",
		"invitations",
		"error-envelope",
		"cookies",
		"headers",
		"trace-ids",
		"origin-enforcement",
		"rate-limits",
	];
	for (const op of required) {
		assert.equal(
			(ATHENA_AUTH_CORE_SUITE_OPS as readonly string[]).includes(op),
			true,
			`missing core suite row: ${op}`,
		);
	}
});

test("T-PAR-01: embedded target runs the core black-box loop", async () => {
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: createTestHasher(),
	});
	const report = await runAthenaAuthParitySuite({
		handle: (request) => runtime.handle(request),
		name: "embedded",
	});
	assert.equal(report.target, "embedded");
	assert.equal(report.failed.length, 0, report.failed.join("; "));
	assert.equal(report.passed.length >= 4, true);
	const covered = new Set([
		...report.passed,
		...report.deferred.map((row) => row.split(":")[0] ?? ""),
	]);
	for (const op of ATHENA_AUTH_CORE_SUITE_OPS) {
		assert.equal(
			covered.has(op),
			true,
			`catalog op neither passed nor deferred: ${op}`,
		);
	}
});

test("T-PAR-01: rust target without ATHENA_AUTH_URL is skip-with-reason", async () => {
	const report = await runAthenaAuthParitySuite({
		name: "rust",
		url: process.env.ATHENA_AUTH_URL,
	});
	if (process.env.ATHENA_AUTH_URL) {
		assert.equal(typeof report.failed, "object");
		return;
	}
	if (process.env.ATHENA_PARITY_REQUIRE_RUST === "1") {
		assert.notEqual(report.skipped, true);
		assert.equal(report.failed.length > 0, true);
		return;
	}
	assert.equal(report.skipped, true);
	assert.match(report.reason ?? "", /ATHENA_AUTH_URL|skip/i);
});

test("T-PAR-01: every core op is classified required, optional, or unsupported", () => {
	for (const op of ATHENA_AUTH_CORE_SUITE_OPS) {
		const spec = ATHENA_AUTH_CORE_SUITE_SPEC[op];
		assert.ok(spec, `missing classification for ${op}`);
		assert.equal(
			["required", "optional", "unsupported"].includes(spec.capability),
			true,
			`${op} has invalid capability ${spec.capability}`,
		);
	}
	assert.equal(
		ATHENA_AUTH_CORE_SUITE_SPEC["rate-limits"].capability,
		"optional",
	);
	assert.equal(
		ATHENA_AUTH_CORE_SUITE_SPEC["delete-user"].capability,
		"optional",
	);
	assert.equal(ATHENA_AUTH_CORE_SUITE_SPEC["delete-user"].destructive, true);
	assert.equal(ATHENA_AUTH_CORE_SUITE_SPEC["sign-in"].capability, "required");
	assert.equal(
		ATHENA_AUTH_CORE_SUITE_SPEC["username-sign-in"].capability,
		"required",
	);
});
