/**
 * T-PORT-ADMIN-01 — TS↔Rust Admin Auth portability against one database.
 * Live only when ATHENA_AUTH_URL + DATABASE_URL are set.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_ADMIN_PATHS } from "../src/auth/local/admin-contract.ts";
import { createArgon2PasswordHasher } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { createAthenaAuthParityHandleFromUrl } from "../src/auth/parity/admin-suite.ts";

const rustUrl = (process.env.ATHENA_AUTH_URL ?? "").trim();
const databaseUrl = (
	process.env.ATHENA_AUTH_DATABASE_URL ??
	process.env.DATABASE_URL ??
	""
).trim();
const adminEmail = (process.env.ATHENA_AUTH_ADMIN_EMAIL ?? "").trim();
const adminPassword = (process.env.ATHENA_AUTH_ADMIN_PASSWORD ?? "").trim();
const live = Boolean(rustUrl && databaseUrl && adminEmail && adminPassword);

test("T-PORT-ADMIN-01 TS-created admin user is readable by Rust Auth", async (t) => {
	if (!live) {
		t.skip(
			"ATHENA_AUTH_URL + DATABASE_URL + ATHENA_AUTH_ADMIN_EMAIL/PASSWORD required",
		);
		return;
	}

	const hasher = createArgon2PasswordHasher();
	const ts = createAthenaAuthRuntime({
		autoMigrate: true,
		database: databaseUrl,
		hasher,
	});
	const rust = createAthenaAuthParityHandleFromUrl(rustUrl);
	const origin = "http://app.local/api/auth";
	const headers = {
		"content-type": "application/json",
		origin: "http://app.local",
	};

	const adminSignin = await ts.handle(
		new Request(`${origin}/sign-in/email`, {
			body: JSON.stringify({ email: adminEmail, password: adminPassword }),
			headers,
			method: "POST",
		}),
	);
	const cookie = adminSignin.headers.get("set-cookie") ?? "";
	assert.equal(adminSignin.status, 200, "embedded admin sign-in failed");

	const email = `ts-port-${Date.now()}@example.com`;
	const password = "PortPass123!";
	const created = await ts.handle(
		new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.createUser}`, {
			body: JSON.stringify({ email, name: "Port", password }),
			headers: { ...headers, cookie },
			method: "POST",
		}),
	);
	assert.ok(
		created.status < 300,
		`embedded admin create failed: ${created.status}`,
	);

	const rustSignin = await rust(
		new Request(`${origin}/sign-in/email`, {
			body: JSON.stringify({ email, password }),
			headers,
			method: "POST",
		}),
	);
	assert.equal(
		rustSignin.status,
		200,
		`T-PORT-ADMIN-01 rust could not sign in TS-created admin user (${rustSignin.status})`,
	);
});

test("T-PORT-ADMIN-02 rust-created user is operable from embedded Auth", async (t) => {
	if (!live) {
		t.skip(
			"ATHENA_AUTH_URL + DATABASE_URL + ATHENA_AUTH_ADMIN_EMAIL/PASSWORD required",
		);
		return;
	}

	const rust = createAthenaAuthParityHandleFromUrl(rustUrl);
	const origin = "http://app.local/api/auth";
	const headers = {
		"content-type": "application/json",
		origin: "http://app.local",
	};
	const adminSignin = await rust(
		new Request(`${origin}/sign-in/email`, {
			body: JSON.stringify({ email: adminEmail, password: adminPassword }),
			headers,
			method: "POST",
		}),
	);
	const cookie = adminSignin.headers.get("set-cookie") ?? "";
	const email = `rust-port-${Date.now()}@example.com`;
	const password = "PortPass123!";
	const created = await rust(
		new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.createUser}`, {
			body: JSON.stringify({ email, name: "RustPort", password }),
			headers: { ...headers, cookie },
			method: "POST",
		}),
	);
	assert.ok(
		created.status < 300,
		`rust admin create failed: ${created.status}`,
	);

	const ts = createAthenaAuthRuntime({
		autoMigrate: true,
		database: databaseUrl,
		hasher: createArgon2PasswordHasher(),
	});
	const signed = await ts.handle(
		new Request(`${origin}/sign-in/email`, {
			body: JSON.stringify({ email, password }),
			headers,
			method: "POST",
		}),
	);
	assert.equal(
		signed.status,
		200,
		`T-PORT-ADMIN-02 embedded could not sign in rust-created user (${signed.status})`,
	);
});
