import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	createClient,
	defineModel,
	identifier,
	string,
	table,
} from "../src/index.ts";

interface Capture {
	init?: RequestInit;
	url: string;
}

function mockFetch() {
	const calls: Capture[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return new Response(JSON.stringify({ data: [], status: 200 }), {
			status: 200,
		});
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

test("root client accepts table and legacy model targets directly", async () => {
	const { calls, restore } = mockFetch();
	const users = table("users")
		.schema("public")
		.columns({ email: string(), id: string() })
		.primaryKey("id");
	const legacyUsers = defineModel<{ id: string }>({
		meta: { primaryKey: ["id"], tableName: "legacy.user_records" },
	});

	try {
		const client = createClient({
			key: "secret",
			url: "https://athena-db.com",
		});
		await client.from(users).eq("id", "u3").select("*");
		await client.from(legacyUsers).select("*");

		const firstPayload = JSON.parse(calls[0].init?.body as string);
		const secondPayload = JSON.parse(calls[1].init?.body as string);
		assert.equal(firstPayload.table_name, "public.users");
		assert.equal(secondPayload.table_name, "legacy.user_records");
	} finally {
		restore();
	}
});

test("identifier helper returns a safely quoted SQL identifier", () => {
	assert.equal(
		identifier("analytics", "Order Items").toSql(),
		'"analytics"."Order Items"',
	);
});

test("createClient models registry: string from() uses the table name; model targets use meta.tableName", async () => {
	const { calls, restore } = mockFetch();
	const users = defineModel<{ id: string; email: string }>({
		meta: {
			database: "app",
			model: "users",
			primaryKey: ["id"],
			schema: "public",
			tableName: "public.users",
		},
	});
	const models = {
		app: {
			schemas: {
				public: {
					models: {
						users,
					},
				},
			},
		},
	};

	try {
		const client = createClient({
			key: "secret",
			models,
			url: "https://athena-db.com",
		});
		// String targets are literal table names (typing still comes from the registry when known).
		await client.from("users").select("id,email");
		// Model values carry qualified table metadata into the wire payload.
		await client.from(users).eq("id", "u1").select("*");

		const firstPayload = JSON.parse(calls[0].init?.body as string);
		const secondPayload = JSON.parse(calls[1].init?.body as string);
		assert.equal(firstPayload.table_name, "users");
		assert.equal(secondPayload.table_name, "public.users");
	} finally {
		restore();
	}
});

test("createClient models registry accepts multi-schema model targets at runtime", async () => {
	const { calls, restore } = mockFetch();
	const publicUsers = defineModel<{ id: string }>({
		meta: { primaryKey: ["id"], tableName: "public.users" },
	});
	const analyticsEvents = defineModel<{ id: string }>({
		meta: { primaryKey: ["id"], tableName: "analytics.events" },
	});
	const models = {
		app: {
			schemas: {
				analytics: {
					models: {
						events: analyticsEvents,
					},
				},
				public: {
					models: {
						users: publicUsers,
					},
				},
			},
		},
	};

	try {
		const client = createClient({
			key: "secret",
			models,
			url: "https://athena-db.com",
		});
		await client.from(publicUsers).select("*");
		await client.from(analyticsEvents).select("*");

		assert.equal(
			JSON.parse(calls[0].init?.body as string).table_name,
			"public.users",
		);
		assert.equal(
			JSON.parse(calls[1].init?.body as string).table_name,
			"analytics.events",
		);
	} finally {
		restore();
	}
});
