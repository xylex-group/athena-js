/**
 * Embedded Admin Auth runtime + public namespace.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createAuthModule } from "../src/auth/client.ts";
import { ATHENA_AUTH_CREDENTIAL_PROVIDER_ID } from "../src/auth/contract/index.ts";
import {
	assertPublicAdminUserSafe,
	canAssignRole,
} from "../src/auth/local/admin-contract.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import { withPasswordHash } from "../src/auth/local/password.ts";
import { createClient } from "../src/v3-client.ts";

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

async function seedAdmin(
	stores: MemoryAuthStores,
	hasher = createTestHasher(),
) {
	const hash = await hasher.hash("AdminPass123!");
	await stores.createUser({
		email: "admin@example.com",
		emailVerified: true,
		id: "admin-1",
		metadata: withPasswordHash({}, hash),
		name: "Admin",
		username: "admin",
	});
	await stores.updateUser("admin-1", { role: "admin" });
	await stores.createAccount({
		accountId: "admin-1",
		id: "acct-admin",
		password: hash,
		providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
		userId: "admin-1",
	});
}

async function signIn(
	runtime: ReturnType<typeof createAthenaAuthRuntime>,
	email = "admin@example.com",
	password = "AdminPass123!",
) {
	const response = await runtime.handle(
		new Request("http://app.local/api/auth/sign-in/email", {
			body: JSON.stringify({ email, password }),
			headers: {
				"content-type": "application/json",
				origin: "http://app.local",
			},
			method: "POST",
		}),
	);
	const cookie = response.headers.get("set-cookie") ?? "";
	const body = (await response.json()) as { token?: string };
	return { cookie, status: response.status, token: body.token };
}

test("T-ADMIN-01 canAssignRole prevents privilege escalation", () => {
	assert.equal(canAssignRole("admin", "user"), true);
	assert.equal(canAssignRole("admin", "admin"), false);
	assert.equal(canAssignRole("admin", "superadmin"), false);
	assert.equal(canAssignRole("admin", "owner"), false);
	assert.equal(canAssignRole("superadmin", "admin"), true);
	assert.equal(canAssignRole("superadmin", "owner"), false);
	assert.equal(canAssignRole("owner", "superadmin"), true);
	assert.equal(canAssignRole("user", "admin"), false);
});

test("T-ADMIN-02 runtime wires listUsers without FEATURE_UNSUPPORTED", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	await seedAdmin(stores, hasher);
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const { cookie, status } = await signIn(runtime);
	assert.equal(status, 200);
	const listed = await runtime.handle(
		new Request("http://app.local/api/auth/admin/list-users", {
			headers: { cookie, origin: "http://app.local" },
		}),
	);
	assert.equal(listed.status, 200);
	const body = (await listed.json()) as {
		users: Array<Record<string, unknown>>;
	};
	assert.ok(body.users.length >= 1);
	assertPublicAdminUserSafe(body.users[0]);
});

test("T-ADMIN-03 createUser produces a sign-inable credential", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	await seedAdmin(stores, hasher);
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const { cookie } = await signIn(runtime);
	const created = await runtime.handle(
		new Request("http://app.local/api/auth/admin/create-user", {
			body: JSON.stringify({
				email: "member@example.com",
				name: "Member",
				password: "MemberPass123!",
			}),
			headers: {
				"content-type": "application/json",
				cookie,
				origin: "http://app.local",
			},
			method: "POST",
		}),
	);
	assert.equal(created.status, 200, await created.clone().text());
	const createdBody = (await created.json()) as { user: { id: string } };
	assertPublicAdminUserSafe(createdBody);
	const signed = await signIn(runtime, "member@example.com", "MemberPass123!");
	assert.equal(signed.status, 200);
});

test("T-ADMIN-04 expired ban is treated as unbanned", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	await seedAdmin(stores, hasher);
	const hash = await hasher.hash("BannedPass123!");
	await stores.createUser({
		email: "banned@example.com",
		id: "banned-1",
		metadata: withPasswordHash({}, hash),
		name: "Banned",
	});
	await stores.updateUser("banned-1", {
		banExpires: new Date(Date.now() - 60_000),
		banReason: "old",
		banned: true,
	});
	await stores.createAccount({
		accountId: "banned-1",
		id: "acct-banned",
		password: hash,
		providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
		userId: "banned-1",
	});
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const signed = await signIn(runtime, "banned@example.com", "BannedPass123!");
	assert.equal(signed.status, 200);
	const refreshed = await stores.getUserById("banned-1");
	assert.equal(refreshed?.banned, false);
});

test("T-ADMIN-05 active ban rejects sign-in and session", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	await seedAdmin(stores, hasher);
	const hash = await hasher.hash("StillBanned123!");
	await stores.createUser({
		email: "still@example.com",
		id: "still-1",
		metadata: withPasswordHash({}, hash),
		name: "Still",
	});
	await stores.updateUser("still-1", { banned: true });
	await stores.createAccount({
		accountId: "still-1",
		id: "acct-still",
		password: hash,
		providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
		userId: "still-1",
	});
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const signed = await signIn(runtime, "still@example.com", "StillBanned123!");
	assert.equal(signed.status, 403);
});

test("T-ADMIN-06 non-admin is forbidden", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	await seedAdmin(stores, hasher);
	const hash = await hasher.hash("UserPass123!");
	await stores.createUser({
		email: "user@example.com",
		id: "user-1",
		metadata: withPasswordHash({}, hash),
		name: "User",
	});
	await stores.createAccount({
		accountId: "user-1",
		id: "acct-user",
		password: hash,
		providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
		userId: "user-1",
	});
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const { cookie } = await signIn(runtime, "user@example.com", "UserPass123!");
	const listed = await runtime.handle(
		new Request("http://app.local/api/auth/admin/list-users", {
			headers: { cookie, origin: "http://app.local" },
		}),
	);
	assert.equal(listed.status, 403);
});

test("T-ADMIN-07 admin cannot assign superadmin", async () => {
	const stores = new MemoryAuthStores();
	const hasher = createTestHasher();
	await seedAdmin(stores, hasher);
	const hash = await hasher.hash("TargetPass123!");
	await stores.createUser({
		email: "target@example.com",
		id: "target-1",
		metadata: withPasswordHash({}, hash),
		name: "Target",
	});
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher,
		stores,
	});
	const { cookie } = await signIn(runtime);
	const response = await runtime.handle(
		new Request("http://app.local/api/auth/admin/set-role", {
			body: JSON.stringify({ role: "superadmin", userId: "target-1" }),
			headers: {
				"content-type": "application/json",
				cookie,
				origin: "http://app.local",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
});

test("T-ADMIN-08 public client namespace is athena.auth.admin.*", () => {
	const client = createAuthModule({
		apiKey: "k",
		baseUrl: "https://auth.example.test",
	});
	assert.equal(typeof client.auth.admin.listUsers, "function");
	assert.equal(typeof client.auth.admin.createUser, "function");
	assert.equal(typeof client.auth.admin.banUser, "function");
	assert.equal(typeof client.auth.admin.impersonateUser, "function");
	assert.equal(typeof client.auth.admin.stopImpersonating, "function");
});

test("T-ADMIN-09 createClient does not reject admin namespace usage", () => {
	const client = createClient({
		auth: { url: "https://auth.example.test" },
		env: {},
		key: "k",
		url: "https://athena.example.com",
	});
	assert.equal(typeof client.auth.admin.listUsers, "function");
});
