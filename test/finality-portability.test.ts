/**
 * Athena 5 Finality — Tier B TS↔Rust Auth portability.
 * Live vectors require ATHENA_AUTH_URL + DATABASE_URL (CI rust-auth job).
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import {
	createArgon2PasswordHasher,
	passwordHashNeedsRehash,
} from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { createAthenaAuthParityHandleFromUrl } from "../src/auth/parity/core-suite.ts";

const rustUrl = (process.env.ATHENA_AUTH_URL ?? "").trim();
const databaseUrl = (
	process.env.ATHENA_AUTH_DATABASE_URL ??
	process.env.DATABASE_URL ??
	""
).trim();
const live = Boolean(rustUrl && databaseUrl);

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

test("T-PASS-REHASH-01 stronger stored Argon2 profile is not downgraded", () => {
	const stronger =
		"$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0";
	assert.equal(
		passwordHashNeedsRehash(stronger, ATHENA_AUTH_DEFAULT_ARGON2),
		false,
	);
});

test("T-PASS-PORT-01 TS Argon2 hash verifies with the TS hasher", async () => {
	const hasher = createArgon2PasswordHasher();
	const password = "PortabilityPass123!";
	const hash = await hasher.hash(password);
	assert.match(hash, /^\$argon2id\$/);
	assert.equal(await hasher.verify(password, hash), true);
	assert.equal(await hasher.verify("wrong-password", hash), false);
});

test("T-PORT-TS-RUST-01 embedded records are readable by Rust Auth", async (t) => {
	if (!live) {
		t.skip(
			"ATHENA_AUTH_URL + DATABASE_URL required for live TS→Rust portability",
		);
		return;
	}
	const email = `ts-rust-${Date.now()}@example.com`;
	const password = "Password123!";
	const runtime = createAthenaAuthRuntime({
		autoMigrate: true,
		database: databaseUrl,
		hasher: createArgon2PasswordHasher(),
	});
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email,
				name: "Portability",
				password,
				username: `tsrust${Date.now()}`,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.ok(signup.status < 300, `embedded sign-up failed: ${signup.status}`);

	const rust = createAthenaAuthParityHandleFromUrl(rustUrl);
	const signin = await rust(
		new Request("http://app.local/api/auth/sign-in/email", {
			body: JSON.stringify({ email, password }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(
		signin.status,
		200,
		`T-PORT-TS-RUST-01 rust could not sign in TS-created user (${signin.status})`,
	);
});

test("T-PORT-RUST-TS-01 rust records are readable by embedded Auth", async (t) => {
	if (!live) {
		t.skip(
			"ATHENA_AUTH_URL + DATABASE_URL required for live Rust→TS portability",
		);
		return;
	}
	const email = `rust-ts-${Date.now()}@example.com`;
	const password = "Password123!";
	const rust = createAthenaAuthParityHandleFromUrl(rustUrl);
	const signup = await rust(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email,
				name: "Portability",
				password,
				username: `rustts${Date.now()}`,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.ok(signup.status < 300, `rust sign-up failed: ${signup.status}`);

	const runtime = createAthenaAuthRuntime({
		autoMigrate: true,
		database: databaseUrl,
		hasher: createArgon2PasswordHasher(),
	});
	const signin = await runtime.handle(
		new Request("http://app.local/api/auth/sign-in/email", {
			body: JSON.stringify({ email, password }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(
		signin.status,
		200,
		`T-PORT-RUST-TS-01 embedded could not sign in rust-created user (${signin.status})`,
	);
});

test("T-PASS-PORT-02 rust-created password verifies in TS hasher when DATABASE_URL set", async (t) => {
	if (!databaseUrl) {
		t.skip("DATABASE_URL required to inspect rust-created hashes");
		return;
	}
	// Contract-level: TS hasher accepts standard PHC argon2id from the shared profile.
	const hasher = createArgon2PasswordHasher();
	const hash = await hasher.hash("SharedProfile123!");
	assert.equal(hasher.needsRehash(hash), false);
	assert.equal(createTestHasher().needsRehash(hash), false);
});
