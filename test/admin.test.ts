import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
	buildAdminAuthFetchOptions,
	hasAdminPermission,
	hasAdminRole,
	resolveAdminPermission,
	resolveAdminPermissionClient,
} from "../src/admin/index.ts";
import { createClient } from "../src/v3-client.ts";

interface Captured {
	init?: RequestInit;
	url: string;
}

function mockFetch(
	responseBody: unknown = { success: true },
	responseInit: ResponseInit = { status: 200 },
) {
	const calls: Captured[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		const body =
			typeof responseBody === "string"
				? responseBody
				: JSON.stringify(responseBody);
		return new Response(body, responseInit);
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

test("hasAdminRole normalizes comma-separated role strings", () => {
	assert.equal(hasAdminRole(null), false);
	assert.equal(hasAdminRole({ user: { role: "member" } }), false);
	assert.equal(hasAdminRole({ user: { role: "ADMIN" } }), true);
	assert.equal(hasAdminRole({ user: { role: "member, admin , owner" } }), true);
});

test("resolveAdminPermissionClient accepts createClient and auth-binding shapes", () => {
	const admin = {
		hasPermission: async () => ({ data: { success: true }, ok: true }),
	};
	const nested = resolveAdminPermissionClient({ auth: { admin } });
	assert.equal(nested?.auth.admin, admin);

	const bindings = resolveAdminPermissionClient({ admin });
	assert.equal(bindings?.auth.admin, admin);

	assert.equal(resolveAdminPermissionClient(null), null);
	assert.equal(resolveAdminPermissionClient({}), null);
});

test("hasAdminPermission short-circuits on local admin role", async () => {
	const client = createClient({
		auth: {
			url: "https://auth.example.com/api/auth",
		},
		db: { url: "https://gateway.example.com" },
		key: "gateway-key",
	});

	const { calls, restore } = mockFetch();
	try {
		const allowed = await hasAdminPermission(client, {
			permissions: ["admin:read"],
			session: {
				user: {
					id: "usr_1",
					role: "admin",
				},
			},
		});

		assert.equal(allowed, true);
		assert.equal(calls.length, 0);
	} finally {
		restore();
	}
});

test("hasAdminPermission delegates to auth admin hasPermission", async () => {
	const client = createClient({
		auth: {
			credentials: "include",
			url: "https://auth.example.com/api/auth",
		},
		context: { bearerToken: "bearer-token" },
		db: { url: "https://gateway.example.com" },
		key: "gateway-key",
	});

	const { calls, restore } = mockFetch({ success: true });
	try {
		const allowed = await hasAdminPermission(client, {
			allowRoleBypass: false,
			fetchOptions: {
				headers: {
					cookie: "athena-auth.session_token=session_1",
				},
			},
			permissions: { users: ["manage"] },
			session: {
				user: {
					id: "usr_2",
					role: "member",
				},
			},
		});

		assert.equal(allowed, true);
		assert.equal(calls.length, 1);
		assert.equal(
			calls[0].url,
			"https://auth.example.com/api/auth/admin/has-permission",
		);
	} finally {
		restore();
	}
});

test("resolveAdminPermission returns framework-agnostic unauthorized and forbidden results", async () => {
	const client = createClient({
		auth: {
			url: "https://auth.example.com/api/auth",
		},
		db: { url: "https://gateway.example.com" },
		key: "gateway-key",
	});

	const unauthorized = await resolveAdminPermission(client, {
		permissions: ["admin:read"],
		session: null,
	});
	assert.deepEqual(unauthorized, {
		error: "Unauthorized",
		ok: false,
		status: 401,
	});

	const { restore } = mockFetch({ error: "Forbidden", success: false });
	try {
		const forbidden = await resolveAdminPermission(client, {
			allowRoleBypass: false,
			permissions: ["admin:read"],
			session: {
				user: {
					id: "usr_3",
					role: "member",
				},
			},
		});

		assert.deepEqual(forbidden, {
			error: "Forbidden",
			ok: false,
			status: 403,
		});
	} finally {
		restore();
	}
});

test("buildAdminAuthFetchOptions maps cookie and bearer without prefix matching", () => {
	const options = buildAdminAuthFetchOptions({
		bearerToken: "tok_1",
		cookie: "athena-auth.session_token=abc; theme=dark",
	});
	assert.equal(options.credentials, "include");
	assert.equal(options.bearerToken, "tok_1");
	assert.equal(
		(options.headers as Record<string, string>).cookie,
		"athena-auth.session_token=abc; theme=dark",
	);
	assert.equal(
		(options.headers as Record<string, string>).authorization,
		"Bearer tok_1",
	);
});

test("hasAdminPermission accepts credentials shorthand", async () => {
	let captured: unknown;
	const client = {
		auth: {
			admin: {
				hasPermission: async (input: unknown) => {
					captured = input;
					return { data: { success: true }, ok: true };
				},
			},
		},
	};

	const allowed = await hasAdminPermission(client, {
		allowRoleBypass: false,
		credentials: {
			cookie: "athena-auth.session_token=session_cookie",
		},
		permissions: ["admin:read"],
		session: { user: { id: "usr_cred", role: "member" } },
	});

	assert.equal(allowed, true);
	const record = captured as {
		fetchOptions?: { headers?: Record<string, string> };
	};
	assert.equal(
		record.fetchOptions?.headers?.cookie,
		"athena-auth.session_token=session_cookie",
	);
});

test("package exports expose ./admin entrypoint", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as {
		exports: Record<
			string,
			{
				types?: string;
				import?: string;
				require?: string;
				default?: string;
			}
		>;
	};

	assert.equal(packageJson.exports["./admin"]?.types, "./dist/admin.d.ts");
	assert.equal(packageJson.exports["./admin"]?.import, "./dist/admin.js");
	assert.equal(packageJson.exports["./admin"]?.require, "./dist/admin.cjs");
	assert.equal(packageJson.exports["./admin"]?.default, "./dist/admin.js");
});
