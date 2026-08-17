import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/v3-client.ts";

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
		restore() {
			globalThis.fetch = original;
		},
	};
}

const client = createClient({
	db: { url: "https://athena-db.com" },
	key: "secret",
});

test("query fallback quotes reserved-word columns from array selection", async () => {
	const { calls, restore } = mockFetch();
	try {
		await client
			.from("public.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select(["table", "user", "order"]);

		assert.equal(calls.length, 1);
		assert.ok(calls[0].url.endsWith("/gateway/query"));
		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(
				'SELECT "table", "user", "order" FROM "public"."type_lab"',
			),
		);
	} finally {
		restore();
	}
});

test("query fallback quotes mixed-case and spaced identifiers", async () => {
	const { calls, restore } = mockFetch();
	try {
		await client
			.from("analytics.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select(["MixedCase", "space name"]);

		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(
				'SELECT "MixedCase", "space name" FROM "analytics"."type_lab"',
			),
		);
	} finally {
		restore();
	}
});

test("query fallback quotes simple comma-separated identifier strings", async () => {
	const { calls, restore } = mockFetch();
	try {
		await client
			.from("public.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select("table, user, order");

		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(
				'SELECT "table", "user", "order" FROM "public"."type_lab"',
			),
		);
	} finally {
		restore();
	}
});

test("query fallback does not rewrite complex select SQL expressions with commas", async () => {
	const { calls, restore } = mockFetch();
	try {
		const expression = "concat(\"table\", 'x,y') as computed, order";
		await client
			.from("public.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select(expression);

		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(`SELECT ${expression} FROM "public"."type_lab"`),
		);
	} finally {
		restore();
	}
});

test("query fallback auto-quotes simple aliased identifiers", async () => {
	const { calls, restore } = mockFetch();
	try {
		await client
			.from("public.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select("table as table_alias, public.type_lab.order AS order_alias");

		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(
				'SELECT "table" AS "table_alias", "public"."type_lab"."order" AS "order_alias" FROM "public"."type_lab"',
			),
		);
	} finally {
		restore();
	}
});

test("query fallback auto-quotes colon response aliases", async () => {
	const { calls, restore } = mockFetch();
	try {
		await client
			.from("public.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select("table_alias:table, order_alias:public.type_lab.order");

		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(
				'SELECT "table" AS "table_alias", "public"."type_lab"."order" AS "order_alias" FROM "public"."type_lab"',
			),
		);
	} finally {
		restore();
	}
});

test("query fallback auto-quotes colon response aliases from array selection", async () => {
	const { calls, restore } = mockFetch();
	try {
		await client
			.from("public.type_lab")
			.eqCast("id", "550e8400-e29b-41d4-a716-446655440000", "uuid")
			.select(["table_alias:table", "order_alias:public.type_lab.order"]);

		const payload = JSON.parse(calls[0].init?.body as string);
		assert.ok(
			payload.query.includes(
				'SELECT "table" AS "table_alias", "public"."type_lab"."order" AS "order_alias" FROM "public"."type_lab"',
			),
		);
	} finally {
		restore();
	}
});
