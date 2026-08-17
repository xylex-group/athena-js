import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";
import type { AthenaAuthAdminStore } from "../src/auth/local/admin-contract.ts";
import { handleAdminRoute } from "../src/auth/local/admin-routes.ts";
import type { AuthSessionRow, AuthUserRow } from "../src/auth/local/models.ts";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function user(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
	return {
		ban_expires: null,
		ban_reason: null,
		banned: false,
		created_at: NOW,
		display_username: null,
		email: "admin@example.com",
		email_verified: true,
		id: "admin-1",
		image: null,
		last_sign_in_at: null,
		metadata: { password_hash: "must-never-leak" },
		name: "Admin",
		role: "admin",
		two_factor_enabled: false,
		updated_at: NOW,
		username: "admin",
		...overrides,
	};
}

function session(overrides: Partial<AuthSessionRow> = {}): AuthSessionRow {
	return {
		active: true,
		active_organization_id: null,
		created_at: NOW,
		expires_at: new Date("2026-08-16T12:00:00.000Z"),
		id: "session-1",
		impersonated_by: null,
		ip_address: null,
		token: "session-token",
		updated_at: NOW,
		user_agent: null,
		user_id: "admin-1",
		...overrides,
	};
}

function store(
	overrides: Partial<AthenaAuthAdminStore> = {},
): AthenaAuthAdminStore {
	return {
		createImpersonationSession: async (input) =>
			session({
				id: input.id,
				impersonated_by: input.impersonatedBy,
				token: input.token,
				user_id: input.userId,
			}),
		createUser: async (input) =>
			user({ email: input.email, id: input.id, role: input.role ?? null }),
		deleteSession: async () => true,
		deleteUser: async () => true,
		deleteUserSessions: async () => 2,
		getUser: async (id) =>
			user({
				id,
				role: id === "admin-1" ? "admin" : "user",
			}),
		getUserByEmail: async () => undefined,
		listUsers: async (input) => ({
			limit: input.limit ?? 50,
			offset: input.offset ?? 0,
			total: 1,
			users: [user()],
		}),
		updateUser: async (input) =>
			user({
				ban_expires: input.banExpires ?? null,
				ban_reason: input.banReason ?? null,
				banned: input.banned ?? false,
				id: input.userId,
				role: input.role === undefined ? "user" : input.role,
			}),
		...overrides,
	};
}

const config = normalizeAthenaAuthConfig({ mode: "local" });
const hasher = {
	hash: async () => "$argon2id$test",
	needsRehash: () => false,
	verify: async () => true,
};

function ctx(actor = user(), actorSession = session(), adminStore = store()) {
	return {
		config,
		hasher,
		headers: new Headers(),
		issueSession: async (_request: Request, userId: string) =>
			session({ token: "restored-admin-session", user_id: userId }),
		requireSession: async () => ({
			session: actorSession,
			token: actorSession.token,
			user: actor,
		}),
		store: adminStore,
	};
}

test("admin list-users requires an administrative role", async () => {
	await assert.rejects(
		() =>
			handleAdminRoute(
				new Request("http://localhost/api/auth/admin/list-users"),
				"/admin/list-users",
				"GET",
				ctx(user({ role: "user" })),
			),
		/Administrator access required/,
	);
});

test("admin list-users returns public users without metadata secrets", async () => {
	const response = await handleAdminRoute(
		new Request("http://localhost/api/auth/admin/list-users?limit=10"),
		"/admin/list-users",
		"GET",
		ctx(),
	);
	assert.ok(response);
	const body = (await response.json()) as {
		users: Record<string, unknown>[];
	};
	assert.equal(body.users.length, 1);
	const firstUser = body.users[0];
	assert.ok(firstUser);
	assert.equal("metadata" in firstUser, false);
	assert.equal(JSON.stringify(body).includes("must-never-leak"), false);
});

test("ban-user revokes all target sessions", async () => {
	let revokedUserId: string | undefined;
	const response = await handleAdminRoute(
		new Request("http://localhost/api/auth/admin/ban-user", {
			body: JSON.stringify({ userId: "user-2", banReason: "abuse" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		"/admin/ban-user",
		"POST",
		ctx(
			user(),
			session(),
			store({
				deleteUserSessions: async (userId) => {
					revokedUserId = userId;
					return 3;
				},
			}),
		),
	);
	assert.ok(response);
	assert.equal(revokedUserId, "user-2");
	const body = (await response.json()) as { revokedSessions: number };
	assert.equal(body.revokedSessions, 3);
});

test("stop-impersonating does not require the target user to be admin", async () => {
	let deletedToken: string | undefined;
	const impersonatedSession = session({
		impersonated_by: "admin-1",
		token: "impersonated-session",
		user_id: "user-2",
	});
	const response = await handleAdminRoute(
		new Request("http://localhost/api/auth/admin/stop-impersonating", {
			method: "POST",
		}),
		"/admin/stop-impersonating",
		"POST",
		ctx(
			user({ id: "user-2", role: "user" }),
			impersonatedSession,
			store({
				deleteSession: async (token) => {
					deletedToken = token;
					return true;
				},
			}),
		),
	);
	assert.ok(response);
	assert.equal(deletedToken, "impersonated-session");
});
